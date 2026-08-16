param(
  [switch]$NoOpen,
  [switch]$SkipBuild,
  [switch]$CheckOnly,
  [switch]$AllowLowResources,
  [switch]$AllowPendingProvider
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "workbench-3027-common.ps1")

$envPath = Join-Path $projectRoot ".env"
$envTemplatePath = Join-Path $projectRoot ".env.example"
$localEnvPath = Join-Path $projectRoot ".env.local"
$databaseVolumeName = "joto-gtm-workbench_mysql_data"

function Get-WorkbenchDotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $match = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
  if ($null -eq $match) { return $null }
  return ($match -replace "^[^=]*=", "").Trim()
}

function Set-WorkbenchDotEnvValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
  $pattern = "^$([regex]::Escape($Name))="
  $replacement = "$Name=$Value"
  $replaced = $false
  $nextLines = foreach ($line in $lines) {
    if ($line -match $pattern) {
      if (-not $replaced) { $replacement }
      $replaced = $true
    } else {
      $line
    }
  }
  if (-not $replaced) {
    $nextLines += $replacement
  }
  $text = (($nextLines -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine)
  [System.IO.File]::WriteAllText($Path, $text, [System.Text.UTF8Encoding]::new($false))
}

function New-WorkbenchLocalSecret {
  $bytes = [byte[]]::new(36)
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Test-WorkbenchPlaceholder {
  param([string]$Value)
  return [string]::IsNullOrWhiteSpace($Value) -or $Value -match "^(replace-with|change-me|example|password)"
}

function Test-WorkbenchDockerVolumeExists {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & docker volume inspect $databaseVolumeName *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Assert-WorkbenchCommand {
  param([string]$Name, [string]$InstallHint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $InstallHint"
  }
}

function Test-WorkbenchHostResources {
  $minimumMemoryGb = 8
  $recommendedMemoryGb = 12
  $minimumDiskGb = 20
  $recommendedDiskGb = 50
  $computer = Get-CimInstance Win32_ComputerSystem
  $memoryGb = [math]::Round([double]$computer.TotalPhysicalMemory / 1GB, 1)
  $rootItem = Get-Item -LiteralPath $projectRoot
  $drive = Get-PSDrive -Name $rootItem.PSDrive.Name
  $freeDiskGb = [math]::Round([double]$drive.Free / 1GB, 1)

  Write-WorkbenchStep "Host resources: ${memoryGb} GB RAM, ${freeDiskGb} GB free disk."
  if (($memoryGb -lt $minimumMemoryGb -or $freeDiskGb -lt $minimumDiskGb) -and -not $AllowLowResources) {
    throw "Full production mode requires at least ${minimumMemoryGb} GB RAM and ${minimumDiskGb} GB free disk. Use -AllowLowResources only after accepting degraded indexing and parsing performance."
  }
  if ($memoryGb -lt $recommendedMemoryGb -or $freeDiskGb -lt $recommendedDiskGb) {
    Write-Warning "Recommended capacity is ${recommendedMemoryGb} GB RAM and ${recommendedDiskGb} GB free disk. Enable knowledge retention rules before importing a large archive."
  }
}

function Initialize-WorkbenchProductionEnvironment {
  if (-not (Test-Path -LiteralPath $envTemplatePath)) {
    throw ".env.example is missing; production configuration cannot be initialized."
  }

  $volumeExists = Test-WorkbenchDockerVolumeExists
  if (-not (Test-Path -LiteralPath $envPath)) {
    if ($volumeExists) {
      throw "The MySQL volume already exists but .env is missing. Restore the original .env or restore a backup; generating new credentials would disconnect the existing database."
    }
    Copy-Item -LiteralPath $envTemplatePath -Destination $envPath
    Write-WorkbenchStep "Created the local .env from the committed template."
  }

  $passwordNames = @("MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD")
  foreach ($name in $passwordNames) {
    $current = Get-WorkbenchDotEnvValue -Path $envPath -Name $name
    if (Test-WorkbenchPlaceholder -Value $current) {
      if ($volumeExists) {
        throw "$name is missing or still a placeholder while the MySQL volume already exists. Restore the matching local credential instead of rotating it implicitly."
      }
      Set-WorkbenchDotEnvValue -Path $envPath -Name $name -Value (New-WorkbenchLocalSecret)
      Write-WorkbenchStep "Generated $name for local Docker use; the value was not printed."
    }
  }

  Set-WorkbenchDotEnvValue -Path $envPath -Name "DEPLOYMENT_PROFILE" -Value "full"
  Set-WorkbenchDotEnvValue -Path $envPath -Name "MYSQL_DATABASE" -Value "joto_workbench"
  Set-WorkbenchDotEnvValue -Path $envPath -Name "MYSQL_USER" -Value "joto"
}

function Read-WorkbenchProviderSecret {
  $secureValue = Read-Host "Enter DASHSCOPE_API_KEY for real Embedding and content generation (input is hidden)" -AsSecureString
  if ($secureValue.Length -eq 0) { return $null }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Ensure-WorkbenchProviderConfiguration {
  $localValue = Get-WorkbenchDotEnvValue -Path $localEnvPath -Name "DASHSCOPE_API_KEY"
  $composeValue = Get-WorkbenchDotEnvValue -Path $envPath -Name "DASHSCOPE_API_KEY"
  if (-not [string]::IsNullOrWhiteSpace($localValue) -or -not [string]::IsNullOrWhiteSpace($composeValue)) {
    Write-WorkbenchStep "Embedding provider credential is configured; its value remains hidden."
    return $true
  }

  if ($AllowPendingProvider) {
    Write-Warning "Provider configuration is pending. MySQL and OpenSearch can start, but deep production readiness and evidence-backed generation will remain unavailable."
    return $false
  }

  $providerSecret = Read-WorkbenchProviderSecret
  if ([string]::IsNullOrWhiteSpace($providerSecret)) {
    throw "Full production mode requires DASHSCOPE_API_KEY. Rerun and enter it, or use -AllowPendingProvider only for infrastructure preparation."
  }
  if ($providerSecret -notmatch "^[A-Za-z0-9._-]{16,}$") {
    $providerSecret = $null
    throw "DASHSCOPE_API_KEY contains unsupported characters or is unexpectedly short. Copy the provider key again; line breaks and dotenv control characters are rejected."
  }
  try {
    if (-not (Test-Path -LiteralPath $localEnvPath)) {
      [System.IO.File]::WriteAllText($localEnvPath, "# Local provider credentials. Never commit this file.$([Environment]::NewLine)", [System.Text.UTF8Encoding]::new($false))
    }
    Set-WorkbenchDotEnvValue -Path $localEnvPath -Name "DASHSCOPE_API_KEY" -Value $providerSecret
    Write-WorkbenchStep "Saved the provider credential to ignored .env.local; the value was not printed."
    return $true
  } finally {
    $providerSecret = $null
  }
}

function Get-WorkbenchDeepHealthSummary {
  param([object]$Payload)
  $services = @("mysql", "opensearch", "embedding", "workers")
  return ($services | ForEach-Object {
    $probe = $Payload.services.$_
    "$_=$($probe.status)"
  }) -join ", "
}

function Wait-WorkbenchFullProductionReady {
  param([int]$TimeoutSeconds = 600)
  $url = "http://127.0.0.1:3027/api/health?deep=true"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastSummary = "not_reached"
  Write-WorkbenchStep "Waiting for full readiness: MySQL, OpenSearch, live Embedding, and Workers."
  do {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
      $payload = $response.Content | ConvertFrom-Json
      $lastSummary = Get-WorkbenchDeepHealthSummary -Payload $payload
      if ($payload.ok -eq $true -and $payload.profile -eq "full") {
        Write-WorkbenchStep "Full production mode is ready ($lastSummary)."
        return
      }
    } catch {
      $lastSummary = "health_endpoint_unavailable"
    }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)

  throw "Full production readiness did not pass within $TimeoutSeconds seconds ($lastSummary). Inspect /api/health?deep=true and Docker logs; no partial state was reported as ready."
}

Set-Location $projectRoot
Assert-WorkbenchCommand -Name "node" -InstallHint "Install the Node.js version declared by this repository."
Assert-WorkbenchCommand -Name "docker" -InstallHint "Install Docker Desktop with Docker Compose v2."
Test-WorkbenchHostResources

if ($CheckOnly) {
  $dockerStatus = if (Test-DockerReady) { "ready" } else { "not_ready" }
  $envStatus = if (Test-Path -LiteralPath $envPath) { "present" } else { "will_be_created" }
  $providerConfigured = -not [string]::IsNullOrWhiteSpace((Get-WorkbenchDotEnvValue -Path $localEnvPath -Name "DASHSCOPE_API_KEY")) -or
    -not [string]::IsNullOrWhiteSpace((Get-WorkbenchDotEnvValue -Path $envPath -Name "DASHSCOPE_API_KEY"))
  Write-WorkbenchStep "Preflight complete: Docker=$dockerStatus, local environment=$envStatus, provider configured=$providerConfigured."
  exit 0
}

Start-DockerEngine
Initialize-WorkbenchProductionEnvironment
$providerReady = Ensure-WorkbenchProviderConfiguration

$startupLock = $null
try {
  $startupLock = Enter-WorkbenchStartupLock
  if ($SkipBuild) {
    Assert-WorkbenchProductionImagesAvailable
  } else {
    Write-WorkbenchStep "Building production images for the complete local distribution."
    Build-WorkbenchProductionImages
  }
  Invoke-WorkbenchCompose -Arguments @("-f", "compose.yaml", "--profile", "full", "up", "-d", "--no-build")
  Wait-WorkbenchReady
  Assert-WorkbenchProductionMode
  if ($providerReady) {
    Wait-WorkbenchFullProductionReady
  } else {
    Write-Warning "Infrastructure started, but the deployment is intentionally not marked fully ready until a real provider credential passes the deep health check."
  }
} finally {
  Exit-WorkbenchStartupLock -Mutex $startupLock
}

Write-WorkbenchStep "Production bootstrap completed. Daily starts can now use npm.cmd run docker:3027."
Write-WorkbenchStep "Run node scripts/knowledge-capacity-report.mjs to review database, index, source, and artifact storage."
if (-not $NoOpen) {
  Start-Process "http://127.0.0.1:3027/" | Out-Null
}
