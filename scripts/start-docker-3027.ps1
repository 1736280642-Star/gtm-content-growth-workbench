param([switch]$NoOpen)

$ErrorActionPreference = "Stop"
$launcher = Join-Path $PSScriptRoot "ensure-workbench-3027.ps1"
if ($NoOpen) {
  & $launcher -NoOpen
} else {
  & $launcher
}
exit $LASTEXITCODE
