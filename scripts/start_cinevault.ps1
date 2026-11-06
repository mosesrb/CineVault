param([switch]$DatabaseOnly)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local_tcp_ready.ps1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $repoRoot 'runtime'
$mongoRuntime = Join-Path $runtimeRoot 'mongodb'
$mongoConfig = Join-Path $repoRoot 'ops\mongod-cinevault.cfg'
$mongoExecutable = 'C:\Program Files\MongoDB\Server\5.0\bin\mongod.exe'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'

New-Item -ItemType Directory -Path $mongoRuntime -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $mongoRuntime 'data') -Force | Out-Null

if (-not (Test-CineVaultTcpPort -Port 27018)) {
    if (-not (Test-Path -LiteralPath $mongoExecutable)) {
        throw "CineVault MongoDB executable is missing: $mongoExecutable"
    }
    $mongoProcess = Start-Process `
        -FilePath $mongoExecutable `
        -ArgumentList @('--config', ('"{0}"' -f $mongoConfig)) `
        -WindowStyle Hidden `
        -PassThru

    $mongoReady = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-CineVaultTcpPort -Port 27018) {
            $mongoReady = $true
            break
        }
        if ($mongoProcess.HasExited) { break }
    }
    if (-not $mongoReady) { throw "CineVault MongoDB did not start. Check $mongoRuntime\mongod.log." }
}

if ($DatabaseOnly) {
    Write-Output 'CineVault authenticated MongoDB is listening on 127.0.0.1:27018.'
    return
}

if (-not (Test-CineVaultTcpPort -Port 3000)) {
    $serverProcess = Start-Process `
        -FilePath $nodeExecutable `
        -ArgumentList @('index.js') `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtimeRoot 'cinevault.stdout.log') `
        -RedirectStandardError (Join-Path $runtimeRoot 'cinevault.stderr.log') `
        -PassThru

    $serverReady = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-CineVaultTcpPort -Port 3000) {
            $serverReady = $true
            break
        }
        if ($serverProcess.HasExited) { break }
    }
    if (-not $serverReady) { throw 'CineVault application did not start.' }
}

Write-Output 'CineVault and its authenticated MongoDB are listening locally.'
