@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local-korean-stt.ps1" -DownloadModel %*
endlocal
