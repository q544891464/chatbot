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

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $projectRoot

Load-DotEnvFile -Path (Join-Path $projectRoot "server/.env")
Load-DotEnvFile -Path (Join-Path $projectRoot ".env")

if (-not $env:DIFY_BASE_URL) { $env:DIFY_BASE_URL = "http://220.154.0.29:8001/v1" }
if (-not $env:PORT) { $env:PORT = "8787" }
if (-not $env:CORS_ORIGIN) { $env:CORS_ORIGIN = "*" }

if (-not $env:DIFY_API_KEY) {
  Write-Host "Missing DIFY_API_KEY. Create server/.env with DIFY_API_KEY=app-... then rerun." -ForegroundColor Yellow
  exit 1
}

Write-Host "Starting proxy on http://localhost:$env:PORT (DIFY_BASE_URL=$env:DIFY_BASE_URL)" -ForegroundColor Cyan
node server/server.js
