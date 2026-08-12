"""Install the CUDA 12/cuDNN 9 runtime used by local faster-whisper on Windows.

The runtime is kept inside data/local-voice instead of System32, and is only
added to PATH by the local STT launcher.  The upstream faster-whisper project
links to this Windows archive as an installation option for CTranslate2.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "data" / "local-voice" / "cuda12-runtime"
ARCHIVE_URL = (
    "https://github.com/Purfview/whisper-standalone-win/releases/download/libs/"
    "cuBLAS.and.cuDNN_CUDA12_win_v3.7z"
)
MIN_ARCHIVE_BYTES = 800 * 1024 * 1024
REQUIRED_DLLS = {"cublas64_12.dll", "cudnn_ops64_9.dll"}


def has_required_runtime(directory: Path) -> bool:
    names = {path.name.lower() for path in directory.rglob("*.dll")}
    return REQUIRED_DLLS.issubset(names)


def install() -> Path:
    if has_required_runtime(DESTINATION):
        return DESTINATION

    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    temporary_directory = Path(tempfile.mkdtemp(prefix="donghaeng-cuda-runtime-"))
    archive_path = temporary_directory / "cuda12-runtime.7z"
    extracted_path = temporary_directory / "extracted"
    extracted_path.mkdir()
    try:
        print("[동행금융AI] CUDA 12 / cuDNN 9 로컬 런타임을 내려받습니다.", flush=True)
        with urllib.request.urlopen(ARCHIVE_URL, timeout=60) as response, archive_path.open("wb") as target:
            shutil.copyfileobj(response, target)
        if archive_path.stat().st_size < MIN_ARCHIVE_BYTES:
            raise RuntimeError("CUDA runtime archive size check failed")

        print("[동행금융AI] CUDA 런타임을 로컬 STT 전용 경로에 풉니다.", flush=True)
        # Windows 11 bundles bsdtar, whose 7z decoder supports the BCJ2 filter
        # used by the official runtime archive.  Keeping extraction in a child
        # process also avoids requiring an elevated, machine-wide 7-Zip install.
        subprocess.run(
            ["tar.exe", "-xf", str(archive_path), "-C", str(extracted_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        if not has_required_runtime(extracted_path):
            raise RuntimeError("Required CUDA runtime DLLs were not found after extraction")

        if DESTINATION.exists():
            shutil.rmtree(DESTINATION)
        extracted_path.replace(DESTINATION)
    finally:
        shutil.rmtree(temporary_directory, ignore_errors=True)

    return DESTINATION


if __name__ == "__main__":
    runtime = install()
    print(f"CUDA_RUNTIME_READY={runtime}", flush=True)
