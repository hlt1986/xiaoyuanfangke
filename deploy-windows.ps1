$ErrorActionPreference = "Stop"

param(
  [string]$SiteUrl = "http://localhost:3000",
  [string]$DbHost = "localhost",
  [int]$DbPort = 3306,
  [string]$DbUser = "root",
  [string]$DbPassword = "root",
  [string]$DbName = "xiaoyuanfangke",
  [int]$Port = 3000
)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvPath = Join-Path $ProjectRoot ".env"

function Write-Step($Message) {
  Write-Host "[deploy-windows] $Message"
}

function Ensure-Command($Name, $InstallHint) {
  if (!(Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $InstallHint"
  }
}

function New-Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

Write-Step "Project root: $ProjectRoot"
Ensure-Command "node" "Please install Node.js 20+ first."
Ensure-Command "pnpm" "Please install pnpm first: npm install -g pnpm"

if (!(Test-Path $EnvPath)) {
  Write-Step "Creating .env"
  @"
PORT=$Port
BASE_URL=$SiteUrl

DB_HOST=$DbHost
DB_PORT=$DbPort
DB_USER=$DbUser
DB_PASSWORD=$DbPassword
DB_NAME=$DbName

SESSION_SECRET=$(New-Secret)
"@ | Set-Content -LiteralPath $EnvPath -Encoding UTF8
} else {
  Write-Step ".env already exists, keeping it unchanged."
}

Push-Location $ProjectRoot
try {
  Write-Step "Installing dependencies."
  pnpm install

  Write-Step "Initializing database."
  node -e "const { start, stop } = require('./src/server'); (async()=>{const s=await start(); await stop(s);})().catch(e=>{console.error(e); process.exit(1);});"

  Write-Step "Deployment finished."
  Write-Step "Start site: .\启动网站.bat"
  Write-Step "Stop site: .\停止网站.bat"
  Write-Step "Open: $SiteUrl"
} finally {
  Pop-Location
}
