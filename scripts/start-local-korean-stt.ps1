[CmdletBinding()]
param(
    [ValidateSet("base", "small", "medium", "large-v3-turbo")]
    [string]$Model = "large-v3-turbo",

    [ValidateSet("cuda", "cpu")]
    [string]$Device = "cuda",

    [ValidateSet("float16", "int8", "int8_float16")]
    [string]$ComputeType = "float16",

    [ValidateRange(1, 5)]
    [int]$BeamSize = 1,

    [ValidateRange(100, 2000)]
    [int]$VadMinSilenceMs = 300,

    [ValidateRange(0, 1000)]
    [int]$VadSpeechPadMs = 120,

    [ValidateRange(10, 120)]
    [int]$VadMaxSpeechSeconds = 30,

    [ValidateRange(1024, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$python = Join-Path $root "data\local-voice\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "로컬 STT가 아직 설치되지 않았습니다. .\scripts\setup-local-korean-stt.ps1 -DownloadModel 을 먼저 실행하세요."
}
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
    throw "포트 $Port 에 이미 STT 또는 다른 프로그램이 실행 중입니다."
}
$env:DONGHAENG_LOCAL_STT_MODEL = $Model
$env:DONGHAENG_LOCAL_STT_DEVICE = $Device
$env:DONGHAENG_LOCAL_STT_COMPUTE_TYPE = $ComputeType
$env:DONGHAENG_LOCAL_STT_TOKEN = "local-voice-runtime"
$env:DONGHAENG_LOCAL_STT_BEAM_SIZE = [string]$BeamSize
$env:DONGHAENG_LOCAL_STT_VAD_MIN_SILENCE_MS = [string]$VadMinSilenceMs
$env:DONGHAENG_LOCAL_STT_VAD_SPEECH_PAD_MS = [string]$VadSpeechPadMs
$env:DONGHAENG_LOCAL_STT_VAD_MAX_SPEECH_SECONDS = [string]$VadMaxSpeechSeconds
$cudaRuntime = Join-Path $root "data\local-voice\cuda12-runtime"
if ($Device -eq "cuda") {
    $requiredCublas = Get-ChildItem -LiteralPath $cudaRuntime -Recurse -Filter "cublas64_12.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
    $requiredCudnn = Get-ChildItem -LiteralPath $cudaRuntime -Recurse -Filter "cudnn_ops64_9.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $requiredCublas -or -not $requiredCudnn) {
        throw "GPU 런타임이 없습니다. .\scripts\setup-local-korean-stt.ps1 -Model large-v3-turbo -DownloadModel 을 먼저 실행하세요."
    }
    $runtimeDirs = @($requiredCublas.Directory.FullName, $requiredCudnn.Directory.FullName) | Select-Object -Unique
    $env:PATH = (($runtimeDirs -join ';') + ';' + $env:PATH)
}
Write-Host "[동행금융AI] faster-whisper 한국어 STT를 http://127.0.0.1:$Port 에서 시작합니다." -ForegroundColor Cyan
& $python (Join-Path $root "local_voice\voice_server.py") --host 127.0.0.1 --port $Port
