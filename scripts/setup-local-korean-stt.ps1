[CmdletBinding()]
param(
    [ValidateSet("base", "small", "medium", "large-v3-turbo")]
    [string]$Model = "large-v3-turbo",
    [switch]$DownloadModel,
    [switch]$SkipGpuRuntime
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$python = Get-Command python.exe -ErrorAction Stop
$venv = Join-Path $root "data\local-voice\.venv"
$venvPython = Join-Path $venv "Scripts\python.exe"

& $python.Source --version
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "[동행금융AI] 로컬 음성용 Python 가상환경을 만듭니다." -ForegroundColor Cyan
    & $python.Source -m venv $venv
}

Write-Host "[동행금융AI] faster-whisper 한국어 STT 의존성을 설치합니다." -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $root "local_voice\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "로컬 STT 의존성 설치가 실패했습니다." }

if ($Model -eq "large-v3-turbo" -and -not $SkipGpuRuntime) {
    Write-Host "[동행금융AI] RTX GPU용 CUDA 12/cuDNN 9 런타임을 로컬 STT 경로에 준비합니다." -ForegroundColor Cyan
    & $venvPython (Join-Path $root "local_voice\install_cuda_runtime.py")
    if ($LASTEXITCODE -ne 0) { throw "로컬 STT GPU 런타임 준비가 실패했습니다." }
}

if ($DownloadModel) {
    $env:DONGHAENG_LOCAL_STT_MODEL = $Model
    Write-Host "[동행금융AI] '$Model' Whisper 모델을 로컬에 내려받습니다. 인터넷 연결과 수백 MB의 여유 공간이 필요합니다." -ForegroundColor Cyan
    & $venvPython (Join-Path $root "local_voice\voice_server.py") --download-model
    if ($LASTEXITCODE -ne 0) { throw "Whisper 모델 다운로드가 실패했습니다." }
}

Write-Host "완료. 다음 명령으로 loopback STT를 실행하세요:" -ForegroundColor Green
Write-Host ".\scripts\start-local-korean-stt.ps1 -Model $Model" -ForegroundColor Green
