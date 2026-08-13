param([switch]$NoOpen)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "workbench-3027-common.ps1")

Set-Location $projectRoot
Start-DockerEngine

Write-WorkbenchStep "Removing the previous 3027 mode without deleting persistent volumes."
Invoke-WorkbenchCompose -Arguments @(
  "-f", "compose.yaml",
  "-f", "compose.dev-3027.yaml",
  "--profile", "full",
  "down", "--remove-orphans"
)

Write-WorkbenchStep "Building and switching port 3027 to the production-like Docker stack."
Build-WorkbenchProductionImages
Invoke-WorkbenchCompose -Arguments @(
  "-f", "compose.yaml",
  "--profile", "full",
  "up", "-d", "--no-build"
)

$logsCommand = "docker compose -f compose.yaml --profile full logs -f --tail 200 workbench-web rag-index-worker knowledge-worker content-worker monitor-worker publish-worker"
Write-WorkbenchStep "Logs: $logsCommand"
Wait-WorkbenchReady
Assert-WorkbenchProductionMode

Write-WorkbenchStep "Mode: production-like Next.js standalone image."
Write-WorkbenchStep "Return to live development: npm.cmd run dev:3027"

if (-not $NoOpen) {
  Start-Process "http://127.0.0.1:3027/" | Out-Null
}
