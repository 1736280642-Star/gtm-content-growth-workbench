@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-full-production.ps1" %*
exit /b %ERRORLEVEL%
