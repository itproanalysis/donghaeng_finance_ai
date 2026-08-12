[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

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
        throw "포트 $ListeningPort 의 listener 소유 프로세스를 하나로 확정할 수 없어 어떤 프로세스도 종료하지 않았습니다."
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

function Test-PathWithinDirectory {
    param(
        [AllowNull()][string]$CandidatePath,
        [string]$DirectoryPath
    )

    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return $false
    }
    try {
        $candidate = [IO.Path]::GetFullPath($CandidatePath).TrimEnd("\")
        $directory = [IO.Path]::GetFullPath($DirectoryPath).TrimEnd("\")
        return $candidate.StartsWith($directory + "\", [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
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
        if ($response.StatusCode -ne 200 -or
            -not $response.Content.Contains("동행금융AI") -or
            -not $response.Content.Contains("어떤 화면으로 시작할까요") -or
            -not $response.Content.Contains("사장님 인터뷰") -or
            -not $response.Content.Contains("관리자 센터")) {
            return $false
        }
    }
    catch {
        return $false
    }
    try {
        $sessionResponse = Invoke-WebRequest -Uri ("{0}/api/auth/me" -f $Origin) -UseBasicParsing -TimeoutSec 3
        return $sessionResponse.StatusCode -eq 200
    }
    catch {
        return $_.Exception.Response.StatusCode.value__ -eq 401
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
        throw "실행 스크립트 위치를 확인할 수 없습니다. Stop-Donghaeng-AI.cmd를 사용해 주세요."
    }
    $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
    $statePath = Join-Path $repositoryRoot "data\local-launcher-state.json"
    $logDirectory = Join-Path $repositoryRoot "data\local-logs"
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        Write-Host "[안내] 원클릭 실행기가 시작한 서버 기록이 없습니다." -ForegroundColor Yellow
        Write-Host "       서버를 터미널에서 직접 실행했다면 해당 터미널에서 Ctrl+C를 누르세요."
        exit 0
    }

    try {
        $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "서버 상태 파일을 해석할 수 없어 어떤 프로세스도 종료하지 않았습니다."
    }
    if ($state.app -ne "donghaeng-finance-ai" -or
        -not (Test-SamePath -Left ([string]$state.repositoryRoot) -Right $repositoryRoot)) {
        throw "서버 상태 파일이 현재 프로젝트와 일치하지 않아 어떤 프로세스도 종료하지 않았습니다."
    }
    if (-not [bool]$state.ownedByLauncher) {
        Write-Host "[안내] 이번 시연은 이미 실행 중이던 개발 서버를 재사용했습니다." -ForegroundColor Yellow
        Write-Host "       안전을 위해 해당 서버를 자동 종료하지 않습니다. 원래 서버 창에서 Ctrl+C를 누르세요."
        exit 0
    }

    $port = [int]$state.port
    $expectedOrigin = "http://127.0.0.1:$port"
    $processId = [int]$state.processId
    $launcherProcessId = [int]$state.launcherProcessId
    $listenerProcessId = [int]$state.listenerProcessId
    $processCreatedAt = [string]$state.processCreatedAt
    $listenerProcessCreatedAt = [string]$state.listenerProcessCreatedAt
    if ($port -lt 1024 -or $port -gt 65535 -or
        [string]$state.origin -ne $expectedOrigin -or
        $processId -le 0 -or
        $launcherProcessId -ne $processId -or
        $listenerProcessId -le 0 -or
        [string]::IsNullOrWhiteSpace($processCreatedAt) -or
        [string]::IsNullOrWhiteSpace($listenerProcessCreatedAt)) {
        throw "서버 상태의 origin·port·launcher root·listener 식별자가 완전하지 않아 어떤 프로세스도 종료하지 않았습니다."
    }
    if (-not (Test-PathWithinDirectory -CandidatePath ([string]$state.stdoutLog) -DirectoryPath $logDirectory) -or
        -not (Test-PathWithinDirectory -CandidatePath ([string]$state.stderrLog) -DirectoryPath $logDirectory)) {
        throw "서버 상태의 로그 경로가 현재 프로젝트의 data\local-logs 밖을 가리켜 어떤 프로세스도 종료하지 않았습니다."
    }

    $processInfo = Get-ProcessInfo -ProcessId $processId
    if (-not (Test-ExactProcessIdentity `
        -ProcessInfo $processInfo `
        -ExpectedProcessId $processId `
        -ExpectedCreatedAt $processCreatedAt)) {
        throw "저장된 launcher root PID $processId 가 없거나 생성시각이 달라 stale/PID 재사용 상태로 판단했습니다. 어떤 프로세스도 종료하지 않았습니다."
    }
    $rootCommandLine = ([string]$processInfo.CommandLine).Replace("/", "\").ToLowerInvariant()
    if ($processInfo.Name -ine "cmd.exe" -or
        -not $rootCommandLine.Contains("\npm.cmd") -or
        $rootCommandLine -notmatch '(?i)\brun\s+dev(?:\s|"|$)') {
        throw "launcher root PID $processId 의 실행 명령이 npm.cmd run dev와 일치하지 않아 어떤 프로세스도 종료하지 않았습니다."
    }

    $listenerProcess = Get-ProcessInfo -ProcessId $listenerProcessId
    if (-not (Test-ExactProcessIdentity `
        -ProcessInfo $listenerProcess `
        -ExpectedProcessId $listenerProcessId `
        -ExpectedCreatedAt $listenerProcessCreatedAt)) {
        throw "저장된 listener PID $listenerProcessId 가 없거나 생성시각이 달라 어떤 프로세스도 종료하지 않았습니다."
    }
    $portListener = Get-ListeningProcess -ListeningPort $port
    if (-not (Test-ExactProcessIdentity `
        -ProcessInfo $portListener `
        -ExpectedProcessId $listenerProcessId `
        -ExpectedCreatedAt $listenerProcessCreatedAt)) {
        throw "포트 $port 의 현재 listener가 저장된 listener와 정확히 일치하지 않아 어떤 프로세스도 종료하지 않았습니다."
    }
    if (-not (Test-ProcessBelongsToRepository -ProcessInfo $listenerProcess -RepositoryRoot $repositoryRoot)) {
        throw "listener 명령행이 현재 프로젝트의 server.ts --dev를 가리키지 않아 어떤 프로세스도 종료하지 않았습니다."
    }
    $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    if (-not (Test-ProcessDescendsFrom `
        -ChildProcessId $listenerProcessId `
        -AncestorProcessId $launcherProcessId `
        -ProcessSnapshot $processSnapshot)) {
        throw "listener가 저장된 launcher root의 현재 자식 트리가 아니어서 어떤 프로세스도 종료하지 않았습니다."
    }
    if (-not (Test-DonghaengEndpoint -Origin $expectedOrigin)) {
        throw "포트 $port 의 HTTP/API endpoint가 동행금융AI 시연 서버로 확인되지 않아 어떤 프로세스도 종료하지 않았습니다."
    }

    # Close the PID-reuse window as far as taskkill permits by re-reading both
    # endpoints and their ancestry immediately before issuing the tree kill.
    $processInfo = Get-ProcessInfo -ProcessId $processId
    $listenerProcess = Get-ProcessInfo -ProcessId $listenerProcessId
    $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    if (-not (Test-ExactProcessIdentity -ProcessInfo $processInfo -ExpectedProcessId $processId -ExpectedCreatedAt $processCreatedAt) -or
        -not (Test-ExactProcessIdentity -ProcessInfo $listenerProcess -ExpectedProcessId $listenerProcessId -ExpectedCreatedAt $listenerProcessCreatedAt) -or
        -not (Test-ProcessDescendsFrom -ChildProcessId $listenerProcessId -AncestorProcessId $launcherProcessId -ProcessSnapshot $processSnapshot)) {
        throw "종료 직전 프로세스 식별자가 바뀌어 어떤 프로세스도 종료하지 않았습니다."
    }

    Write-Host "[동행금융AI] 검증된 launcher root 프로세스 트리를 종료합니다 (root PID $processId, listener PID $listenerProcessId)." -ForegroundColor Cyan
    $null = & taskkill.exe /PID $processId /T /F 2>$null
    $taskkillExitCode = $LASTEXITCODE
    $stopWatch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $rootStillMatches = Test-ExactProcessIdentity `
            -ProcessInfo (Get-ProcessInfo -ProcessId $processId) `
            -ExpectedProcessId $processId `
            -ExpectedCreatedAt $processCreatedAt
        $listenerStillMatches = Test-ExactProcessIdentity `
            -ProcessInfo (Get-ProcessInfo -ProcessId $listenerProcessId) `
            -ExpectedProcessId $listenerProcessId `
            -ExpectedCreatedAt $listenerProcessCreatedAt
        if (-not $rootStillMatches -and -not $listenerStillMatches) {
            break
        }
        Start-Sleep -Milliseconds 100
    } while ($stopWatch.Elapsed.TotalSeconds -lt 10)
    if ($taskkillExitCode -ne 0 -or $rootStillMatches -or $listenerStillMatches) {
        throw "검증된 서버 트리 종료를 확인하지 못했습니다 (taskkill 코드 $taskkillExitCode). 상태 파일을 보존합니다."
    }
    Remove-Item -LiteralPath $statePath -Force
    Write-Host "[완료] 원클릭 실행기가 시작한 서버를 종료했습니다. 서버 로그는 data\local-logs에 남아 있습니다." -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ("[오류] {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}
