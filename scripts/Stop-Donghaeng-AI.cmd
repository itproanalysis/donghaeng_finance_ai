@echo off
setlocal
chcp 65001 > nul
title Donghaeng Finance AI Local Workspace Stopper

set "DONGHAENG_STOPPER=%~dp0stop-local-workspace.ps1"
set "DONGHAENG_LOCAL_SCRIPT_ROOT=%~dp0"
set "DONGHAENG_LOCAL_SCRIPT_FILE=%DONGHAENG_STOPPER%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$source = Get-Content -LiteralPath $env:DONGHAENG_LOCAL_SCRIPT_FILE -Raw -Encoding UTF8; & ([ScriptBlock]::Create($source))"
set "DONGHAENG_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %DONGHAENG_EXIT_CODE%
