# Synthetic process-exit probe only; the production stdin adapter has no fault option.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    $inputValue = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
    $base = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../runtime/qa/protected-store-tests'))
    $directory = [IO.Path]::GetFullPath([string]$inputValue.directory)
    if ([IO.Path]::GetDirectoryName($directory) -ne $base -or [IO.Path]::GetFileName($directory) -notmatch '^case-[a-f0-9-]{36}$') { throw 'synthetic_only' }
    Add-Type -Path (Join-Path $PSScriptRoot '../../services/controlPlane/ProtectedState.cs')
    $checkpoint = [Action[string]] { param($point) if ($point -eq 'archived') { [Environment]::Exit(75) } }
    [void][CineVaultControlPlane.ProtectedState]::Run($directory, 'recover', [string]$inputValue.payload, [string]$inputValue.revision, $checkpoint)
    exit 1
} catch { [Console]::Error.Write('synthetic_probe_failed'); exit 1 }
