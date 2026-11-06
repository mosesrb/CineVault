# Socket readiness only. Database authentication is checked by the application.
function Test-CineVaultTcpPort {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 65535)]
        [int]$Port,
        [ValidateRange(1, 10000)]
        [int]$TimeoutMs = 250
    )

    $client = New-Object System.Net.Sockets.TcpClient
    $attempt = $null
    try {
        $attempt = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($attempt)
        return $true
    }
    catch { return $false }
    finally {
        $client.Close()
        if ($null -ne $attempt) { $attempt.AsyncWaitHandle.Close() }
    }
}
