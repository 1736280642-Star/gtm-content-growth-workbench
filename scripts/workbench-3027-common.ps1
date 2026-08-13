$ErrorActionPreference = "Stop"
# Compose can select Buildx Bake from the user's Docker configuration. The
# classic Compose build path is more stable for this local Windows workflow.
$env:COMPOSE_BAKE = "false"

$script:WorkbenchComposeLauncher = Join-Path $PSScriptRoot "docker-compose-with-project-env.mjs"

function Write-WorkbenchStep {
  param([string]$Message)
  Write-Host "[workbench:3027] $Message"
}

function Test-DockerReady {
  try {
    # A stopped Docker engine is an expected cold-start state. Temporarily
    # suppress native-command errors so the launcher can start Desktop.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & docker info --format "{{.ServerVersion}}" *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Start-DockerEngine {
  if (Test-DockerReady) {
    Write-WorkbenchStep "Docker engine is ready."
    return
  }

  $dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker engine is unavailable and Docker Desktop was not found at: $dockerDesktop"
  }

  Write-WorkbenchStep "Starting Docker Desktop..."
  Start-Process -FilePath $dockerDesktop | Out-Null

  for ($attempt = 1; $attempt -le 60; $attempt += 1) {
    Start-Sleep -Seconds 2
    if (Test-DockerReady) {
      Write-WorkbenchStep "Docker engine is ready."
      return
    }
  }

  throw "Docker Desktop did not become ready within 120 seconds. Open Docker Desktop, resolve its startup error, and run the command again."
}

function Invoke-WorkbenchCompose {
  param([string[]]$Arguments)

  & node $script:WorkbenchComposeLauncher @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed with exit code $LASTEXITCODE. Review the error above and rerun the command."
  }
}

function Invoke-WorkbenchDocker {
  param([string[]]$Arguments)

  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker failed with exit code $LASTEXITCODE. Review the error above and rerun the command."
  }
}

function Ensure-WorkbenchDevelopmentBaseImage {
  $resolvedImages = & node $script:WorkbenchComposeLauncher --profile full config --images
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve the Worker image name from compose.yaml."
  }
  $workerImage = $resolvedImages | Where-Object { $_ -match "workbench-worker:" } | Select-Object -First 1
  if (-not $workerImage) {
    throw "Unable to identify the Worker image from compose.yaml."
  }

  & docker image inspect $workerImage *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-WorkbenchStep "Reusing development base image: $workerImage"
    return
  }

  Write-WorkbenchStep "Development base image is missing; building it once: $workerImage"
  Invoke-WorkbenchDocker -Arguments @("build", "--target", "worker", "--tag", $workerImage, ".")
}

function Build-WorkbenchProductionImages {
  $resolvedImages = & node $script:WorkbenchComposeLauncher -f compose.yaml --profile full config --images
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve production image names from compose.yaml."
  }

  $webImage = $resolvedImages | Where-Object { $_ -match "workbench-web:" } | Select-Object -First 1
  $workerImage = $resolvedImages | Where-Object { $_ -match "workbench-worker:" } | Select-Object -First 1
  if (-not $webImage -or -not $workerImage) {
    throw "Unable to identify the workbench Web or Worker image from compose.yaml."
  }

  Write-WorkbenchStep "Building production Worker image: $workerImage"
  Invoke-WorkbenchDocker -Arguments @("build", "--target", "worker", "--tag", $workerImage, ".")
  Write-WorkbenchStep "Building production Web image: $webImage"
  Invoke-WorkbenchDocker -Arguments @("build", "--target", "web", "--tag", $webImage, ".")
}

function Assert-WorkbenchProductionMode {
  $containerName = "joto-gtm-workbench-workbench-web-1"
  $commandJson = & docker inspect $containerName --format "{{json .Config.Cmd}}"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect the 3027 Web container after startup."
  }
  $labelsJson = & docker inspect $containerName --format "{{json .Config.Labels}}"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect the Compose source files for the 3027 Web container."
  }
  $labels = $labelsJson | ConvertFrom-Json
  $configFiles = $labels.'com.docker.compose.project.config_files'
  if ($commandJson -notmatch 'server\.js' -or $configFiles -match 'compose\.dev-3027\.yaml') {
    throw "Port 3027 is not running the production-like standalone container. Run npm.cmd run docker:3027 again."
  }
  Write-WorkbenchStep "Verified production mode: standalone server.js from compose.yaml."
}

function Wait-WorkbenchReady {
  param(
    [string]$Url = "http://127.0.0.1:3027/api/health?scope=web",
    [int]$TimeoutSeconds = 180
  )

  Write-WorkbenchStep "Waiting for the 3027 health check..."
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      $payload = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $payload.ok -eq $true) {
        Write-WorkbenchStep "Workbench is ready: http://127.0.0.1:3027/"
        return
      }
    } catch {
      # Startup can briefly refuse connections while Next.js or its dependencies initialize.
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "The 3027 health check did not become ready within $TimeoutSeconds seconds. Run the logs command printed by the launcher."
}
