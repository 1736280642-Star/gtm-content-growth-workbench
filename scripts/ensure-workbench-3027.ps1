param([switch]$NoOpen)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "workbench-3027-common.ps1")

Set-Location $projectRoot
$startupLock = $null
try {
  $startupLock = Enter-WorkbenchStartupLock

  if ((Test-DockerReady) -and (Test-WorkbenchHttpReady) -and (Test-WorkbenchProductionMode)) {
    Write-WorkbenchStep "Production workbench is already healthy; nothing was rebuilt or restarted."
  } else {
    Start-DockerEngine
    Assert-WorkbenchProductionImagesAvailable
    Write-WorkbenchStep "Starting existing production containers without building images."
    Invoke-WorkbenchCompose -Arguments @(
      "-f", "compose.yaml",
      "--profile", "full",
      "up", "-d", "--no-build", "--pull", "never"
    )
    Wait-WorkbenchReady
    Assert-WorkbenchProductionMode
  }
} finally {
  Exit-WorkbenchStartupLock -Mutex $startupLock
}

if (-not $NoOpen) {
  Start-Process "http://127.0.0.1:3027/" | Out-Null
}
