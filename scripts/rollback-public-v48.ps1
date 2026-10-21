param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$hosting = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\pubilla-mimic-hosting'))
$pointer = Join-Path $hosting 'current.txt'
$expected = 'codex-promoted-20261020-155418'
$target = 'codex-promoted-20261020-152321'
$current = (Get-Content -LiteralPath $pointer -Raw).Trim()
if ($current -eq $target) { Write-Host 'Already on v47.'; exit 0 }
if ($current -ne $expected) { throw "Another release is active ($current). Refusing to overwrite it." }
$saved = (Get-Content -LiteralPath (Join-Path $hosting 'current.before-codex-v48.txt') -Raw).Trim()
if ($saved -ne $target) { throw 'Rollback pointer mismatch.' }
$targetRoot = Join-Path $hosting $target
if (-not (Test-Path -LiteralPath (Join-Path $targetRoot 'index.html'))) { throw 'v47 index missing.' }
$cfg = Get-Content -LiteralPath (Join-Path $targetRoot 'config.json') -Raw | ConvertFrom-Json
if ($cfg.build -ne 'codex-20261020-152321') { throw 'v47 build mismatch.' }
if (-not $Apply) { Write-Host "READY: $current -> $target. Add -Apply to restore."; exit 0 }
$temporary = Join-Path $hosting ('current.rollback-v48-' + [guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllText($temporary, $target, [Text.UTF8Encoding]::new($false))
$archive = Join-Path $hosting ('current.pre-rollback-v48-' + [guid]::NewGuid().ToString('N') + '.txt')
[IO.File]::Replace($temporary, $pointer, $archive)
Write-Host 'Restored v47. Reload the public page to use it.'
