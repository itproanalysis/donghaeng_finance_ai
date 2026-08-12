[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8766
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$python = Join-Path $root "data\local-voice\tts-venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "신경망 한국어 TTS가 아직 설치되지 않았습니다. .\scripts\setup-local-korean-tts.ps1 -DownloadModel 을 먼저 실행하세요."
}
if (-not (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue)) {
    throw "Qwen3-TTS는 이 시연 구성에서 NVIDIA GPU를 필요로 합니다."
}
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) { throw "포트 $Port 에 이미 TTS 또는 다른 프로그램이 실행 중입니다." }

$env:DONGHAENG_LOCAL_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
$env:DONGHAENG_LOCAL_TTS_MODEL_DIR = Join-Path $root "data\local-voice\tts-models"
$env:DONGHAENG_LOCAL_TTS_MODEL_PATH = Join-Path $env:DONGHAENG_LOCAL_TTS_MODEL_DIR "Qwen3-TTS-12Hz-1.7B-CustomVoice"
$env:DONGHAENG_LOCAL_TTS_SPEAKER = "Sohee"
$env:DONGHAENG_LOCAL_TTS_TOKEN = "local-tts-runtime"
Write-Host "[동행금융AI] Qwen3-TTS 한국어 AI 음성을 http://127.0.0.1:$Port 에서 시작합니다." -ForegroundColor Cyan
& $python (Join-Path $root "local_voice\tts_server.py") --host 127.0.0.1 --port $Port
