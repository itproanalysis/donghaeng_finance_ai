"""Loopback-only Korean neural TTS bridge backed by Qwen3-TTS.

Audio is generated in memory for the browser and is never persisted.  The
service intentionally accepts only the application's local bearer token and
binds to a loopback address through its launcher.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
DEFAULT_MODEL_DIR = ROOT / "data" / "local-voice" / "tts-models"
DEFAULT_MODEL_PATH = DEFAULT_MODEL_DIR / "Qwen3-TTS-12Hz-1.7B-CustomVoice"
# Hugging Face reads this setting while importing some of its modules, so set
# it before importing Qwen3-TTS to keep model weights inside the local runtime.
os.environ.setdefault("HF_HOME", str(DEFAULT_MODEL_DIR))

import soundfile as sf
import torch
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from huggingface_hub import snapshot_download
from pydantic import BaseModel, Field
from qwen_tts import Qwen3TTSModel
MAX_INPUT_CHARS = 1_200


def configuration() -> dict[str, str]:
    return {
        "model": os.environ.get("DONGHAENG_LOCAL_TTS_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        "model_dir": os.environ.get("DONGHAENG_LOCAL_TTS_MODEL_DIR", str(DEFAULT_MODEL_DIR)),
        "model_path": os.environ.get("DONGHAENG_LOCAL_TTS_MODEL_PATH", str(DEFAULT_MODEL_PATH)),
        "token": os.environ.get("DONGHAENG_LOCAL_TTS_TOKEN", "local-tts-runtime"),
        "speaker": os.environ.get("DONGHAENG_LOCAL_TTS_SPEAKER", "Sohee"),
    }


def resolve_model_path(config: dict[str, str]) -> Path:
    model_path = Path(config["model_path"])
    required_files = ("config.json", "model.safetensors", "speech_tokenizer/model.safetensors")
    if all((model_path / file_name).is_file() for file_name in required_files):
        return model_path
    model_path.mkdir(parents=True, exist_ok=True)
    snapshot_download(config["model"], local_dir=str(model_path))
    if not all((model_path / file_name).is_file() for file_name in required_files):
        raise RuntimeError("Qwen3-TTS model download is incomplete")
    return model_path


def load_model() -> Qwen3TTSModel:
    config = configuration()
    model_dir = Path(config["model_dir"])
    model_dir.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(model_dir)
    if not torch.cuda.is_available():
        raise RuntimeError("A CUDA-capable NVIDIA GPU is required for local neural TTS.")
    model_path = resolve_model_path(config)
    return Qwen3TTSModel.from_pretrained(
        str(model_path),
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )


def preload_model() -> None:
    load_model()


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = configuration()
    app.state.model_name = config["model"]
    app.state.token = config["token"]
    app.state.speaker = config["speaker"]
    app.state.model = load_model()
    app.state.lock = asyncio.Lock()
    yield
    app.state.model = None


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)
    model: str | None = None
    voice: str | None = None
    response_format: Literal["wav"] = "wav"


app = FastAPI(title="Donghaeng Local Korean Neural TTS", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_local_token(authorization: str | None) -> None:
    if authorization != f"Bearer {app.state.token}":
        raise HTTPException(status_code=401, detail="LOCAL_TTS_UNAUTHORIZED")


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ready",
        "provider": "qwen3-tts",
        "model": app.state.model_name,
        "speaker": app.state.speaker,
    }


@app.post("/v1/audio/speech")
async def speech(request: SpeechRequest, authorization: str | None = Header(default=None)) -> Response:
    require_local_token(authorization)
    if request.model and request.model != app.state.model_name:
        raise HTTPException(status_code=400, detail="LOCAL_TTS_MODEL_MISMATCH")
    if request.voice and request.voice != app.state.speaker:
        raise HTTPException(status_code=400, detail="LOCAL_TTS_VOICE_MISMATCH")

    async with app.state.lock:
        try:
            wavs, sample_rate = app.state.model.generate_custom_voice(
                text=request.input,
                language="Korean",
                speaker=app.state.speaker,
                instruct="따뜻하고 자연스러운 한국어 여성 상담가의 목소리로 말합니다. 질문은 한 문장씩 또렷하고 부드럽게 읽고, 기계적으로 끊지 않습니다.",
            )
            buffer = io.BytesIO()
            sf.write(buffer, wavs[0], sample_rate, format="WAV")
            payload = buffer.getvalue()
        except Exception as error:
            # Browser responses never reveal model, GPU, or input details.
            raise HTTPException(status_code=503, detail="LOCAL_TTS_SYNTHESIS_FAILED") from error

    return Response(content=payload, media_type="audio/wav", headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Donghaeng local Korean Qwen3-TTS server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8766, type=int)
    parser.add_argument("--download-model", action="store_true")
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("The local neural TTS bridge may bind to loopback addresses only.")
    if args.download_model:
        preload_model()
    else:
        import uvicorn

        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
