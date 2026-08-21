param([int]$TimeoutSeconds = 40)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$probeScript = Join-Path $scriptDir "probe-channel-publish-companions.mjs"
$bridgeScript = Join-Path $scriptDir "wechatsync-bridge.mjs"
$runnerScript = Join-Path $projectRoot "arcs-runner\run.py"
$runnerPython = Join-Path $projectRoot "arcs-runner\.venv\Scripts\python.exe"
$localDataRoot = [Environment]::GetFolderPath("LocalApplicationData")
$stateRoot = Join-Path $localDataRoot "JotoPublishRunner"
$logRoot = Join-Path $stateRoot "logs"

if ($TimeoutSeconds -lt 5 -or $TimeoutSeconds -gt 180) {
  throw "TimeoutSeconds must be between 5 and 180."
}
if ([string]::IsNullOrWhiteSpace($localDataRoot)) {
  throw "LOCALAPPDATA is unavailable; channel companion state cannot be stored safely outside the repository."
}
if ([IO.Path]::GetFullPath($stateRoot).StartsWith([IO.Path]::GetFullPath($projectRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw "Channel companion state and logs must stay outside the repository."
}

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$mutex = [System.Threading.Mutex]::new($false, "Local\JotoChannelPublishCompanions")
$mutexAcquired = $false
try {
  try {
    $mutexAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds(45))
  } catch [System.Threading.AbandonedMutexException] {
    $mutexAcquired = $true
  }
  if (-not $mutexAcquired) {
    throw "Another channel companion startup is still running."
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source

  function Get-CompanionStatus {
    $raw = & $node $probeScript 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) {
      throw "The channel companion readiness probe failed."
    }
    return ($raw | Select-Object -Last 1 | ConvertFrom-Json)
  }

  function Start-HiddenCompanion {
    param(
      [string]$Name,
      [string]$Executable,
      [string[]]$Arguments
    )
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdout = Join-Path $logRoot "$Name-$stamp.log"
    $stderr = Join-Path $logRoot "$Name-$stamp.error.log"
    $process = Start-Process `
      -FilePath $Executable `
      -ArgumentList $Arguments `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru
    Write-Host "[channels] Starting $Name in the background (PID $($process.Id))."
    return [pscustomobject]@{ Name = $Name; Process = $process; ErrorLog = $stderr }
  }

  $status = Get-CompanionStatus
  if (-not $status.configuration.bridgeLoopbackValid -or -not $status.configuration.runnerLoopbackValid) {
    throw "Bridge and Arcs Runner must use valid loopback hosts and ports in .env.local."
  }
  if (-not $status.configuration.bridgeTokenConfigured) {
    throw "WECHATSYNC_BRIDGE_TOKEN is not configured in .env.local."
  }
  if (-not $status.configuration.runnerTokenConfigured) {
    throw "JOTO_PUBLISH_RUNNER_TOKEN or WECHATSYNC_BRIDGE_TOKEN is not configured in .env.local."
  }

  $started = @()
  if (-not $status.runner.ready) {
    if (-not (Test-Path -LiteralPath $runnerPython -PathType Leaf)) {
      throw "Arcs Runner dependencies are not prepared. Run: uv sync --project arcs-runner"
    }
    $started += Start-HiddenCompanion -Name "arcs-runner" -Executable $runnerPython -Arguments @("-X", "utf8", $runnerScript)
  } else {
    Write-Host "[channels] Arcs Runner is already ready; reusing it."
  }

  if (-not $status.bridge.ready) {
    $started += Start-HiddenCompanion -Name "wechatsync-bridge" -Executable $node -Arguments @($bridgeScript)
  } else {
    Write-Host "[channels] Wechatsync Bridge is already ready; reusing it."
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    foreach ($item in $started) {
      if ($item.Process.HasExited) {
        throw "$($item.Name) exited during startup. Inspect: $($item.ErrorLog)"
      }
    }
    $status = Get-CompanionStatus
    if ($status.ok) {
      Write-Host "[channels] Wechatsync Bridge and Arcs Runner are ready."
      Write-Host "[channels] Logs: $logRoot"
      return
    }
    Start-Sleep -Milliseconds 750
  } while ((Get-Date) -lt $deadline)

  throw "Channel companions did not become ready within $TimeoutSeconds seconds. Inspect: $logRoot"
} finally {
  if ($mutexAcquired) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  $mutex.Dispose()
}

