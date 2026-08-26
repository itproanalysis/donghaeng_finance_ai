@echo off
setlocal
chcp 65001 > nul
title Donghaeng Finance AI OpenAI Realtime Key Setup

set "DONGHAENG_REPO=%~dp0"
set "DONGHAENG_CONFIGURATOR=%DONGHAENG_REPO%scripts\configure-openai-key.ps1"

if not exist "%DONGHAENG_CONFIGURATOR%" (
    echo [ERROR] OpenAI key configurator was not found.
    echo         %DONGHAENG_CONFIGURATOR%
    pause
    exit /b 1
)

where pwsh.exe > nul 2>&1
if %ERRORLEVEL% EQU 0 (
    pwsh.exe -NoLogo -NoProfile -Sta -ExecutionPolicy Bypass -File "%DONGHAENG_CONFIGURATOR%"
) else (
    set "DONGHAENG_CONFIGURATOR_FILE=%DONGHAENG_CONFIGURATOR%"
    powershell.exe -NoLogo -NoProfile -Sta -ExecutionPolicy Bypass -Command "$source = Get-Content -LiteralPath $env:DONGHAENG_CONFIGURATOR_FILE -Raw -Encoding UTF8; & ([ScriptBlock]::Create($source))"
)
set "DONGHAENG_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %DONGHAENG_EXIT_CODE%
