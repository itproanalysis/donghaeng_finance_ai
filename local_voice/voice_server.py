"""Loopback-only OpenAI-compatible Korean STT bridge.

The web application already speaks the OpenAI transcription multipart contract.
This tiny service lets it use a local faster-whisper model instead of sending
audio to a third party. It deliberately has no transcript history or audio
persistence: uploads are written to a temporary file only while a turn is
being decoded and are removed in ``finally``.
"""

from __future__ import annotations

import argparse
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


def configuration() -> dict[str, Any]:
    return {
        "model": os.environ.get("DONGHAENG_LOCAL_STT_MODEL", "large-v3-turbo").strip() or "large-v3-turbo",
        "model_dir": Path(os.environ.get("DONGHAENG_LOCAL_STT_MODEL_DIR", DEFAULT_MODEL_DIR)),
        "token": os.environ.get("DONGHAENG_LOCAL_STT_TOKEN", "local-voice-runtime"),
        "device": os.environ.get("DONGHAENG_LOCAL_STT_DEVICE", "cuda"),
        "compute_type": os.environ.get("DONGHAENG_LOCAL_STT_COMPUTE_TYPE", "float16"),
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = configuration()
    config["model_dir"].mkdir(parents=True, exist_ok=True)
    app.state.model_name = config["model"]
    app.state.token = config["token"]
    app.state.model = WhisperModel(
        config["model"],
        device=config["device"],
        compute_type=config["compute_type"],
        download_root=str(config["model_dir"]),
    )
    yield
    app.state.model = None


app = FastAPI(title="Donghaeng Local Korean STT", version="1.0", lifespan=lifespan)


def require_local_token(authorization: str | None) -> None:
    expected = f"Bearer {app.state.token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="LOCAL_STT_UNAUTHORIZED")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ready", "provider": "faster-whisper", "model": app.state.model_name}


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
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="donghaeng-stt-", suffix=suffix, delete=False) as temporary:
            temporary.write(payload)
            temporary_path = temporary.name
        try:
            segments, _ = app.state.model.transcribe(
                temporary_path,
                language="ko",
                task="transcribe",
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
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
