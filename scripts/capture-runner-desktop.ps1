param(
  [switch]$NoBrowserLaunch
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "JotoCaptureCompanion"
$logRoot = Join-Path $stateRoot "logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$mutex = New-Object System.Threading.Mutex($false, "Local\JotoCaptureCompanion", [ref]$createdNew)
if (-not $createdNew) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Find-ChromeExecutable {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  if ($candidates.Count) { return $candidates[0] }
  $command = Get-Command chrome.exe -ErrorAction SilentlyContinue
  return $command.Source
}

$runnerProcess = $null
$lastChromeLaunchAt = [DateTime]::MinValue
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "JOTO AI Capture Companion"
$notifyIcon.Visible = $true

function Set-TrayStatus([string]$text, [System.Windows.Forms.ToolTipIcon]$icon = [System.Windows.Forms.ToolTipIcon]::Info) {
  $notifyIcon.BalloonTipTitle = "JOTO AI Capture Companion"
  $notifyIcon.BalloonTipText = $text
  $notifyIcon.BalloonTipIcon = $icon
  $notifyIcon.ShowBalloonTip(2500)
}

function Start-Runner {
  if ($script:runnerProcess -and -not $script:runnerProcess.HasExited) { return }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdout = Join-Path $logRoot "runner-$stamp.log"
  $stderr = Join-Path $logRoot "runner-$stamp.error.log"
  $script:runnerProcess = Start-Process -FilePath $node -ArgumentList @("capture-runner/src/server.mjs") -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Set-TrayStatus "Local Runner started and is waiting for capture tasks."
}

function Stop-Runner {
  if ($script:runnerProcess -and -not $script:runnerProcess.HasExited) {
    Stop-Process -Id $script:runnerProcess.Id -ErrorAction SilentlyContinue
    $script:runnerProcess.WaitForExit(3000) | Out-Null
  }
  $script:runnerProcess = $null
}

function Ensure-ChromeProfile {
  if ($NoBrowserLaunch -or $env:V5_CAPTURE_AUTO_LAUNCH_CHROME -eq "false") { return }
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:17321/status" -TimeoutSec 2
    if ($status.extension.status -eq "connected") { return }
  } catch { return }
  if (((Get-Date) - $script:lastChromeLaunchAt).TotalSeconds -lt 120) { return }
  $chrome = Find-ChromeExecutable
  if (-not $chrome) {
    Set-TrayStatus "Chrome was not found. Install Chrome or open the paired profile." ([System.Windows.Forms.ToolTipIcon]::Warning)
    return
  }
  $profile = if ($env:V5_CAPTURE_CHROME_PROFILE_DIRECTORY) { $env:V5_CAPTURE_CHROME_PROFILE_DIRECTORY } else { "Default" }
  $script:lastChromeLaunchAt = Get-Date
  Start-Process -FilePath $chrome -ArgumentList @("--profile-directory=$profile", "--no-first-run", "--no-startup-window", "--start-minimized") -WindowStyle Hidden | Out-Null
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openWorkbench = $menu.Items.Add("Open hosted workbench")
$checkStatus = $menu.Items.Add("Check connection status")
$restartRunner = $menu.Items.Add("Restart local Runner")
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$exitItem = $menu.Items.Add("Exit")
$notifyIcon.ContextMenuStrip = $menu

$openWorkbench.add_Click({
  $url = if ($env:V5_WORKBENCH_BASE_URL) { $env:V5_WORKBENCH_BASE_URL } else { "http://127.0.0.1:3027" }
  Start-Process $url
})
$checkStatus.add_Click({
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:17321/status" -TimeoutSec 2
    $connected = $status.extension.status -eq "connected"
    Set-TrayStatus $(if ($connected) { "Runner and browser extension are connected." } else { "Runner is ready and waiting for the Chrome extension." }) $(if ($connected) { [System.Windows.Forms.ToolTipIcon]::Info } else { [System.Windows.Forms.ToolTipIcon]::Warning })
  } catch { Set-TrayStatus "Runner is unavailable and will be restarted." ([System.Windows.Forms.ToolTipIcon]::Warning); Start-Runner }
})
$restartRunner.add_Click({ Stop-Runner; Start-Runner })
$exitItem.add_Click({ $script:shouldExit = $true; [System.Windows.Forms.Application]::ExitThread() })
$notifyIcon.add_DoubleClick({ $openWorkbench.PerformClick() })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.add_Tick({
  if (-not $script:runnerProcess -or $script:runnerProcess.HasExited) { Start-Runner }
  Ensure-ChromeProfile
})

try {
  Start-Runner
  Ensure-ChromeProfile
  $timer.Start()
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Stop()
  Stop-Runner
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
