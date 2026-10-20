$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$hostingPath = Join-Path (Split-Path -Parent $projectPath) 'pubilla-mimic-codex-hosting'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$env:PORT = '4175'
$env:HOST = '127.0.0.1'
$env:ROOT_FILE = 'current.txt'
Set-Location -LiteralPath $projectPath
while ($true) {
    Add-Content -LiteralPath (Join-Path $hostingPath 'serve-codex.log') -Value "[$(Get-Date -Format o)] Codex server starting"
    & $nodePath (Join-Path $PSScriptRoot 'serve.mjs') >> (Join-Path $hostingPath 'serve-codex.log') 2>&1
    Start-Sleep -Seconds 3
}
