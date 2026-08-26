@echo off
setlocal
chcp 65001 > nul
title Donghaeng Finance AI Claude Launcher

set "DONGHAENG_REPO=%~dp0"
set "DONGHAENG_STARTER=%DONGHAENG_REPO%scripts\start-local-workspace.ps1"
set "DONGHAENG_LOCAL_SCRIPT_ROOT=%DONGHAENG_REPO%scripts"
set "DONGHAENG_LOCAL_SCRIPT_FILE=%DONGHAENG_STARTER%"
set "DONGHAENG_LAUNCH_MODE=claude"
set "DONGHAENG_ANTHROPIC_MODEL=claude-sonnet-5"
for %%A in (%*) do (
    if /I "%%~A"=="--no-browser" set "DONGHAENG_LOCAL_NO_BROWSER=1"
    if /I "%%~A"=="--fast" set "DONGHAENG_ANTHROPIC_MODEL=claude-haiku-4-5-20251001"
    if /I "%%~A"=="--quality" set "DONGHAENG_ANTHROPIC_MODEL=claude-sonnet-5"
)

if not exist "%DONGHAENG_STARTER%" (
    echo [ERROR] Claude launcher script was not found.
    echo         %DONGHAENG_STARTER%
    pause
    exit /b 1
)

where pwsh.exe > nul 2>&1
if not errorlevel 1 (
    pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$source = Get-Content -LiteralPath $env:DONGHAENG_LOCAL_SCRIPT_FILE -Raw -Encoding UTF8; & ([ScriptBlock]::Create($source))"
) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$source = Get-Content -LiteralPath $env:DONGHAENG_LOCAL_SCRIPT_FILE -Raw -Encoding UTF8; & ([ScriptBlock]::Create($source))"
)
set "DONGHAENG_EXIT_CODE=%ERRORLEVEL%"

if not "%DONGHAENG_EXIT_CODE%"=="0" (
    echo.
    echo [FAILED] Review the Korean error above and the displayed log paths.
    pause
)

exit /b %DONGHAENG_EXIT_CODE%
