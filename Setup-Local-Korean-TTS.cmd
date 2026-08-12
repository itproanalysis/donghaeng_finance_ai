@echo off
setlocal
chcp 65001 > nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local-korean-tts.ps1" -DownloadModel %*
endlocal
