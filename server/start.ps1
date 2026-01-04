$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Load-DotEnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path
  )

  if (-not (Test-Path -LiteralPath $Path)) { return }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = ($_ -as [string]).Trim()
    if (-not $line) { return }
    if ($line.StartsWith("#")) { return }

    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }

    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()

    # Strip optional quotes
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }

    if (-not $key) { return }
    if (-not (Test-Path "Env:$key")) {
      Set-Item -Path "Env:$key" -Value $val
    }
  }
}

function Get-LanIPv4 {
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -InterfaceOperationalStatus Up -ErrorAction Stop |
      Where-Object { $_.IPAddress -and $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notmatch "^169\\.254\\." } |
      Select-Object -ExpandProperty IPAddress -Unique
    if ($ips) {
      return @($ips)
    }
  } catch {
    # fallback to parsing ipconfig output
  }

  try {
    $raw = ipconfig | Out-String
    $regex = '\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b'
    $ips = [regex]::Matches($raw, $regex) |
      ForEach-Object { $_.Value } |
      Where-Object { $_ -ne "127.0.0.1" -and $_ -notmatch "^169\\.254\\." } |
      Select-Object -Unique
    return @($ips)
  } catch {
    return @()
  }
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $projectRoot

Load-DotEnvFile -Path (Join-Path $projectRoot "server/.env")
Load-DotEnvFile -Path (Join-Path $projectRoot ".env")

if (-not $env:DIFY_BASE_URL) { $env:DIFY_BASE_URL = "http://220.154.0.29:8001/v1" }
if (-not $env:PORT) { $env:PORT = "8787" }
if (-not $env:CORS_ORIGIN) { $env:CORS_ORIGIN = "*" }

Write-Host "Starting proxy on http://0.0.0.0:$env:PORT" -ForegroundColor Cyan
$lanIps = Get-LanIPv4
if ($lanIps.Count -gt 0) {
  Write-Host ("LAN IP: " + ($lanIps -join ", ")) -ForegroundColor Cyan
}
node server/server.js
