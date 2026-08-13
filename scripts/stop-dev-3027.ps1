$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "workbench-3027-common.ps1")

Set-Location $projectRoot

if (-not (Test-DockerReady)) {
  Write-WorkbenchStep "Docker engine is not running; port 3027 is already released by the Docker stack."
  exit 0
}

Write-WorkbenchStep "Stopping the development Web and Worker services. MySQL and OpenSearch remain available."
Invoke-WorkbenchCompose -Arguments @(
  "-f", "compose.yaml",
  "-f", "compose.dev-3027.yaml",
  "--profile", "full",
  "stop",
  "workbench-web",
  "rag-index-worker",
  "knowledge-worker",
  "content-worker",
  "monitor-worker",
  "publish-worker"
)
Write-WorkbenchStep "Development services stopped. Port 3027 is released."
