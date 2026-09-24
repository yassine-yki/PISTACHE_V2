$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$port = 4173
if ($env:SUIVI_HOTEL_PORT -match '^\d{4,5}$') { $port = [int]$env:SUIVI_HOTEL_PORT }
$url = "http://127.0.0.1:$port/?v=portable-r2-1"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)

try {
    $listener.Start()
} catch {
    Write-Host "Impossible de demarrer le suivi sur le port $port. Fermez l'autre serveur eventuel, puis relancez." -ForegroundColor Red
    Read-Host 'Appuyez sur Entree pour fermer'
    exit 1
}

Write-Host "Suivi des chambres : $url"
Write-Host 'Gardez cette fenetre ouverte. Ctrl+C pour arreter.'
if ($env:SUIVI_HOTEL_NO_BROWSER -ne '1') {
    $brave = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
    if (Test-Path -LiteralPath $brave) {
        Start-Process -FilePath $brave -ArgumentList $url
    } else {
        Start-Process $url
    }
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { continue }
            while ($true) {
                $headerLine = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($headerLine)) { break }
            }

            $parts = $requestLine.Split(' ')
            $method = $parts[0]
            $relative = [System.Uri]::UnescapeDataString($parts[1].Split('?')[0]).TrimStart('/')
            if (-not $relative) { $relative = 'index.html' }
            $target = [System.IO.Path]::GetFullPath((Join-Path $root $relative.Replace('/', '\')))
            $insideRoot = $target.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
            $status = '200 OK'
            $bytes = [byte[]]@()

            if ($method -ne 'GET' -and $method -ne 'HEAD') {
                $status = '405 Method Not Allowed'
            } elseif (-not $insideRoot) {
                $status = '403 Forbidden'
            } elseif (-not [System.IO.File]::Exists($target)) {
                $status = '404 Not Found'
            } else {
                $bytes = [System.IO.File]::ReadAllBytes($target)
            }

            $mime = switch ([System.IO.Path]::GetExtension($target).ToLowerInvariant()) {
                '.html' { 'text/html; charset=utf-8' }
                '.js'   { 'text/javascript; charset=utf-8' }
                '.css'  { 'text/css; charset=utf-8' }
                '.svg'  { 'image/svg+xml' }
                '.png'  { 'image/png' }
                '.dxf'  { 'text/plain; charset=utf-8' }
                default { 'application/octet-stream' }
            }
            $headers = "HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -eq 'GET' -and $bytes.Length -gt 0) {
                $stream.Write($bytes, 0, $bytes.Length)
            }
            $stream.Flush()
            $reader.Dispose()
        } catch {
            Write-Host "Erreur sur une requete locale : $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
