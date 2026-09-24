param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$port = 4173
if ($env:SUIVI_HOTEL_PORT) {
    $parsedPort = 0
    if (-not [int]::TryParse($env:SUIVI_HOTEL_PORT, [ref]$parsedPort) -or $parsedPort -lt 1024 -or $parsedPort -gt 65535) {
        throw 'SUIVI_HOTEL_PORT doit etre compris entre 1024 et 65535.'
    }
    $port = $parsedPort
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'index.html'))) {
    throw 'Application compilee absente. Executez pnpm run build.'
}
$url = "http://127.0.0.1:$port/?v=portable-r2-1"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)

try {
    $listener.Start()
} catch {
    Write-Host "Impossible de demarrer le suivi sur le port $port. Fermez l'autre serveur eventuel, puis relancez." -ForegroundColor Red

    exit 1
}

Write-Host "Suivi des chambres : $url"
Write-Host 'Gardez cette fenetre ouverte. Ctrl+C pour arreter.'
if (-not $NoBrowser -and $env:SUIVI_HOTEL_NO_BROWSER -ne '1') {
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
            $stream.ReadTimeout = 3000
            $stream.WriteTimeout = 10000
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
            } elseif ($relative -eq '__suivi/health') {
                $health = @{ app = 'suivi-hotel-r2'; root = $root; pid = $PID } | ConvertTo-Json -Compress
                $bytes = [Text.Encoding]::UTF8.GetBytes($health)
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
            if ($relative -eq '__suivi/health') { $mime = 'application/json; charset=utf-8' }
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
