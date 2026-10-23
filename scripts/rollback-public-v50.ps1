param([switch]$Apply)
$ErrorActionPreference='Stop'
$hosting=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\pubilla-mimic-hosting'))
$pointer=Join-Path $hosting 'current.txt'
$expected='codex-promoted-20261023-073025'
$restore='codex-promoted-20261021-040832'
$current=(Get-Content -LiteralPath $pointer -Raw).Trim()
if($current -eq $restore){Write-Host 'Already on v49.';exit 0}
if($current -ne $expected){throw "Another release is active ($current). Refusing to overwrite it."}
if((Get-Content -LiteralPath (Join-Path $hosting 'current.before-codex-v50.txt') -Raw).Trim() -ne $restore){throw 'Rollback pointer mismatch'}
$root=Join-Path $hosting $restore
if(!(Test-Path -LiteralPath (Join-Path $root 'index.html'))){throw 'Rollback index missing'}
if((Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw|ConvertFrom-Json).build -ne 'codex-20261021-040832'){throw 'Rollback build mismatch'}
if(!$Apply){Write-Host "READY: $expected -> $restore. Add -Apply to restore.";exit 0}
$id=[guid]::NewGuid().ToString('N')
$temp=Join-Path $hosting "current.rollback-v50-$id.tmp"
[IO.File]::WriteAllText($temp,$restore)
[IO.File]::Replace($temp,$pointer,(Join-Path $hosting "current.pre-rollback-v50-$id.txt"))
Write-Host 'Restored v49. Reload the public page.'
