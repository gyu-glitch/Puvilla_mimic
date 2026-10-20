param([switch]$Stop, [switch]$ServerOnly)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$nodePath = Join-Path $taskRoot 'runtime\node.exe'
$serverPath = Join-Path $taskRoot 'server.mjs'
$pidPath = Join-Path $taskRoot 'server.pid'
$url = 'http://127.0.0.1:4178'
if ($Stop) {
  if (Test-Path -LiteralPath $pidPath) {
    $serverPid = [int](Get-Content -LiteralPath $pidPath)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid"
    if ($process -and $process.ExecutablePath -eq $nodePath -and $process.CommandLine.Contains($serverPath)) {
      Stop-Process -Id $serverPid
      Remove-Item -LiteralPath $pidPath
    }
  }
  Write-Host 'Local server stopped. Close the Puuvilla window to release the camera.'
  exit 0
}
function Read-Health {
  try { return Invoke-RestMethod -Uri "$url/__health" -TimeoutSec 2 } catch { return $null }
}
$health = Read-Health
if (-not $health) {
  $server = Start-Process -FilePath $nodePath -ArgumentList @("`"$serverPath`"") -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'server.log') -RedirectStandardError (Join-Path $taskRoot 'server-error.log')
  Set-Content -LiteralPath $pidPath -Value $server.Id
  for ($i = 0; $i -lt 30 -and -not $health; $i++) { Start-Sleep -Milliseconds 200; $health = Read-Health }
}
if (-not $health -or $health.app -ne 'puuvilla-exhibit-v48' -or $health.root -ne (Join-Path $taskRoot 'site')) {
  throw 'Port 4178 is in use by another app or another copy. Stop that copy first; see server-error.log.'
}
if ($ServerOnly) { Write-Host "$url ready"; exit 0 }
$candidates = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browserPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browserPath) { throw "Install Chrome or open $url in your existing browser." }
# This visible window is the requested local application, not a background helper.
Start-Process -FilePath $browserPath -ArgumentList "--app=$url/"
