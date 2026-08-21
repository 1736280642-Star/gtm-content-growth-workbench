param(
  [switch]$NoOpen,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "workbench-3027-common.ps1")

Set-Location $projectRoot
Start-DockerEngine

# Next.js rewrites this generated file when a custom dist directory is used.
# Preserve the repository version so starting development does not dirty Git.
$nextEnvPath = Join-Path $projectRoot "next-env.d.ts"
$nextEnvSnapshot = if (Test-Path -LiteralPath $nextEnvPath) {
  [System.IO.File]::ReadAllBytes($nextEnvPath)
} else {
  $null
}

$composeArguments = @(
  "-f", "compose.yaml",
  "-f", "compose.dev-3027.yaml",
  "--profile", "full",
  "up", "-d", "--no-build"
)
if (-not $SkipBuild) {
  Ensure-WorkbenchDevelopmentBaseImage
}

Write-WorkbenchStep "Starting the live-development stack. Source changes will stay on port 3027."
try {
  Invoke-WorkbenchCompose -Arguments $composeArguments

  $logsCommand = "docker compose -f compose.yaml -f compose.dev-3027.yaml --profile full logs -f --tail 200 workbench-web rag-index-worker knowledge-worker content-worker monitor-worker publish-worker"
  Write-WorkbenchStep "Logs: $logsCommand"
  Wait-WorkbenchReady
  Ensure-WorkbenchChannelPublishCompanions
} finally {
  if ($null -ne $nextEnvSnapshot) {
    [System.IO.File]::WriteAllBytes($nextEnvPath, $nextEnvSnapshot)
  }
}

Write-WorkbenchStep "Mode: development with Next.js Fast Refresh and automatic Worker source restart."
Write-WorkbenchStep "Stop: npm.cmd run dev:3027:stop"
Write-WorkbenchStep "Production acceptance: npm.cmd run docker:3027"

if (-not $NoOpen) {
  Start-Process "http://127.0.0.1:3027/" | Out-Null
}
