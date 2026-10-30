param([switch]$OpenBrowser)

$ErrorActionPreference = "Stop"
$backend = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $backend
$pgBin = Join-Path $root ".tools\pgsql\bin"
$postgres = Join-Path $pgBin "postgres.exe"
$pgReady = Join-Path $pgBin "pg_isready.exe"
$data = Join-Path $root ".local-postgres\data-vc51"
$runtimeLogs = Join-Path $root ".local-postgres\logs"
$apiOut = Join-Path $runtimeLogs "api.out.log"
$apiErr = Join-Path $runtimeLogs "api.err.log"
$dbOut = Join-Path $runtimeLogs "postgres.out.log"
$dbErr = Join-Path $runtimeLogs "postgres.err.log"
$apiUrl = "http://localhost:3000/api/v1/health"

if (-not (Test-Path -LiteralPath (Join-Path $backend ".env"))) {
    throw "Local backend settings are missing."
}
if (-not (Test-Path -LiteralPath (Join-Path $data "global\pg_control"))) {
    throw "The local PostgreSQL data folder is missing or incomplete."
}
if (-not (Test-Path -LiteralPath $postgres) -or -not (Test-Path -LiteralPath $pgReady)) {
    throw "The local PostgreSQL tools are missing."
}
New-Item -ItemType Directory -Path $runtimeLogs -Force | Out-Null

function Test-DatabaseReady {
    & $pgReady -h 127.0.0.1 -p 5434 -d ono_food -U ono_app -q *> $null
    return $LASTEXITCODE -eq 0
}

function Test-ApiReady {
    try {
        return (Invoke-RestMethod -Uri $apiUrl -TimeoutSec 2).status -eq "ok"
    } catch {
        return $false
    }
}

if (-not (Test-DatabaseReady)) {
    $portInUse = Get-NetTCPConnection -LocalPort 5434 -State Listen -ErrorAction SilentlyContinue
    if ($portInUse) {
        throw "Port 5434 is busy, but ONO PostgreSQL is not ready."
    }
    $arguments = '-D "' + $data + '" -h 127.0.0.1 -p 5434 -c "listen_addresses=127.0.0.1"'
    Start-Process -FilePath $postgres -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $dbOut -RedirectStandardError $dbErr | Out-Null
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and -not (Test-DatabaseReady)) { Start-Sleep -Seconds 1 }
    if (-not (Test-DatabaseReady)) {
        throw "ONO PostgreSQL did not start. Check .local-postgres\logs\postgres.err.log."
    }
}

if (-not (Test-ApiReady)) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $node -ArgumentList "src/server.js" -WorkingDirectory $backend -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr | Out-Null
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and -not (Test-ApiReady)) { Start-Sleep -Seconds 1 }
    if (-not (Test-ApiReady)) {
        throw "ONO website did not start. Check .local-postgres\logs\api.err.log."
    }
}

Write-Host "ONO Food is running at http://localhost:3000"
if ($OpenBrowser) {
    try { Start-Process "http://localhost:3000" }
    catch { Write-Warning "The website is running, but the browser could not be opened automatically. Visit http://localhost:3000." }
}
