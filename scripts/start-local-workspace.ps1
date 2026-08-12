[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 3000,

    [ValidateRange(10, 300)]
    [int]$TimeoutSeconds = 90,

    [ValidateRange(1, 900)]
    [int]$DependencyInstallTimeoutSeconds = 300,

    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
if ($env:DONGHAENG_LOCAL_NO_BROWSER -eq "1") {
    $NoBrowser = $true
}

function Write-Step {
    param([string]$Message)
    Write-Host ("[동행금융AI] {0}" -f $Message) -ForegroundColor Cyan
}

function Write-Notice {
    param([string]$Message)
    Write-Host ("[안내] {0}" -f $Message) -ForegroundColor Yellow
}

function Test-LocalKoreanTtsReady {
    param([int]$TtsPort = 8766)

    try {
        $health = Invoke-RestMethod `
            -Uri ("http://127.0.0.1:{0}/health" -f $TtsPort) `
            -Method Get `
            -TimeoutSec 3
        return $health.status -eq "ready" -and
            $health.provider -eq "qwen3-tts" -and
            $health.model -eq "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
    }
    catch {
        return $false
    }
}

function Start-LocalKoreanTtsIfNeeded {
    param(
        [string]$RepositoryRoot,
        [string]$LogDirectory,
        [int]$TtsPort = 8766,
        [int]$ReadyTimeoutSeconds = 90
    )

    if (Test-LocalKoreanTtsReady -TtsPort $TtsPort) {
        Write-Step "고품질 한국어 AI 음성(Qwen3-TTS Sohee)이 이미 준비되어 있습니다."
        return
    }

    $existingListener = Get-NetTCPConnection -State Listen -LocalPort $TtsPort -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -ne $existingListener) {
        throw "포트 $TtsPort 에 응답하지 않는 다른 프로그램이 있어 AI 음성 엔진을 시작하지 않았습니다. 안전을 위해 해당 프로그램을 확인한 뒤 다시 실행하세요."
    }

    $python = Join-Path $RepositoryRoot "data\local-voice\tts-venv\Scripts\python.exe"
    $ttsServer = Join-Path $RepositoryRoot "local_voice\tts_server.py"
    $ttsModel = Join-Path $RepositoryRoot "data\local-voice\tts-models\Qwen3-TTS-12Hz-1.7B-CustomVoice"
    if (-not (Test-Path -LiteralPath $python -PathType Leaf) -or
        -not (Test-Path -LiteralPath $ttsServer -PathType Leaf) -or
        -not (Test-Path -LiteralPath $ttsModel -PathType Container)) {
        throw "고품질 한국어 AI 음성 모델이 준비되지 않았습니다. Setup-Local-Korean-TTS.cmd를 먼저 실행하세요."
    }
    if (-not (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue)) {
        throw "고품질 한국어 AI 음성은 NVIDIA GPU가 필요합니다. GPU 환경을 확인한 뒤 다시 실행하세요."
    }

    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
    $stdoutLog = Join-Path $LogDirectory ("tts-{0}.out.log" -f $timestamp)
    $stderrLog = Join-Path $LogDirectory ("tts-{0}.err.log" -f $timestamp)
    Write-Step "고품질 한국어 AI 음성(Qwen3-TTS Sohee)을 시작합니다."
    $ttsProcess = Start-Process `
        -FilePath $python `
        -ArgumentList @($ttsServer, "--host", "127.0.0.1", "--port", "$TtsPort") `
        -WorkingDirectory $RepositoryRoot `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden `
        -PassThru
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt $ReadyTimeoutSeconds) {
        $ttsProcess.Refresh()
        if ($ttsProcess.HasExited) {
            $stdoutTail = if (Test-Path -LiteralPath $stdoutLog) { (Get-Content -LiteralPath $stdoutLog -Tail 20 -Encoding UTF8 -ErrorAction SilentlyContinue) -join [Environment]::NewLine } else { "" }
            $stderrTail = if (Test-Path -LiteralPath $stderrLog) { (Get-Content -LiteralPath $stderrLog -Tail 20 -Encoding UTF8 -ErrorAction SilentlyContinue) -join [Environment]::NewLine } else { "" }
            throw "AI 음성 엔진이 준비되기 전에 종료됐습니다 (종료 코드 $($ttsProcess.ExitCode)).`n$stdoutTail`n$stderrTail"
        }
        if (Test-LocalKoreanTtsReady -TtsPort $TtsPort) {
            Write-Step "고품질 한국어 AI 음성 준비를 확인했습니다."
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "AI 음성 엔진이 $ReadyTimeoutSeconds 초 안에 준비되지 않았습니다. 로그: $stdoutLog / $stderrLog"
}

function Import-ClaudeApiKey {
    param([string]$SecretPath)

    if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
        throw "Claude 키가 설정되지 않았습니다. 먼저 Configure-Claude-Key.cmd를 실행해 키를 안전하게 저장하세요."
    }
    try {
        $ciphertext = (Get-Content -LiteralPath $SecretPath -Raw -Encoding UTF8).Trim()
        if ([string]::IsNullOrWhiteSpace($ciphertext)) {
            throw "암호화된 Claude 키 파일이 비어 있습니다."
        }
        $secureKey = ConvertTo-SecureString -String $ciphertext
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try {
            $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
            if (
                [string]::IsNullOrWhiteSpace($plainKey) -or
                -not $plainKey.StartsWith("sk-ant-", [StringComparison]::Ordinal) -or
                $plainKey -match "\s"
            ) {
                throw "복호화된 Claude 키 형식이 올바르지 않습니다. Configure-Claude-Key.cmd로 다시 설정하세요."
            }
            $env:ANTHROPIC_API_KEY = $plainKey
        }
        finally {
            if ($pointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
            }
            $plainKey = $null
        }
    }
    catch {
        throw "Claude 키를 현재 Windows 사용자로 복호화하지 못했습니다. Configure-Claude-Key.cmd로 다시 설정하세요. $($_.Exception.Message)"
    }
}

function Get-ListeningProcess {
    param([int]$ListeningPort)

    $owningProcessIds = @(
        Get-NetTCPConnection -State Listen -LocalPort $ListeningPort -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    if ($owningProcessIds.Count -eq 0) {
        return $null
    }
    if ($owningProcessIds.Count -ne 1) {
        throw "포트 $ListeningPort 의 listener 소유 프로세스를 하나로 확정할 수 없습니다. 어떤 프로세스도 종료하지 않았습니다."
    }

    return Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $owningProcessIds[0]) -ErrorAction SilentlyContinue
}

function Get-ProcessInfo {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return $null
    }
    return Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $ProcessId) -ErrorAction SilentlyContinue
}

