<#
  Agent Ops - one-time setup for Windows. Safe to run again (it also updates).

  Run by Claude (Claude desktop app, Code tab), or by hand:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\install.ps1

  What it does:
    1. Installs Node.js LTS (via winget) if it's missing
    2. Gets the latest code (git pull) if this is a git checkout
    3. Installs dependencies, builds the database driver, builds the dashboard
    4. Installs the Claude Code reporting hooks (merged into %USERPROFILE%\.claude\settings.json, backup kept)
    5. Starts Agent Ops at every Windows login, with no window (Startup shortcut)
    6. Adds an "Agent Ops" shortcut to the desktop and Start menu
    7. Starts it now and opens http://localhost:4321

  Options: -NoStartup -NoShortcuts -NoHooks -NoStart -NoBrowser -NoUpdate
#>
param(
  [switch]$NoStartup, [switch]$NoShortcuts, [switch]$NoHooks,
  [switch]$NoStart, [switch]$NoBrowser, [switch]$NoUpdate
)
$ErrorActionPreference = "Continue"  # native tools write progress to stderr; failures are checked via $LASTEXITCODE
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Logs = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
try { Start-Transcript -Path (Join-Path $Logs "install.log") -Append | Out-Null } catch {}

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !   $msg" -ForegroundColor Yellow }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Node-Version {
  try { return [version]((& node -v) -replace '^v', '') } catch { return $null }
}

# 1. Node.js -----------------------------------------------------------------
Step "Checking Node.js"
$v = Node-Version
function Node-TooOld($v) { return (-not $v) -or ($v.Major -lt 22) -or ($v.Major -eq 22 -and $v.Minor -lt 13) }
if (Node-TooOld $v) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "    Installing Node.js LTS with winget..."
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
    Refresh-Path
    $v = Node-Version
  }
  if (Node-TooOld $v) { throw "Node.js 22.13 or newer is required (it includes the database Agent Ops uses). Install the LTS version from https://nodejs.org and run this again." }
}
Ok "Node.js $v"
$Node = (Get-Command node).Source
$NpmCli = Join-Path (Split-Path $Node) "node_modules\npm\bin\npm-cli.js"
function Npm { param([Parameter(ValueFromRemainingArguments = $true)]$a)
  if (Test-Path $NpmCli) { & $Node $NpmCli @a } else { & npm.cmd @a }
  if ($LASTEXITCODE -ne 0) { throw "npm $($a -join ' ') failed (exit $LASTEXITCODE)" }
}

# Stop a running copy so the new version is used ---------------------------
Step "Stopping a running Agent Ops (if any)"
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Root*" }
foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }
Ok ("stopped {0} process(es)" -f @($procs).Count)

Set-Location $Root

# 2. Latest code --------------------------------------------------------------
if (-not $NoUpdate -and (Test-Path (Join-Path $Root ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
  Step "Getting the latest version"
  git pull --ff-only | Out-Host
  if ($LASTEXITCODE -ne 0) { Warn "git pull failed; continuing with the current version" } else { Ok "up to date" }
}

# 3. Dependencies + build ------------------------------------------------------
Step "Installing dependencies (first time takes a few minutes)"
Npm install --no-audit --no-fund
Ok "dependencies ready"
Step "Building the dashboard"
& $Node (Join-Path $Root "node_modules\next\dist\bin\next") build | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Build failed. See the output above." }
$head = (git rev-parse HEAD 2>$null)
if ($head) { Set-Content -Path (Join-Path $Root ".next\agent-ops-source") -Value $head -NoNewline }
Ok "built"

# 4. Hooks --------------------------------------------------------------------
if (-not $NoHooks) {
  Step "Installing the Claude Code reporting hooks"
  & $Node (Join-Path $Root "node_modules\tsx\dist\cli.mjs") (Join-Path $Root "scripts\install-hooks.ts") | Out-Host
  if ($LASTEXITCODE -ne 0) { Warn "couldn't install hooks; you can do it later from Settings" } else { Ok "hooks installed" }
}

# 5/6. Shortcuts -------------------------------------------------------------
$Wscript = Join-Path $env:WINDIR "System32\wscript.exe"
$Launch = Join-Path $Root "scripts\windows\launch.vbs"
$Open = Join-Path $Root "scripts\windows\open.vbs"
$Icon = Join-Path $Root "public\agent-ops.ico"
function New-Shortcut($path, $script, $desc) {
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut($path)
  $s.TargetPath = $Wscript
  $s.Arguments = '"' + $script + '"'
  $s.WorkingDirectory = $Root
  $s.Description = $desc
  if (Test-Path $Icon) { $s.IconLocation = $Icon }
  $s.Save()
}
if (-not $NoStartup) {
  Step "Starting Agent Ops automatically when you log in"
  New-Shortcut (Join-Path ([Environment]::GetFolderPath("Startup")) "Agent Ops.lnk") $Launch "Starts Agent Ops in the background"
  Ok "added to Startup"
}
if (-not $NoShortcuts) {
  Step "Adding the Agent Ops shortcut"
  New-Shortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Agent Ops.lnk") $Open "Open the Agent Ops dashboard"
  $menu = Join-Path ([Environment]::GetFolderPath("Programs")) "Agent Ops.lnk"
  New-Shortcut $menu $Open "Open the Agent Ops dashboard"
  Ok "desktop and Start menu"
}

# 7. Start --------------------------------------------------------------------
if (-not $NoStart) {
  Step "Starting Agent Ops"
  Start-Process -FilePath $Wscript -ArgumentList ('"' + $Launch + '"') -WindowStyle Hidden
  $up = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:4321/api/health"; if ($r.StatusCode -eq 200) { $up = $true; break } } catch {}
  }
  if ($up) { Ok "running at http://localhost:4321" } else { Warn "still starting; see data\logs\supervisor.log" }
  if (-not $NoBrowser) { Start-Process "http://localhost:4321" }
}

Write-Host ""
Write-Host "Agent Ops is set up. Open it any time with the 'Agent Ops' shortcut on your desktop." -ForegroundColor Green
try { Stop-Transcript | Out-Null } catch {}
