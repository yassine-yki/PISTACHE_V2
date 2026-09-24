param([switch]$Stop, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
$port = 4173
if ($env:SUIVI_HOTEL_PORT) {
    $parsedPort = 0
    if (-not [int]::TryParse($env:SUIVI_HOTEL_PORT, [ref]$parsedPort) -or $parsedPort -lt 1024 -or $parsedPort -gt 65535) {
        throw 'SUIVI_HOTEL_PORT doit etre compris entre 1024 et 65535.'
    }
    $port = $parsedPort
}
$url = "http://127.0.0.1:$port"
function Get-AppServer {
    try {
        $health = Invoke-RestMethod "$url/__suivi/health" -TimeoutSec 2 -ErrorAction Stop
        if ($health.app -eq 'suivi-hotel-r2' -and $health.root -eq $dist) { return $health }
    } catch {}
    return $null
}
try {
    $server = Get-AppServer
    if ($Stop) {
        if ($server) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($server.pid)"
            $serverScript = Join-Path $projectRoot 'portable_server.ps1'
            if (-not $process -or $process.CommandLine.IndexOf($serverScript, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw 'Le processus ne correspond pas au serveur de cette application.'
            }
            Stop-Process -Id $server.pid -ErrorAction Stop
            Write-Host 'Suivi arrete.'
        } else { Write-Host 'Aucun serveur de cette application en cours.' }
        exit 0
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) {
        throw 'Application compilee absente. Executez pnpm install puis pnpm run build dans ce dossier.'
    }
    if (-not $server) {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
        try { $probe.Start() } catch {
            throw "Le port $port est utilise par un autre serveur. Fermez-le puis relancez le suivi."
        } finally { $probe.Stop() }
        $runtime = Join-Path $projectRoot '.runtime'
        New-Item -ItemType Directory -Path $runtime -Force | Out-Null
        $serverScript = Join-Path $projectRoot 'portable_server.ps1'
        $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $serverScript + '"'), '-NoBrowser') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $server = Get-AppServer
            if ($server) { break }
            $child.Refresh()
            if ($child.HasExited) { break }
            Start-Sleep -Milliseconds 200
        }
        if (-not $server) {
            $child.Refresh()
            if (-not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
            throw "Le serveur n'a pas demarre. Consultez .runtime/server-error.log."
        }
    }
    Write-Host "Suivi disponible : $url"
    if (-not $NoBrowser -and $env:SUIVI_HOTEL_NO_BROWSER -ne '1') {
        $brave = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
        if (Test-Path -LiteralPath $brave) {
            Start-Process -FilePath $brave -ArgumentList "$url/?v=portable-r2-1"
        } else { Start-Process "$url/?v=portable-r2-1" }
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
