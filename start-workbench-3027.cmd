@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-workbench-3027.ps1"
if errorlevel 1 pause
endlocal
