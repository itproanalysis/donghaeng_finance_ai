"""Loopback-only OpenAI-compatible Korean STT bridge.

The web application already speaks the OpenAI transcription multipart contract.
This tiny service lets it use a local faster-whisper model instead of sending
audio to a third party. It deliberately has no transcript history or audio
persistence: uploads are written to a temporary file only while a turn is
being decoded and are removed in ``finally``.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_DIR = ROOT / "data" / "local-voice" / "models"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
LATENCY_PROFILE = "realtime-isolated-turn-v1"


def bounded_integer_environment(
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return default
    try:
        value = int(raw_value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def configuration() -> dict[str, Any]:
    beam_size = bounded_integer_environment("DONGHAENG_LOCAL_STT_BEAM_SIZE", 1, 1, 5)
    vad_min_silence_ms = bounded_integer_environment(
        "DONGHAENG_LOCAL_STT_VAD_MIN_SILENCE_MS", 300, 100, 2_000
    )
    vad_speech_pad_ms = bounded_integer_environment(
        "DONGHAENG_LOCAL_STT_VAD_SPEECH_PAD_MS", 120, 0, 1_000
    )
    vad_max_speech_seconds = bounded_integer_environment(
        "DONGHAENG_LOCAL_STT_VAD_MAX_SPEECH_SECONDS", 30, 10, 120
    )
    return {
        "model": os.environ.get("DONGHAENG_LOCAL_STT_MODEL", "large-v3-turbo").strip() or "large-v3-turbo",
        "model_dir": Path(os.environ.get("DONGHAENG_LOCAL_STT_MODEL_DIR", DEFAULT_MODEL_DIR)),
        "token": os.environ.get("DONGHAENG_LOCAL_STT_TOKEN", "local-voice-runtime"),
        "device": os.environ.get("DONGHAENG_LOCAL_STT_DEVICE", "cuda"),
        "compute_type": os.environ.get("DONGHAENG_LOCAL_STT_COMPUTE_TYPE", "float16"),
        "latency_profile": LATENCY_PROFILE,
        "decode_options": {
            # Each HTTP request is one independent answer turn. Greedy decoding
            # avoids the 5-way beam search that previously dominated short turns.
            "beam_size": beam_size,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            # The API returns text only, so timestamp token decoding is needless.
            "word_timestamps": False,
            "without_timestamps": True,
            "vad_filter": True,
            "vad_parameters": {
                "min_speech_duration_ms": 100,
                "min_silence_duration_ms": vad_min_silence_ms,
                "speech_pad_ms": vad_speech_pad_ms,
                "max_speech_duration_s": vad_max_speech_seconds,
            },
        },
    }


def preload_model() -> None:
    config = configuration()
    config["model_dir"].mkdir(parents=True, exist_ok=True)
    WhisperModel(
        config["model"],
        device=config["device"],
        compute_type=config["compute_type"],
        download_root=str(config["model_dir"]),
    )


class FinalPriorityTranscriptionLock:
    """Serialize one GPU model while letting final turns pass queued previews."""

    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._active = False
        self._waiting_finals = 0

    @asynccontextmanager
    async def hold(self, *, final: bool):
        registered_final = final
        async with self._condition:
            if registered_final:
                self._waiting_finals += 1
            try:
                await self._condition.wait_for(
                    lambda: not self._active and (final or self._waiting_finals == 0)
                )
            except BaseException:
                if registered_final:
                    self._waiting_finals -= 1
                    self._condition.notify_all()
                raise
            if registered_final:
                self._waiting_finals -= 1
            self._active = True

        try:
            yield
        finally:
            async with self._condition:
                self._active = False
                self._condition.notify_all()


def transcribe_audio_file(
    model: WhisperModel,
    temporary_path: str,
    decode_options: dict[str, Any],
) -> str:
    """Run both lazy segment decoding and joining on the worker thread."""

    segments, _ = model.transcribe(
        temporary_path,
        language="ko",
        task="transcribe",
        **decode_options,
    )
    return " ".join(
        segment.text.strip() for segment in segments if segment.text.strip()
    ).strip()


async def finish_transcription_before_unlocking(
    transcription_task: asyncio.Task[str],
) -> str:
    """Drain uncancellable GPU work before the serialized model is released."""

    try:
        return await asyncio.shield(transcription_task)
    except asyncio.CancelledError:
        # Cancelling ``asyncio.to_thread`` cannot stop faster-whisper or CUDA.
        # Keep the model lock until the worker really exits so a final request
        # can never overlap a disconnected rolling-caption request.
        while not transcription_task.done():
            try:
                await asyncio.shield(transcription_task)
            except asyncio.CancelledError:
                continue
        if not transcription_task.cancelled():
            transcription_task.exception()
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = configuration()
    config["model_dir"].mkdir(parents=True, exist_ok=True)
    app.state.model_name = config["model"]
    app.state.token = config["token"]
    app.state.latency_profile = config["latency_profile"]
    app.state.decode_options = config["decode_options"]
    app.state.model = WhisperModel(
        config["model"],
        device=config["device"],
        compute_type=config["compute_type"],
        download_root=str(config["model_dir"]),
    )
    app.state.transcription_lock = FinalPriorityTranscriptionLock()
    yield
    app.state.model = None


app = FastAPI(title="Donghaeng Local Korean STT", version="1.0", lifespan=lifespan)


def require_local_token(authorization: str | None) -> None:
    expected = f"Bearer {app.state.token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="LOCAL_STT_UNAUTHORIZED")


@app.get("/health")
async def health() -> dict[str, Any]:
    decode_options = app.state.decode_options
    vad_parameters = decode_options["vad_parameters"]
    return {
        "status": "ready",
        "provider": "faster-whisper",
        "model": app.state.model_name,
        "latency_profile": app.state.latency_profile,
        "decode": {
            "beam_size": decode_options["beam_size"],
            "condition_on_previous_text": decode_options["condition_on_previous_text"],
            "word_timestamps": decode_options["word_timestamps"],
            "vad_min_silence_ms": vad_parameters["min_silence_duration_ms"],
        },
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(""),
    language: str = Form("ko"),
    response_format: str = Form("json"),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    require_local_token(authorization)
    if language.lower() not in {"ko", "ko-kr"}:
        raise HTTPException(status_code=400, detail="LOCAL_STT_KOREAN_ONLY")
    if response_format.lower() != "json":
        raise HTTPException(status_code=400, detail="LOCAL_STT_JSON_ONLY")
    if model and model != app.state.model_name:
        raise HTTPException(status_code=400, detail="LOCAL_STT_MODEL_MISMATCH")

    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="LOCAL_STT_AUDIO_EMPTY")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="LOCAL_STT_AUDIO_TOO_LARGE")

    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    is_final_request = not (file.filename or "").startswith("interview-partial.")
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="donghaeng-stt-", suffix=suffix, delete=False) as temporary:
            temporary.write(payload)
            temporary_path = temporary.name
        try:
            async with app.state.transcription_lock.hold(final=is_final_request):
                transcription_task = asyncio.create_task(
                    asyncio.to_thread(
                        transcribe_audio_file,
                        app.state.model,
                        temporary_path,
                        app.state.decode_options,
                    )
                )
                text = await finish_transcription_before_unlocking(
                    transcription_task
                )
        except asyncio.CancelledError:
            raise
        except HTTPException:
            raise
        except Exception as error:
            # Do not expose decoder, path, or audio details through the browser API.
            raise HTTPException(status_code=422, detail="LOCAL_STT_TRANSCRIPTION_FAILED") from error
        if not text:
            raise HTTPException(status_code=422, detail="LOCAL_STT_NO_SPEECH")
        return JSONResponse({"text": text})
    finally:
        if temporary_path:
            try:
                Path(temporary_path).unlink(missing_ok=True)
            except OSError:
                # An inaccessible temporary path must never reveal audio content.
                pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Donghaeng local Korean faster-whisper server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--download-model", action="store_true")
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("The local STT bridge may bind to loopback addresses only.")
    if args.download_model:
        preload_model()
    else:
        import uvicorn

        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
