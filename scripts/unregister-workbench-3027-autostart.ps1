$ErrorActionPreference = "Stop"
$taskName = "JOTO-GTM-Workbench-3027"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Host "Autostart task is not registered: $taskName"
  exit 0
}
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed Windows logon task: $taskName"
