param(
  [Parameter(Mandatory = $true)]
  [string]$PairingCode,
  [string]$DisplayName = "Desktop Connector"
)

$ErrorActionPreference = "Stop"
$code = $PairingCode.Trim()
if ($code.Length -lt 16 -or $code.Length -gt 128) {
  throw "PairingCode is invalid or incomplete. Generate a new code in the channel connection wizard."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$workerScript = Join-Path $projectRoot "workers\browser-executor-worker.mjs"
$localDataRoot = [Environment]::GetFolderPath("LocalApplicationData")
if ([string]::IsNullOrWhiteSpace($localDataRoot)) { throw "LOCALAPPDATA is unavailable." }
$stateRoot = Join-Path $localDataRoot "JotoPublishRunner\desktop-connector"
$statePath = Join-Path $stateRoot "node-identity.json"
$logRoot = Join-Path $stateRoot "logs"
$resolvedProject = [IO.Path]::GetFullPath($projectRoot)
if ([IO.Path]::GetFullPath($stateRoot).StartsWith($resolvedProject, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Desktop Connector identity must stay outside the repository."
}
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$node = (Get-Command node.exe -ErrorAction Stop).Source
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdout = Join-Path $logRoot "desktop-connector-$stamp.log"
$stderr = Join-Path $logRoot "desktop-connector-$stamp.error.log"
$previous = @{
  PUBLISH_EXECUTOR_TYPE = $env:PUBLISH_EXECUTOR_TYPE
  PUBLISH_EXECUTOR_PAIRING_CODE = $env:PUBLISH_EXECUTOR_PAIRING_CODE
  PUBLISH_EXECUTOR_API_BASE_URL = $env:PUBLISH_EXECUTOR_API_BASE_URL
  PUBLISH_EXECUTOR_STATE_PATH = $env:PUBLISH_EXECUTOR_STATE_PATH
  PUBLISH_EXECUTOR_DISPLAY_NAME = $env:PUBLISH_EXECUTOR_DISPLAY_NAME
}
try {
  $env:PUBLISH_EXECUTOR_TYPE = "desktop_connector"
  $env:PUBLISH_EXECUTOR_PAIRING_CODE = $code
  $env:PUBLISH_EXECUTOR_API_BASE_URL = "http://127.0.0.1:3027"
  $env:PUBLISH_EXECUTOR_STATE_PATH = $statePath
  $env:PUBLISH_EXECUTOR_DISPLAY_NAME = $DisplayName.Trim()
  $process = Start-Process -FilePath $node -ArgumentList @($workerScript) -WorkingDirectory $projectRoot `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
} finally {
  foreach ($name in $previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
  }
}

Start-Sleep -Seconds 2
if ($process.HasExited) {
  throw "Desktop Connector failed to start. Inspect: $stderr"
}
Write-Output "desktop_connector=started"
Write-Output "state=$statePath"
Write-Output "logs=$logRoot"
