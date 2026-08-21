param([switch]$NoOpen)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "workbench-3027-common.ps1")

Set-Location $projectRoot
$startupLock = $null
try {
  $startupLock = Enter-WorkbenchStartupLock
  Start-DockerEngine

  Write-WorkbenchStep "Building production images because an explicit deployment was requested."
  Build-WorkbenchProductionImages
  Invoke-WorkbenchCompose -Arguments @(
    "-f", "compose.yaml",
    "--profile", "full",
    "up", "-d", "--no-build"
  )
  Wait-WorkbenchReady
  Assert-WorkbenchProductionMode
  Ensure-WorkbenchChannelPublishCompanions
  Write-WorkbenchStep "Deployment completed. Future daily starts reuse these images without rebuilding."
} finally {
  Exit-WorkbenchStartupLock -Mutex $startupLock
}

if (-not $NoOpen) {
  Start-Process "http://127.0.0.1:3027/" | Out-Null
}
