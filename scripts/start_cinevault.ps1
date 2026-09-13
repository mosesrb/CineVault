$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $repoRoot 'runtime'
$mongoRuntime = Join-Path $runtimeRoot 'mongodb'
$mongoConfig = Join-Path $repoRoot 'ops\mongod-cinevault.cfg'
$mongoExecutable = 'C:\Program Files\MongoDB\Server\5.0\bin\mongod.exe'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'

New-Item -ItemType Directory -Path $mongoRuntime -Force | Out-Null

if (-not (Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue)) {
    $mongoProcess = Start-Process `
        -FilePath $mongoExecutable `
        -ArgumentList @('--config', $mongoConfig) `
        -WindowStyle Hidden `
        -PassThru

    $mongoReady = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue) {
            $mongoReady = $true
            break
        }
        if ($mongoProcess.HasExited) { break }
    }
    if (-not $mongoReady) { throw 'CineVault MongoDB did not start.' }
}

if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
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
        if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
            $serverReady = $true
            break
        }
        if ($serverProcess.HasExited) { break }
    }
    if (-not $serverReady) { throw 'CineVault application did not start.' }
}

Write-Output 'CineVault and its authenticated MongoDB are listening locally.'
