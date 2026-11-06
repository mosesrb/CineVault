$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../local_tcp_ready.ps1')

# Real loopback sockets, no database or platform listener-enumeration dependency.
$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
try {
    $port = $listener.LocalEndpoint.Port
    if (-not (Test-CineVaultTcpPort -Port $port)) { throw 'Listening port was falsely rejected.' }
    $accepted = $listener.AcceptTcpClient()
    try {
        $accepted.ReceiveTimeout = 2000
        if ($accepted.GetStream().ReadByte() -ne -1) { throw 'Probe left a connection open or sent data.' }
    }
    finally { $accepted.Close() }

    for ($index = 0; $index -lt 4; $index++) {
        if (-not (Test-CineVaultTcpPort -Port $port)) { throw 'Repeated readiness probe failed.' }
        $accepted = $listener.AcceptTcpClient()
        try {
            $accepted.ReceiveTimeout = 2000
            if ($accepted.GetStream().ReadByte() -ne -1) { throw 'Repeated probe leaked a connection.' }
        }
        finally { $accepted.Close() }
    }
}
finally { $listener.Stop() }

if (Test-CineVaultTcpPort -Port $port) { throw 'Stopped listener was falsely reported ready.' }
Write-Output 'Passed 3 socket checks: listener readiness, repeated probe disposal, and closed-port rejection.'
