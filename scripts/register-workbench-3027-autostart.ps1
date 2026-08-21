param([switch]$RunNow)

$ErrorActionPreference = "Stop"
$taskName = "JOTO-GTM-Workbench-3027"
$launcher = Join-Path $PSScriptRoot "ensure-workbench-3027.ps1"
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -NoOpen"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Start the existing JOTO GTM Workbench on port 3027 and its loopback channel publishing companions without rebuilding images." `
  -Force | Out-Null

Write-Host "Registered Windows logon task: $taskName"
Write-Host "The same task also ensures Wechatsync Bridge and Arcs Runner are running."
Write-Host "Daily launcher: npm.cmd run docker:3027"
Write-Host "Explicit deployment only: npm.cmd run docker:3027:deploy"

if ($RunNow) {
  Start-ScheduledTask -TaskName $taskName
  Write-Host "The startup task was triggered once."
}
