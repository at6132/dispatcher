# Dispatcher launch load test (Windows)
# Prereqs: k6 installed (https://k6.io), server/.env with DATABASE_URL + JWT_ACCESS_SECRET
#          and LOAD_TEST_BYPASS_SECRET set on Railway + locally.

param(
  [ValidateSet('smoke', 'launch')]
  [string]$Mode = 'launch',
  [string]$BaseUrl = 'https://dispatcher-production-31d1.up.railway.app'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $Root 'server'
$Load = $PSScriptRoot
$Tokens = Join-Path $Load 'tokens'
$Reports = Join-Path $Load 'reports'

# Refresh PATH so a k6 install from this session is visible without reopening the terminal.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
  [System.Environment]::GetEnvironmentVariable('Path', 'User')
$k6 = Get-Command k6 -ErrorAction SilentlyContinue
if (-not $k6 -and (Test-Path 'C:\Program Files\k6\k6.exe')) {
  $env:Path = 'C:\Program Files\k6;' + $env:Path
  $k6 = Get-Command k6 -ErrorAction SilentlyContinue
}
if (-not $k6) {
  Write-Host 'k6 not found. Install: winget install k6 --source winget' -ForegroundColor Yellow
  Write-Host 'Then close/reopen this terminal, or run: $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")' -ForegroundColor Yellow
  exit 1
}

# Load server/.env into process (simple KEY=VALUE parser)
$EnvFile = Join-Path $Server '.env'
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $pair = $_.Split('=', 2)
    if ($pair.Length -eq 2) {
      $name = $pair[0].Trim()
      $val = $pair[1].Trim().Trim('"').Trim("'")
      [Environment]::SetEnvironmentVariable($name, $val, 'Process')
    }
  }
}

if (-not $env:DATABASE_URL -or -not $env:JWT_ACCESS_SECRET) {
  Write-Host 'Need DATABASE_URL and JWT_ACCESS_SECRET (put them in server/.env)' -ForegroundColor Red
  exit 1
}

if (-not $env:LOAD_TEST_BYPASS_SECRET) {
  Write-Host 'LOAD_TEST_BYPASS_SECRET missing — set the same value on Railway and in server/.env' -ForegroundColor Yellow
  Write-Host 'Without it, single-IP rate limits will fake-fail the run.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'IMPORTANT: API must be redeployed with the LOAD_TEST_BYPASS code + secret,' -ForegroundColor Yellow
Write-Host 'or every request from this machine will hit the 400/min IP ceiling.' -ForegroundColor Yellow
Write-Host ''

New-Item -ItemType Directory -Force -Path $Tokens, $Reports | Out-Null

$needSeed = -not (Test-Path (Join-Path $Tokens 'drivers.json')) -or
  -not (Test-Path (Join-Path $Tokens 'dispatchers.json'))
if ($needSeed -or $env:FORCE_SEED -eq '1') {
  Write-Host 'Seeding 2000 drivers + 500 dispatchers…' -ForegroundColor Cyan
  Push-Location $Server
  try {
    npx --yes tsx scripts/seed-load-users.ts
  } finally {
    Pop-Location
  }
} else {
  Write-Host 'Using existing load/tokens (set FORCE_SEED=1 to re-seed)' -ForegroundColor Cyan
}

$dash = Join-Path $Load 'dashboard\index.html'
Write-Host "Open monitor: $dash" -ForegroundColor Cyan
Start-Process $dash

$script = if ($Mode -eq 'smoke') { 'smoke.js' } else { 'launch.js' }
Write-Host "Running k6 $script against $BaseUrl …" -ForegroundColor Cyan

Push-Location (Join-Path $Load 'k6')
try {
  $env:BASE_URL = $BaseUrl
  $env:K6_WEB_DASHBOARD = 'true'
  $env:K6_WEB_DASHBOARD_PORT = '5665'
  $env:K6_WEB_DASHBOARD_EXPORT = (Join-Path $Reports 'k6-report.html')
  k6 run $script
} finally {
  Pop-Location
}

Write-Host "Done. Reports in $Reports" -ForegroundColor Green
