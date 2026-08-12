@echo off
setlocal
chcp 65001 > nul
title Donghaeng Finance AI Claude Key Setup

set "DONGHAENG_REPO=%~dp0"
set "DONGHAENG_CONFIGURATOR=%DONGHAENG_REPO%scripts\configure-claude-key.ps1"

if not exist "%DONGHAENG_CONFIGURATOR%" (
    echo [ERROR] Claude key configurator was not found.
    echo         %DONGHAENG_CONFIGURATOR%
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%DONGHAENG_CONFIGURATOR%"
set "DONGHAENG_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %DONGHAENG_EXIT_CODE%
