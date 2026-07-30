$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $ProjectRoot ".xiaoyuanfangke.pid"
$LogsDir = Join-Path $ProjectRoot "logs"
$OutLog = Join-Path $LogsDir "app.out.log"
$ErrLog = Join-Path $LogsDir "app.err.log"
$HealthUrl = "http://localhost:3000/health"

function Write-Step($Message) {
  Write-Host "[xiaoyuanfangke] $Message"
}

function Test-TcpPort($HostName, $Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $success = $async.AsyncWaitHandle.WaitOne(1000, $false)
    if ($success) {
      $client.EndConnect($async)
      $client.Close()
      return $true
    }
    $client.Close()
    return $false
  } catch {
    return $false
  }
}

function Resolve-Node {
  $bundledNode = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundledNode) {
    return $bundledNode
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  throw "Node.js was not found. Please install Node.js first."
}

function Resolve-Pnpm {
  $bundledPnpm = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
  if (Test-Path $bundledPnpm) {
    return $bundledPnpm
  }

  $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pnpmCommand) {
    return $pnpmCommand.Source
  }

  return $null
}

function Test-RunningFromPidFile {
  if (!(Test-Path $PidFile)) {
    return $false
  }

  $rawPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (!$rawPid) {
    return $false
  }

  $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if (!$process) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return $false
  }

  Write-Step "Site is already running. PID: $rawPid"
  return $true
}

function Ensure-MySql {
  if (Test-TcpPort "localhost" 3306) {
    Write-Step "MySQL is running at localhost:3306."
    return
  }

  Write-Step "MySQL port is not open. Trying common Windows service names."
  $serviceNames = @("MySQL80", "MySQL", "mysql", "MariaDB", "MariaDB10")
  foreach ($serviceName in $serviceNames) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service) {
      try {
        if ($service.Status -ne "Running") {
          Start-Service -Name $serviceName
          Start-Sleep -Seconds 3
        }
        if (Test-TcpPort "localhost" 3306) {
          Write-Step "Started MySQL service: $serviceName"
          return
        }
      } catch {
        Write-Step "Failed to start service ${serviceName}: $($_.Exception.Message)"
      }
    }
  }

  throw "MySQL is not running. Please start MySQL manually and confirm localhost:3306 works with root/root."
}

function Ensure-Dependencies {
  if (Test-Path (Join-Path $ProjectRoot "node_modules")) {
    Write-Step "Dependencies are installed."
    return
  }

  $pnpm = Resolve-Pnpm
  if (!$pnpm) {
    throw "pnpm was not found and node_modules does not exist. Please install dependencies first."
  }

  Write-Step "Installing dependencies for first run."
  Push-Location $ProjectRoot
  try {
    & $pnpm install
  } finally {
    Pop-Location
  }
}

function Start-Site {
  if (!(Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
  }

  $node = Resolve-Node
  Write-Step "Starting site service."
  $process = Start-Process `
    -FilePath $node `
    -ArgumentList "src\server.js" `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru `
    -WindowStyle Hidden

  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII

  for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 1
    if ($process.HasExited) {
      $err = ""
      if (Test-Path $ErrLog) {
        $err = Get-Content $ErrLog -Tail 20 -ErrorAction SilentlyContinue | Out-String
      }
      Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
      throw "Site failed to start. Error log:`n$err"
    }

    try {
      $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        Write-Step "Site started: http://localhost:3000/"
        Write-Step "Admin login: http://localhost:3000/login"
        Write-Step "Screen page: http://localhost:3000/screen"
        Write-Step "PID: $($process.Id)"
        return
      }
    } catch {
      # Wait until Express and MySQL initialization is complete.
    }
  }

  Write-Step "Site process started, but health check did not answer yet."
  Write-Step "Open http://localhost:3000/ later, or check log: $ErrLog"
}

try {
  Write-Step "Project root: $ProjectRoot"
  if (Test-RunningFromPidFile) {
    exit 0
  }
  Ensure-MySql
  Ensure-Dependencies
  Start-Site
} catch {
  Write-Host ""
  Write-Host "Start failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
