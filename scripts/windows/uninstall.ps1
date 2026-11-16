<#
  Agent Ops - remove the auto-start and shortcuts, and stop it.
  Your data (data\agent-ops.db), agents\ and Claude settings are left in place.
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\uninstall.ps1
#>
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
foreach ($p in @(
  (Join-Path ([Environment]::GetFolderPath("Startup")) "Agent Ops.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "Agent Ops.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Programs")) "Agent Ops.lnk"))) {
  if (Test-Path $p) { Remove-Item $p -Force; Write-Host "removed $p" }
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Root*" } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
Write-Host "Agent Ops stopped and removed from Startup."
