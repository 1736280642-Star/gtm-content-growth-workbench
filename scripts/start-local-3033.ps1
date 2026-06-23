param(
  [int]$Port = 3033,
  [string]$HostName = "127.0.0.1",
  [switch]$Open
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$url = "http://${HostName}:${Port}/ai-config"

function Write-Step {
  param([string]$Message)
  Write-Host "[workbench] $Message"
}

function Get-PortOwner {
  param([int]$TargetPort)
  Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

$existing = Get-PortOwner -TargetPort $Port

if ($existing) {
  Write-Step "Port $Port is already listening. PID: $($existing.OwningProcess)"
  Write-Step "Open: $url"

  if ($Open) {
    Start-Process $url
  }

  exit 0
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outLog = Join-Path $projectRoot "workbench-$Port-$timestamp.out.log"
$errLog = Join-Path $projectRoot "workbench-$Port-$timestamp.err.log"

Write-Step "Starting JOTO GTM Workbench..."
Write-Step "Project: $projectRoot"
Write-Step "URL: $url"
Write-Step "Output log: $outLog"
Write-Step "Error log: $errLog"

$process = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev", "--", "--hostname", $HostName, "--port", "$Port") `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

Write-Step "Started background process. Launcher PID: $($process.Id)"

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $owner = Get-PortOwner -TargetPort $Port
  if ($owner) {
    $ready = $true
    Write-Step "Port $Port is listening. Server PID: $($owner.OwningProcess)"
    break
  }
}

if (-not $ready) {
  Write-Step "Server did not start within 30 seconds."
  Write-Step "Check logs:"
  Write-Step $outLog
  Write-Step $errLog
  exit 1
}

Write-Step "Ready: $url"

if ($Open) {
  Start-Process $url
}
