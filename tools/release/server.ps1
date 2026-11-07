param(
    [int]$StartPort = 18746,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'game'))
if (!(Test-Path -LiteralPath (Join-Path $root 'index.html'))) {
    throw 'Game files missing. Extract the entire ZIP before starting.'
}
$build = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw | ConvertFrom-Json
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $id = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root + $build.build))).Replace('-', '')
} finally { $sha.Dispose() }
$identity = 'OVERDUE/' + $id
$listener = $null
for ($port = $StartPort; $port -lt $StartPort + 20; $port++) {
    $candidate = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
    # Prevent another listener from binding the same address on Windows.
    $candidate.Server.ExclusiveAddressUse = $true
    try {
        $candidate.Start()
        $listener = $candidate
        break
    } catch {
        $candidate.Stop()
        # A repeated launch reopens this exact build and folder, never an unrelated service.
        $probe = New-Object Net.WebClient
        try {
            $probe.Proxy = $null
            $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$port/__overdue_health")
            $request.Proxy = $null
            $request.Timeout = 500
            $response = $request.GetResponse()
            try {
                $reader = New-Object IO.StreamReader($response.GetResponseStream())
                try { $existing = $reader.ReadToEnd() } finally { $reader.Dispose() }
            } finally { $response.Dispose() }
            if ($existing -ceq $identity) {
                Write-Host "READY http://127.0.0.1:$port/ (already running)"
                if (!$NoBrowser) { Start-Process "http://127.0.0.1:$port/" }
                exit 0
            }
        } catch { } finally { $probe.Dispose() }
    }
}
if ($null -eq $listener) { throw 'No free local port. Close an older OVERDUE window and retry.' }
$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
    '.woff2' = 'font/woff2'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'
    '.txt' = 'text/plain; charset=utf-8'; '.ico' = 'image/x-icon'
}
$url = "http://127.0.0.1:$port/"
Write-Host 'OVERDUE - portable edition'
Write-Host "READY $url"
Write-Host 'Keep this window open while playing. Close it to stop the game server.'
if ($port -ne $StartPort) { Write-Host 'Default port busy. This address has separate browser save data.' }
try {
    if (!$NoBrowser) { Start-Process $url }
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        $reader = $null
        $file = $null
        try {
            $client.ReceiveTimeout = 2000
            $client.SendTimeout = 5000
            $stream = $client.GetStream()
            $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $line = $reader.ReadLine()
            if (!$line -or $line.Length -gt 8192) { continue }
            $parts = $line.Split(' ')
            if ($parts.Length -ne 3) { continue }
            $method = $parts[0]
            $hostHeader = ''
            $headerSize = $line.Length
            while ($true) {
                $header = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($header)) { break }
                $headerSize += $header.Length
                if ($headerSize -gt 16384) { throw 'Request headers too large.' }
                if ($header.StartsWith('Host:', [StringComparison]::OrdinalIgnoreCase)) { $hostHeader = $header.Substring(5).Trim() }
            }
            $status = '200 OK'
            $type = 'text/plain; charset=utf-8'
            $body = [Text.Encoding]::UTF8.GetBytes('Not found')
            if ($hostHeader -cne "127.0.0.1:$port") {
                $status = '403 Forbidden'
            } elseif ($method -cne 'GET' -and $method -cne 'HEAD') {
                $status = '405 Method Not Allowed'
            } else {
                $path = [Uri]::UnescapeDataString(($parts[1] -split '\?', 2)[0])
                if ($path -ceq '/__overdue_health') {
                    $body = [Text.Encoding]::UTF8.GetBytes($identity)
                } else {
                    if ($path -eq '/') { $path = '/index.html' }
                    $local = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)))
                    $prefix = $root.TrimEnd('\') + '\'
                    if (!$local.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $path.Contains('\') -or $path.Contains(':')) {
                        $status = '403 Forbidden'
                    } elseif ([IO.File]::Exists($local)) {
                        $file = [IO.File]::OpenRead($local)
                        $ext = [IO.Path]::GetExtension($local).ToLowerInvariant()
                        $type = $mime[$ext]
                        if (!$type) { $type = 'application/octet-stream' }
                    } else { $status = '404 Not Found' }
                }
            }
            $length = if ($null -ne $file) { $file.Length } else { $body.Length }
            $headers = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $bytes = [Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($bytes, 0, $bytes.Length)
            if ($method -cne 'HEAD') {
                if ($null -ne $file) { $file.CopyTo($stream) }
                else { $stream.Write($body, 0, $body.Length) }
            }
            $stream.Flush()
        } catch {
            # A browser may abandon a request while navigating. Keep serving later requests.
        } finally {
            if ($null -ne $file) { $file.Dispose() }
            if ($null -ne $reader) { $reader.Dispose() }
            if ($null -ne $stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally { $listener.Stop() }