function Get-ProcessInfoWithRetry {
    param(
        [int]$ProcessId,
        [int]$TimeoutMilliseconds = 2000
    )

    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $processInfo = Get-ProcessInfo -ProcessId $ProcessId
        if ($null -ne $processInfo) {
            return $processInfo
        }
        Start-Sleep -Milliseconds 50
    } while ($watch.Elapsed.TotalMilliseconds -lt $TimeoutMilliseconds)
    return $null
}

function Test-SamePath {
    param(
        [AllowNull()][string]$Left,
        [AllowNull()][string]$Right
    )

    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) {
        return $false
    }
    try {
        $normalizedLeft = [IO.Path]::GetFullPath($Left).TrimEnd("\")
        $normalizedRight = [IO.Path]::GetFullPath($Right).TrimEnd("\")
        return $normalizedLeft.Equals($normalizedRight, [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-ProcessCreatedAt {
    param([AllowNull()]$ProcessInfo)

    if ($null -eq $ProcessInfo -or $null -eq $ProcessInfo.CreationDate) {
        return $null
    }
    $createdAt = if ($ProcessInfo.CreationDate -is [DateTime]) {
        [DateTime]$ProcessInfo.CreationDate
    }
    else {
        [Management.ManagementDateTimeConverter]::ToDateTime([string]$ProcessInfo.CreationDate)
    }
    return $createdAt.ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
}

function Test-ExactProcessIdentity {
    param(
        [AllowNull()]$ProcessInfo,
        [int]$ExpectedProcessId,
        [AllowNull()][string]$ExpectedCreatedAt
    )

    if ($null -eq $ProcessInfo -or
        [int]$ProcessInfo.ProcessId -ne $ExpectedProcessId -or
        [string]::IsNullOrWhiteSpace($ExpectedCreatedAt)) {
        return $false
    }
    try {
        $actual = [DateTimeOffset]::Parse(
            (Get-ProcessCreatedAt -ProcessInfo $ProcessInfo),
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind
        )
        $expected = [DateTimeOffset]::Parse(
            $ExpectedCreatedAt,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind
        )
        return $actual.UtcDateTime.Ticks -eq $expected.UtcDateTime.Ticks
    }
    catch {
        return $false
    }
}

function Test-ProcessDescendsFrom {
    param(
        [int]$ChildProcessId,
        [int]$AncestorProcessId,
        [object[]]$ProcessSnapshot
    )

    if ($ChildProcessId -le 0 -or $AncestorProcessId -le 0 -or $ChildProcessId -eq $AncestorProcessId) {
        return $false
    }
    $seen = @{}
    $currentId = $ChildProcessId
    for ($depth = 0; $depth -lt 64; $depth += 1) {
        if ($seen.ContainsKey($currentId)) {
            return $false
        }
        $seen[$currentId] = $true
        $current = $ProcessSnapshot | Where-Object { [int]$_.ProcessId -eq $currentId } | Select-Object -First 1
        if ($null -eq $current) {
            return $false
        }
        $parentId = [int]$current.ParentProcessId
        if ($parentId -eq $AncestorProcessId) {
            return $true
        }
        if ($parentId -le 0 -or $parentId -eq $currentId) {
            return $false
        }
        $currentId = $parentId
    }
    return $false
}

function Test-DonghaengEndpoint {
    param([string]$Origin)

    try {
        $response = Invoke-WebRequest -Uri ("{0}/" -f $Origin) -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -ne 200) {
            return $false
        }
        $pageMatches = $response.Content.Contains("동행금융AI") -and
            $response.Content.Contains("어떤 화면으로 시작할까요") -and
            $response.Content.Contains("사장님 인터뷰") -and
            $response.Content.Contains("관리자 센터")
        if (-not $pageMatches) {
            return $false
        }
    }
    catch {
        return $false
    }

    # A 401 from the session endpoint is the expected unauthenticated response.
    # It proves the API/database boundary is alive without creating interview data.
    try {
        $sessionResponse = Invoke-WebRequest -Uri ("{0}/api/auth/me" -f $Origin) -UseBasicParsing -TimeoutSec 3
        return $sessionResponse.StatusCode -eq 200
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        return $statusCode -eq 401
    }
}

function Test-ProcessBelongsToRepository {
    param(
        [AllowNull()]$ProcessInfo,
        [string]$RepositoryRoot
    )

    if ($null -eq $ProcessInfo -or [string]::IsNullOrWhiteSpace([string]$ProcessInfo.CommandLine)) {
        return $false
    }
    $normalizedRoot = ([IO.Path]::GetFullPath($RepositoryRoot)).TrimEnd("\").ToLowerInvariant()
    $normalizedCommandLine = ([string]$ProcessInfo.CommandLine).Replace("/", "\").ToLowerInvariant()
    return $normalizedCommandLine.Contains($normalizedRoot + "\") -and
        $normalizedCommandLine.Contains("server.ts") -and
        $normalizedCommandLine.Contains("--dev")
}

function Test-PathWithinDirectory {
    param(
        [AllowNull()][string]$CandidatePath,
        [string]$DirectoryPath
    )

    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return $false
    }
    try {
        $candidate = [IO.Path]::GetFullPath($CandidatePath).TrimEnd("\").ToLowerInvariant()
        $directory = [IO.Path]::GetFullPath($DirectoryPath).TrimEnd("\").ToLowerInvariant()
        return $candidate.StartsWith($directory + "\", [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-LogTail {
    param(
        [string]$StandardOutputLog,
        [string]$StandardErrorLog
    )

    $parts = @()
    if (Test-Path -LiteralPath $StandardOutputLog) {
        $parts += "--- server stdout (마지막 30줄) ---"
        $parts += Get-Content -LiteralPath $StandardOutputLog -Tail 30 -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $StandardErrorLog) {
        $parts += "--- server stderr (마지막 30줄) ---"
        $parts += Get-Content -LiteralPath $StandardErrorLog -Tail 30 -ErrorAction SilentlyContinue
    }
    return ($parts -join [Environment]::NewLine)
}

function Stop-ExactProcessTree {
    param(
        [int]$ProcessId,
        [string]$ProcessCreatedAt
    )

    if ($ProcessId -le 0) {
        return
    }
    $current = Get-ProcessInfo -ProcessId $ProcessId
    if (-not (Test-ExactProcessIdentity -ProcessInfo $current -ExpectedProcessId $ProcessId -ExpectedCreatedAt $ProcessCreatedAt)) {
        throw "PID $ProcessId 의 생성시각이 달라 프로세스 트리를 종료하지 않았습니다."
    }
    $null = & taskkill.exe /PID $ProcessId /T /F 2>$null
    if ($LASTEXITCODE -ne 0 -and $null -ne (Get-ProcessInfo -ProcessId $ProcessId)) {
        throw "PID $ProcessId 프로세스 트리 종료가 코드 $LASTEXITCODE 로 실패했습니다."
    }
}

try {
    $scriptDirectory = if ([string]::IsNullOrWhiteSpace($env:DONGHAENG_LOCAL_SCRIPT_ROOT)) {
        $PSScriptRoot
    }
    else {
        $env:DONGHAENG_LOCAL_SCRIPT_ROOT
    }
    if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
        throw "실행 스크립트 위치를 확인할 수 없습니다. Start-Donghaeng-AI.cmd를 사용해 주세요."
    }
    $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
    $packageJsonPath = Join-Path $repositoryRoot "package.json"
    $serverPath = Join-Path $repositoryRoot "server.ts"
    $lockFilePath = Join-Path $repositoryRoot "package-lock.json"
    $logDirectory = Join-Path $repositoryRoot "data\local-logs"
    $statePath = Join-Path $repositoryRoot "data\local-launcher-state.json"
    $claudeSecretPath = Join-Path $repositoryRoot "data\secrets\anthropic-api-key.dpapi"
    $launchMode = if ($env:DONGHAENG_LAUNCH_MODE -eq "claude") { "claude" } else { "deterministic" }
    $orchestratorProvider = if ($launchMode -eq "claude") { "anthropic" } else { "deterministic" }
    $orchestratorModel = if ($launchMode -eq "claude") { "claude-sonnet-5" } else { "dev-v1" }

    Write-Step "프로젝트 위치를 확인합니다: $repositoryRoot"
    if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $serverPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $lockFilePath -PathType Leaf)) {
        throw "동행금융AI 프로젝트 파일(package.json, package-lock.json, server.ts)을 찾을 수 없습니다. 압축을 푼 프로젝트 폴더 안에서 Start-Donghaeng-AI.cmd를 실행해 주세요."
    }

    $package = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($package.name -ne "donghaeng-finance-ai") {
        throw "현재 폴더가 동행금융AI 프로젝트가 아닙니다. package.json의 name을 확인해 주세요."
    }

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw "Node.js를 찾을 수 없습니다. Node.js 24 이상을 설치한 뒤 다시 실행해 주세요."
    }
    if ($null -eq $npmCommand) {
        throw "npm.cmd를 찾을 수 없습니다. Node.js 설치를 복구한 뒤 다시 실행해 주세요."
    }

    $nodeVersion = (& $nodeCommand.Source -p "process.versions.node").Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^(\d+)\.') {
        throw "Node.js 버전을 확인하지 못했습니다."
    }
    $nodeMajor = [int]$Matches[1]
    if ($nodeMajor -lt 24) {
        throw "Node.js 24 이상이 필요합니다. 현재 버전: v$nodeVersion"
    }
    $npmVersion = (& $npmCommand.Source --version).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($npmVersion)) {
        throw "npm 버전을 확인하지 못했습니다. Node.js 설치를 복구한 뒤 다시 실행해 주세요."
    }
    Write-Step "실행 환경 확인 완료: Node.js v$nodeVersion / npm $npmVersion"

    $tsxCliPath = Join-Path $repositoryRoot "node_modules\tsx\dist\cli.mjs"
    $nextPackagePath = Join-Path $repositoryRoot "node_modules\next\package.json"
    if (-not (Test-Path -LiteralPath $tsxCliPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $nextPackagePath -PathType Leaf)) {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $installTimestamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
        $installStdoutLog = Join-Path $logDirectory ("npm-ci-{0}.out.log" -f $installTimestamp)
        $installStderrLog = Join-Path $logDirectory ("npm-ci-{0}.err.log" -f $installTimestamp)
        Write-Step "필수 패키지가 없어 package-lock.json 기준으로 설치합니다 (최대 $DependencyInstallTimeoutSeconds 초)."
        Write-Notice "패키지 설치 로그: $installStdoutLog / $installStderrLog"
        $installStartInfo = New-Object Diagnostics.ProcessStartInfo
        $installStartInfo.FileName = "cmd.exe"
        $installStartInfo.Arguments = '/d /s /c ""{0}" ci 1>"{1}" 2>"{2}""' -f `
            $npmCommand.Source, $installStdoutLog, $installStderrLog
        $installStartInfo.WorkingDirectory = $repositoryRoot
        $installStartInfo.UseShellExecute = $false
        $installStartInfo.CreateNoWindow = $true
        $installProcess = [Diagnostics.Process]::Start($installStartInfo)
        $installProcessInfo = Get-ProcessInfoWithRetry -ProcessId ([int]$installProcess.Id)
        $installProcessCreatedAt = Get-ProcessCreatedAt -ProcessInfo $installProcessInfo
        if ([string]::IsNullOrWhiteSpace($installProcessCreatedAt)) {
            throw "npm ci 프로세스의 생성시각을 확인하지 못해 설치를 계속하지 않았습니다."
        }
        $installWatch = [Diagnostics.Stopwatch]::StartNew()
        while (-not $installProcess.HasExited -and
            $installWatch.Elapsed.TotalSeconds -lt $DependencyInstallTimeoutSeconds) {
            Start-Sleep -Milliseconds 250
            $installProcess.Refresh()
        }
        if (-not $installProcess.HasExited) {
            Stop-ExactProcessTree `
                -ProcessId ([int]$installProcess.Id) `
                -ProcessCreatedAt $installProcessCreatedAt
            $installTail = Get-LogTail `
                -StandardOutputLog $installStdoutLog `
                -StandardErrorLog $installStderrLog
            throw "npm ci가 $DependencyInstallTimeoutSeconds 초 안에 끝나지 않아 실행기가 시작한 설치 프로세스 트리만 종료했습니다.`n$installTail"
        }
        $installProcess.WaitForExit()
        if ($installProcess.ExitCode -ne 0) {
            $installTail = Get-LogTail `
                -StandardOutputLog $installStdoutLog `
                -StandardErrorLog $installStderrLog
            throw "npm ci가 종료 코드 $($installProcess.ExitCode) 로 실패했습니다. 네트워크와 npm 설정을 확인해 주세요.`n$installTail"
        }
    }

    # The borrower interview must never start in a silent state. The one-click
    # launcher owns the local neural voice readiness check before it opens the
    # application, while the browser keeps a text-only fallback for a runtime
    # network failure after launch.
    Start-LocalKoreanTtsIfNeeded `
        -RepositoryRoot $repositoryRoot `
        -LogDirectory $logDirectory

    $origin = "http://127.0.0.1:$Port"
    $existingState = $null
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $existingState = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        }
        catch {
            throw "기존 서버 상태 파일을 해석할 수 없습니다. 어떤 프로세스도 종료하거나 새로 시작하지 않았습니다: $statePath"
        }
    }

    $listeningProcess = Get-ListeningProcess -ListeningPort $Port
    $launcherOwnedServerReused = $false
    if ($null -ne $listeningProcess) {
        $endpointMatches = Test-DonghaengEndpoint -Origin $origin
        $processMatches = Test-ProcessBelongsToRepository -ProcessInfo $listeningProcess -RepositoryRoot $repositoryRoot
        if (-not ($endpointMatches -and $processMatches)) {
            $processLabel = if ($listeningProcess.Name) { $listeningProcess.Name } else { "알 수 없는 프로세스" }
            throw "포트 $Port 을(를) 다른 프로그램이 사용 중입니다 (PID $($listeningProcess.ProcessId), $processLabel). 해당 프로그램을 종료한 뒤 다시 실행해 주세요. 안전을 위해 다른 앱의 페이지는 열지 않았습니다."
        }

        $listenerProcessId = [int]$listeningProcess.ProcessId
        $listenerProcessCreatedAt = Get-ProcessCreatedAt -ProcessInfo $listeningProcess
        if ([string]::IsNullOrWhiteSpace($listenerProcessCreatedAt)) {
            throw "기존 서버 listener의 생성시각을 확인할 수 없어 재사용하지 않았습니다."
        }

        if ($null -ne $existingState -and [bool]$existingState.ownedByLauncher) {
            if ($existingState.app -ne "donghaeng-finance-ai" -or
                -not (Test-SamePath -Left ([string]$existingState.repositoryRoot) -Right $repositoryRoot) -or
                [string]$existingState.origin -ne $origin -or
                [int]$existingState.port -ne $Port -or
                [string]$existingState.orchestratorProvider -ne $orchestratorProvider -or
                [string]$existingState.orchestratorModel -ne $orchestratorModel) {
                throw "기존 launcher 소유 상태가 현재 프로젝트·origin·port와 일치하지 않아 재사용하지 않았습니다. 어떤 프로세스도 종료하지 않았습니다."
            }
            $serverProcessId = [int]$existingState.processId
            $launcherProcessId = [int]$existingState.launcherProcessId
            $serverProcessCreatedAt = [string]$existingState.processCreatedAt
            if ($serverProcessId -le 0 -or
                $launcherProcessId -ne $serverProcessId -or
                [int]$existingState.listenerProcessId -ne $listenerProcessId -or
                -not (Test-ExactProcessIdentity `
                    -ProcessInfo $listeningProcess `
                    -ExpectedProcessId $listenerProcessId `
                    -ExpectedCreatedAt ([string]$existingState.listenerProcessCreatedAt))) {
                throw "기존 launcher 상태의 root/listener PID 또는 생성시각이 현재 서버와 달라 재사용하지 않았습니다. 어떤 프로세스도 종료하지 않았습니다."
            }
            $serverProcessInfo = Get-ProcessInfo -ProcessId $serverProcessId
            if (-not (Test-ExactProcessIdentity `
                -ProcessInfo $serverProcessInfo `
                -ExpectedProcessId $serverProcessId `
                -ExpectedCreatedAt $serverProcessCreatedAt)) {
                throw "기존 launcher root PID의 생성시각이 달라 재사용하지 않았습니다. 어떤 프로세스도 종료하지 않았습니다."
            }
            $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
            if (-not (Test-ProcessDescendsFrom `
                -ChildProcessId $listenerProcessId `
                -AncestorProcessId $serverProcessId `
                -ProcessSnapshot $processSnapshot)) {
                throw "현재 listener가 기록된 launcher root의 자식 트리가 아니어서 재사용하지 않았습니다. 어떤 프로세스도 종료하지 않았습니다."
            }
            if (-not (Test-PathWithinDirectory -CandidatePath ([string]$existingState.stdoutLog) -DirectoryPath $logDirectory) -or
                -not (Test-PathWithinDirectory -CandidatePath ([string]$existingState.stderrLog) -DirectoryPath $logDirectory)) {
                throw "기존 launcher 로그 경로가 data\local-logs 밖을 가리켜 재사용하지 않았습니다."
            }

            $serverWasStartedHere = $true
            $launcherOwnedServerReused = $true
            $stateStartedAt = [string]$existingState.startedAt
            $stdoutLog = [string]$existingState.stdoutLog
            $stderrLog = [string]$existingState.stderrLog
            Write-Step "이 실행기가 시작한 기존 서버의 root·listener 생성시각과 자식 계층을 확인했습니다 (root PID $serverProcessId, listener PID $listenerProcessId)."
        }
        else {
            if ($launchMode -eq "claude") {
                throw "이미 실행 중인 외부 개발 서버의 Claude provider를 검증할 수 없어 재사용하지 않았습니다. 기존 서버를 종료한 뒤 Start-Donghaeng-AI-Claude.cmd를 다시 실행하세요."
            }
            $serverWasStartedHere = $false
            $serverProcessId = $listenerProcessId
            $serverProcessCreatedAt = $listenerProcessCreatedAt
            $launcherProcessId = $null
            $stateStartedAt = (Get-Date).ToString("o")
            $stdoutLog = $null
            $stderrLog = $null
            Write-Step "이미 실행 중인 이 프로젝트의 외부 개발 서버를 확인했습니다 (listener PID $listenerProcessId)."
        }
    }
    else {
        if ($null -ne $existingState -and [bool]$existingState.ownedByLauncher) {
            $recordedProcessId = [int]$existingState.processId
            $recordedProcess = Get-ProcessInfo -ProcessId $recordedProcessId
            if (Test-ExactProcessIdentity `
                -ProcessInfo $recordedProcess `
                -ExpectedProcessId $recordedProcessId `
                -ExpectedCreatedAt ([string]$existingState.processCreatedAt)) {
                throw "launcher 상태에 기록된 root PID $recordedProcessId 가 아직 살아 있지만 포트 $Port 에서 검증된 listener를 찾지 못했습니다. 중복 실행하지 않았습니다."
            }
        }

        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
        $stdoutLog = Join-Path $logDirectory ("server-{0}.out.log" -f $timestamp)
        $stderrLog = Join-Path $logDirectory ("server-{0}.err.log" -f $timestamp)

        # The local workspace launch is isolated from unrelated
        # DONGHAENG_* variables in its shell. These values stay inside this process
        # and the child server process.
        $env:NODE_ENV = "development"
        $env:DONGHAENG_HOST = "127.0.0.1"
        $env:DONGHAENG_PORT = [string]$Port
        $env:DONGHAENG_APP_ORIGIN = $origin
        $env:DONGHAENG_DB_PATH = "data/donghaeng-ai.db"
        $env:DONGHAENG_LOCAL_BOOTSTRAP = "1"
        Remove-Item Env:DONGHAENG_LOCAL_PASSWORD -ErrorAction SilentlyContinue
        # The local workspace must not turn arbitrary microphone input into a
        # scripted answer. The local loopback faster-whisper bridge is optional
        # and can be started with Start-Local-Korean-STT.cmd; when it is not
        # running, the mic reports a clear error and chat remains available.
        $env:DONGHAENG_STT_PROVIDER = "openai-compatible"
        $env:DONGHAENG_STT_ENDPOINT = "http://127.0.0.1:8765/v1/audio/transcriptions"
        $env:DONGHAENG_STT_API_KEY = "local-voice-runtime"
        $env:DONGHAENG_STT_MODEL = "large-v3-turbo"
        $env:DONGHAENG_ORCHESTRATOR_PROVIDER = $orchestratorProvider
        $env:DONGHAENG_ANTHROPIC_MODEL = $orchestratorModel
        if ($launchMode -eq "claude") {
            Import-ClaudeApiKey -SecretPath $claudeSecretPath
        }
        else {
            Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
        }

        Write-Step "Next.js와 실시간 WebSocket을 포함한 custom dev server를 시작합니다."
        $serverProcess = Start-Process `
            -FilePath $npmCommand.Source `
            -ArgumentList @("run", "dev") `
            -WorkingDirectory $repositoryRoot `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -WindowStyle Hidden `
            -PassThru
        $serverWasStartedHere = $true
        $launcherProcessId = [int]$serverProcess.Id
        $serverProcessId = $launcherProcessId
        $serverProcessInfo = Get-ProcessInfoWithRetry -ProcessId $serverProcessId
        $serverProcessCreatedAt = Get-ProcessCreatedAt -ProcessInfo $serverProcessInfo
        if ([string]::IsNullOrWhiteSpace($serverProcessCreatedAt)) {
            throw "시작한 서버 root 프로세스의 생성시각을 확인하지 못했습니다. 상태 파일을 만들지 않았습니다."
        }
        $stateStartedAt = (Get-Date).ToString("o")

        Write-Step "서버 준비를 기다립니다 (최대 $TimeoutSeconds 초)."
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $ready = $false
        while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
            $serverProcess.Refresh()
            if ($serverProcess.HasExited) {
                $tail = Get-LogTail -StandardOutputLog $stdoutLog -StandardErrorLog $stderrLog
                throw "서버가 준비되기 전에 종료됐습니다 (종료 코드 $($serverProcess.ExitCode)).`n$tail"
            }
            $candidateListener = Get-ListeningProcess -ListeningPort $Port
            if ($null -ne $candidateListener) {
                $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
                $candidateBelongsToTree = Test-ProcessDescendsFrom `
                    -ChildProcessId ([int]$candidateListener.ProcessId) `
                    -AncestorProcessId $serverProcessId `
                    -ProcessSnapshot $processSnapshot
                $candidateBelongsToRepository = Test-ProcessBelongsToRepository `
                    -ProcessInfo $candidateListener `
                    -RepositoryRoot $repositoryRoot
                if (-not ($candidateBelongsToTree -and $candidateBelongsToRepository)) {
                    Stop-ExactProcessTree -ProcessId $serverProcessId -ProcessCreatedAt $serverProcessCreatedAt
                    throw "포트 $Port 의 listener가 방금 시작한 launcher root의 검증된 자식이 아니어서 launcher 프로세스만 종료했습니다."
                }
                if (Test-DonghaengEndpoint -Origin $origin) {
                    $listeningProcess = $candidateListener
                    $listenerProcessId = [int]$candidateListener.ProcessId
                    $listenerProcessCreatedAt = Get-ProcessCreatedAt -ProcessInfo $candidateListener
                    $ready = -not [string]::IsNullOrWhiteSpace($listenerProcessCreatedAt)
                    if ($ready) {
                        break
                    }
                }
            }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) {
            Stop-ExactProcessTree -ProcessId $serverProcessId -ProcessCreatedAt $serverProcessCreatedAt
            $tail = Get-LogTail -StandardOutputLog $stdoutLog -StandardErrorLog $stderrLog
            throw "서버가 $TimeoutSeconds 초 안에 준비되지 않았습니다.`n$tail"
        }
    }

    $state = [ordered]@{
        app = "donghaeng-finance-ai"
        repositoryRoot = $repositoryRoot
        origin = $origin
        port = $Port
        processId = $serverProcessId
        processCreatedAt = $serverProcessCreatedAt
        launcherProcessId = $launcherProcessId
        listenerProcessId = $listenerProcessId
        listenerProcessCreatedAt = $listenerProcessCreatedAt
        ownedByLauncher = $serverWasStartedHere
        orchestratorProvider = $orchestratorProvider
        orchestratorModel = $orchestratorModel
        startedAt = $stateStartedAt
        stdoutLog = $stdoutLog
        stderrLog = $stderrLog
    }
    $stateTemporaryPath = "{0}.{1}.tmp" -f $statePath, $PID
    try {
        $state | ConvertTo-Json | Set-Content -LiteralPath $stateTemporaryPath -Encoding UTF8
        Move-Item -LiteralPath $stateTemporaryPath -Destination $statePath -Force
    }
    finally {
        if (Test-Path -LiteralPath $stateTemporaryPath) {
            Remove-Item -LiteralPath $stateTemporaryPath -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  동행금융AI 로컬 작업공간 준비 완료" -ForegroundColor Green
    Write-Host "  화면: $origin/" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    if ($launchMode -eq "claude") {
        Write-Notice "텍스트 답변의 정보 추출·후속질문 계획은 Claude $orchestratorModel 실 API를 사용합니다. 키는 DPAPI 암호문에서 child process 환경으로만 주입됩니다."
        Write-Notice "Claude는 인터뷰 문장 구조화에 사용됩니다. 마이크는 127.0.0.1의 로컬 faster-whisper STT만 사용하며, 준비되지 않으면 임의 전사 없이 채팅으로 전환됩니다."
    }
    elseif ($serverWasStartedHere) {
        Write-Notice "마이크는 로컬 faster-whisper STT를 사용하도록 설정되었습니다. Start-Local-Korean-STT.cmd가 준비되지 않았다면 채팅으로 계속할 수 있습니다."
    }
    else {
        Write-Notice "기존 서버를 재사용했습니다. 음성 제공자는 인터뷰 화면의 STT 제공자 표시를 확인하세요. 임의 전사는 기본으로 사용하지 않습니다."
    }
    Write-Notice "실제 음성 인식은 Start-Local-Korean-STT.cmd로 GPU Whisper 모델을 켠 뒤 이용합니다. AI 질문 음성(Qwen3-TTS Sohee)은 이 원클릭 실행기가 준비했습니다."
    Write-Notice "처음 한 번은 .\scripts\setup-local-korean-stt.ps1 -DownloadModel 및 .\scripts\setup-local-korean-tts.ps1 -DownloadModel 을 실행해 로컬 음성 모델을 준비하세요."
    Write-Notice "작업을 마치면 scripts\Stop-Donghaeng-AI.cmd를 실행하세요. 이미 떠 있던 개발 서버를 재사용한 경우에는 원래 서버 창에서 Ctrl+C로 종료해야 합니다."
    if ($stdoutLog) {
        Write-Notice "서버 로그: $stdoutLog / $stderrLog"
    }
    Write-Host ""

    if (-not $NoBrowser) {
        Start-Process ("{0}/" -f $origin)
    }
    exit 0
}
catch {
    Write-Host ""
    Write-Host ("[오류] {0}" -f $_.Exception.Message) -ForegroundColor Red
    Write-Host "[도움말] README.md의 '로컬 실행' 절을 확인해 주세요." -ForegroundColor Yellow
    exit 1
}
