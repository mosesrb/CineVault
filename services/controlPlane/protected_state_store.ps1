$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    $requestText = [Console]::In.ReadToEnd()
    if ($requestText.Length -gt 32768) { throw 'request_limit' }
    $request = ConvertFrom-Json -InputObject $requestText
    $runtime = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../runtime')) + [IO.Path]::DirectorySeparatorChar
    $directory = [IO.Path]::GetFullPath([string]$request.directory)
    if (-not $directory.StartsWith($runtime, [StringComparison]::OrdinalIgnoreCase)) { throw 'unsafe_storage_location' }
    Add-Type -Path (Join-Path $PSScriptRoot 'ProtectedState.cs')
    $result = [CineVaultControlPlane.ProtectedState]::Run(
        [string]$request.directory, [string]$request.action,
        [string]$request.payload, [string]$request.expectedRevision)
    [Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress))
    exit 0
} catch {
    [Console]::Error.Write('credential_store_recovery_required')
    exit 1
}
