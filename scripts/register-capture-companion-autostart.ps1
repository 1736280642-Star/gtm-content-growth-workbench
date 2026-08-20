$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopScript = Join-Path $PSScriptRoot "capture-runner-desktop.ps1"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "JOTO AI Capture Companion.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$desktopScript`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "JOTO AI Capture Companion"
$shortcut.Save()
Write-Output "capture_companion_autostart=registered"
