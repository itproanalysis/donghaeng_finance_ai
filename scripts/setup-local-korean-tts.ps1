[CmdletBinding()]
param(
    [switch]$DownloadModel
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$python = Get-Command python.exe -ErrorAction Stop
$venv = Join-Path $root "data\local-voice\tts-venv"
$venvPython = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "[동행금융AI] 신경망 한국어 TTS용 Python 가상환경을 만듭니다." -ForegroundColor Cyan
    & $python.Source -m venv $venv
}

Write-Host "[동행금융AI] Qwen3-TTS와 CUDA 12.8 GPU 런타임을 설치합니다." -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { throw "Qwen3-TTS GPU 런타임 설치가 실패했습니다." }
& $venvPython -m pip install qwen-tts "fastapi>=0.115,<1" "uvicorn[standard]>=0.32,<1" "soundfile>=0.13,<1"
if ($LASTEXITCODE -ne 0) { throw "Qwen3-TTS 의존성 설치가 실패했습니다." }

if ($DownloadModel) {
    $env:DONGHAENG_LOCAL_TTS_MODEL_DIR = Join-Path $root "data\local-voice\tts-models"
    $env:DONGHAENG_LOCAL_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
    $env:DONGHAENG_LOCAL_TTS_MODEL_PATH = Join-Path $env:DONGHAENG_LOCAL_TTS_MODEL_DIR "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    Write-Host "[동행금융AI] Qwen3-TTS 1.7B 한국어 Sohee 음성 모델을 로컬 GPU용으로 내려받습니다." -ForegroundColor Cyan
    & $venvPython (Join-Path $root "local_voice\tts_server.py") --download-model
    if ($LASTEXITCODE -ne 0) { throw "Qwen3-TTS 모델 다운로드가 실패했습니다." }
}

Write-Host "완료. 시연 전 .\scripts\start-local-korean-tts.ps1 을 실행하세요." -ForegroundColor Green
