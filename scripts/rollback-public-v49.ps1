param([switch]$Apply, [ValidateSet('v48','v47')][string]$Target='v48')
$ErrorActionPreference = 'Stop'
$hosting = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\pubilla-mimic-hosting'))
$pointer = Join-Path $hosting 'current.txt'
$expected = 'codex-promoted-20261021-040832'
$stamp = if ($Target -eq 'v48') { '20261020-155418' } else { '20261020-152321' }
$restore = 'codex-promoted-' + $stamp
$current = (Get-Content -LiteralPath $pointer -Raw).Trim()
if ($current -eq $restore) { Write-Host "Already on $Target."; exit 0 }
if ($current -ne $expected) { throw "Another release is active ($current). Refusing to overwrite it." }
if ((Get-Content -LiteralPath (Join-Path $hosting 'current.before-codex-v49.txt') -Raw).Trim() -ne 'codex-promoted-20261020-155418') { throw 'Rollback pointer mismatch.' }
$root = Join-Path $hosting $restore
if (-not (Test-Path -LiteralPath (Join-Path $root 'index.html'))) { throw 'Rollback index missing.' }
$cfg = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
if ($cfg.build -ne ('codex-' + $stamp)) { throw 'Rollback build mismatch.' }
if (-not $Apply) { Write-Host "READY: $current -> $restore. Add -Apply to restore."; exit 0 }
$id = [guid]::NewGuid().ToString('N')
$temporary = Join-Path $hosting ("current.rollback-v49-$id.tmp")
[IO.File]::WriteAllText($temporary, $restore, [Text.UTF8Encoding]::new($false))
[IO.File]::Replace($temporary, $pointer, (Join-Path $hosting "current.pre-rollback-v49-$id.txt"))
Write-Host "Restored $Target. Reload the public page to use it."
