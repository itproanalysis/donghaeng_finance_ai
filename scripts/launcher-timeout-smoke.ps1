[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceLauncher = Join-Path $repositoryRoot "scripts\start-local-workspace.ps1"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("donghaeng-launcher-timeout-{0}" -f [Guid]::NewGuid().ToString("N"))
$previousPath = $env:PATH
$previousScriptRoot = $env:DONGHAENG_LOCAL_SCRIPT_ROOT
$previousScriptFile = $env:DONGHAENG_LOCAL_SCRIPT_FILE
$previousNoBrowser = $env:DONGHAENG_LOCAL_NO_BROWSER

try {
    $fixtureScripts = Join-Path $temporaryRoot "scripts"
    $fixtureBin = Join-Path $temporaryRoot "fake-bin"
    New-Item -ItemType Directory -Path $fixtureScripts, $fixtureBin -Force | Out-Null
    Copy-Item -LiteralPath $sourceLauncher -Destination (Join-Path $fixtureScripts "start-local-workspace.ps1")
    [IO.File]::WriteAllText(
        (Join-Path $temporaryRoot "package.json"),
        '{"name":"donghaeng-finance-ai"}',
        (New-Object Text.UTF8Encoding($false))
    )
    [IO.File]::WriteAllText(
        (Join-Path $temporaryRoot "package-lock.json"),
        '{}',
        (New-Object Text.UTF8Encoding($false))
    )
    [IO.File]::WriteAllText(
        (Join-Path $temporaryRoot "server.ts"),
        '// launcher timeout fixture',
        (New-Object Text.UTF8Encoding($false))
    )
    $fakeNpm = @'
@echo off
if "%~1"=="--version" (
  echo 11.12.1
  exit /b 0
)
if "%~1"=="ci" (
  powershell.exe -NoLogo -NoProfile -Command "Start-Sleep -Seconds 60"
  exit /b %ERRORLEVEL%
)
exit /b 2
'@
    [IO.File]::WriteAllText(
        (Join-Path $fixtureBin "npm.cmd"),
        $fakeNpm,
        (New-Object Text.ASCIIEncoding)
    )
    $runnerPath = Join-Path $temporaryRoot "run-launcher.ps1"
    $runner = @'
$source = Get-Content -LiteralPath $env:DONGHAENG_LOCAL_SCRIPT_FILE -Raw -Encoding UTF8
& ([ScriptBlock]::Create($source)) -NoBrowser -TimeoutSeconds 10 -DependencyInstallTimeoutSeconds 2
'@
    [IO.File]::WriteAllText($runnerPath, $runner, (New-Object Text.ASCIIEncoding))

    $env:PATH = "{0};{1}" -f $fixtureBin, $previousPath
    $env:DONGHAENG_LOCAL_SCRIPT_ROOT = $fixtureScripts
    $env:DONGHAENG_LOCAL_SCRIPT_FILE = Join-Path $fixtureScripts "start-local-workspace.ps1"
    $env:DONGHAENG_LOCAL_NO_BROWSER = "1"
    $launcherStartInfo = New-Object Diagnostics.ProcessStartInfo
    $launcherStartInfo.FileName = "powershell.exe"
    $launcherStartInfo.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $runnerPath
    $launcherStartInfo.UseShellExecute = $false
    $launcherStartInfo.CreateNoWindow = $true
    $launcherStartInfo.RedirectStandardOutput = $true
    $launcherStartInfo.RedirectStandardError = $true
    $launcherStartInfo.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $launcherStartInfo.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $launcher = [Diagnostics.Process]::Start($launcherStartInfo)
    if (-not $launcher.WaitForExit(20000)) {
        $null = & taskkill.exe /PID $launcher.Id /T /F 2>$null
        throw "timeout smoke harness itself exceeded 20 seconds"
    }
    $launcher.WaitForExit()
    $launcherOutput = $launcher.StandardOutput.ReadToEnd()
    $launcherErrorOutput = $launcher.StandardError.ReadToEnd()
    $launcherExitCode = $launcher.ExitCode
    $watch.Stop()
    if ($launcherExitCode -ne 1) {
        throw "expected launcher exit 1, received $launcherExitCode`: $launcherErrorOutput"
    }
    if (-not $launcherOutput.Contains("npm ci") -or
        -not $launcherOutput.Contains("2 ") -or
        -not $launcherOutput.Contains("data\local-logs")) {
        throw "launcher did not report its bounded npm ci timeout"
    }
    $installLogs = @(Get-ChildItem -LiteralPath (Join-Path $temporaryRoot "data\local-logs") -Filter "npm-ci-*.log")
    if ($installLogs.Count -ne 2) {
        throw "expected two npm ci logs, found $($installLogs.Count)"
    }
    Start-Sleep -Milliseconds 300
    $fixtureProcesses = @(
        Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { ([string]$_.CommandLine).Contains($temporaryRoot) }
    )
    if ($fixtureProcesses.Count -ne 0) {
        throw "npm ci timeout left fixture process IDs: $($fixtureProcesses.ProcessId -join ', ')"
    }
    if ($watch.Elapsed.TotalSeconds -gt 15) {
        throw "bounded npm ci timeout took too long: $([Math]::Round($watch.Elapsed.TotalSeconds, 2)) seconds"
    }
    Write-Output "LAUNCHER TIMEOUT PASS: exit=1, elapsed=$([Math]::Round($watch.Elapsed.TotalSeconds, 2))s, logs=2, leakedProcesses=0"
}
finally {
    $env:PATH = $previousPath
    $env:DONGHAENG_LOCAL_SCRIPT_ROOT = $previousScriptRoot
    $env:DONGHAENG_LOCAL_SCRIPT_FILE = $previousScriptFile
    $env:DONGHAENG_LOCAL_NO_BROWSER = $previousNoBrowser
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
    $resolvedSystemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTemporaryRoot.StartsWith($resolvedSystemTemp, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolvedTemporaryRoot).StartsWith("donghaeng-launcher-timeout-", [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
