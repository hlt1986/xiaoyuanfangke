$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $ProjectRoot ".xiaoyuanfangke.pid"

function Write-Step($Message) {
  Write-Host "[xiaoyuanfangke] $Message"
}

function Stop-FromPidFile {
  if (!(Test-Path $PidFile)) {
    Write-Step "PID file was not found. Searching by project path."
    return $false
  }

  $rawPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (!$rawPid) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return $false
  }

  $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if (!$process) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Step "Recorded site process is already stopped."
    return $true
  }

  Stop-Process -Id $process.Id -Force
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Write-Step "Stopped site process. PID: $rawPid"
  return $true
}

function Stop-ByProjectPath {
  $escapedRoot = $ProjectRoot.Replace('\', '\\')
  $query = "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'"
  $processes = Get-CimInstance -Query $query -ErrorAction SilentlyContinue
  $matched = @($processes | Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like "*src\server.js*" -and
    ($_.CommandLine -like "*$ProjectRoot*" -or $_.CommandLine -like "*$escapedRoot*")
  })

  if ($matched.Count -eq 0) {
    Write-Step "No running site process was found."
    return
  }

  foreach ($item in $matched) {
    Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Step "Stopped site process. PID: $($item.ProcessId)"
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

try {
  if (!(Stop-FromPidFile)) {
    Stop-ByProjectPath
  }
  Write-Step "MySQL is not stopped by this script, so other local projects are not affected."
} catch {
  Write-Host ""
  Write-Host "Stop failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
