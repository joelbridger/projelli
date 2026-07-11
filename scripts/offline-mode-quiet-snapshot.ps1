# Process-scoped companion evidence for the Offline Mode traffic gate.
#
# Packet Monitor on this Legion build has no PID/process filter (confirmed by
# `pktmon start help` on 2026-07-11), so Packet Monitor remains machine-wide.
# This script fills the attribution gap for TCP: it finds the Lantern process
# tree once per poll, then records every non-loopback TCP connection owned by
# those exact PIDs. It cannot attribute UDP packets; the packet capture remains
# the corroborating, machine-wide signal for that protocol.
param(
  [int]$DurationSeconds = 180,
  [int]$IntervalSeconds = 5,
  [string]$OutputPath = 'C:\offline-mode-gate\evidence\quiet-process-connections.json'
)
$ErrorActionPreference = 'Stop'

function Get-LanternProcessTree {
  $all = @(Get-CimInstance Win32_Process)
  $roots = @($all | Where-Object {
    $_.Name -ieq 'lantern.exe' -and $_.ExecutablePath -match '\\keepance\\src-tauri\\target\\debug\\lantern\.exe$'
  })
  $seen = [System.Collections.Generic.HashSet[uint32]]::new()
  $queue = [System.Collections.Generic.Queue[uint32]]::new()
  foreach ($root in $roots) {
    if ($seen.Add([uint32]$root.ProcessId)) { $queue.Enqueue([uint32]$root.ProcessId) }
  }
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $parent })) {
      if ($seen.Add([uint32]$child.ProcessId)) { $queue.Enqueue([uint32]$child.ProcessId) }
    }
  }
  @($all | Where-Object { $seen.Contains([uint32]$_.ProcessId) } |
    Select-Object ProcessId, ParentProcessId, Name, ExecutablePath)
}

function Get-ExternalTcpConnections($processes) {
  $rows = @()
  foreach ($process in $processes) {
    $connections = @(Get-NetTCPConnection -OwningProcess $process.ProcessId -ErrorAction SilentlyContinue)
    foreach ($connection in $connections) {
      # 0.0.0.0/:: and loopback are listeners or local-only traffic, not an
      # off-device connection attempt.
      if ($connection.RemoteAddress -notin @('127.0.0.1', '::1', '0.0.0.0', '::')) {
        $rows += [pscustomobject]@{
          processId = $process.ProcessId
          processName = $process.Name
          localAddress = $connection.LocalAddress
          localPort = $connection.LocalPort
          remoteAddress = $connection.RemoteAddress
          remotePort = $connection.RemotePort
          state = [string]$connection.State
        }
      }
    }
  }
  @($rows)
}

$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$samples = @()
$deadline = (Get-Date).ToUniversalTime().AddSeconds($DurationSeconds)
do {
  $processes = @(Get-LanternProcessTree)
  $external = @(Get-ExternalTcpConnections $processes)
  $samples += [pscustomobject]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    processTree = $processes
    externalTcpConnections = $external
  }
  if ((Get-Date).ToUniversalTime() -lt $deadline) { Start-Sleep -Seconds $IntervalSeconds }
} while ((Get-Date).ToUniversalTime() -lt $deadline)

$allExternal = @($samples | ForEach-Object { $_.externalTcpConnections })
$result = [pscustomobject]@{
  startedAt = $startedAt
  finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  durationSeconds = $DurationSeconds
  intervalSeconds = $IntervalSeconds
  precision = 'Process-tree TCP connection-table polling. Covers Lantern.exe and descendants, including its WebView2 children when parented by Lantern. It proves no owned non-loopback TCP connection was present at a poll, but cannot attribute UDP packets.'
  pktmonProcessScopedCapture = $false
  samples = $samples
  externalTcpConnectionCount = $allExternal.Count
  passed = ($samples.Count -gt 0 -and $samples[0].processTree.Count -gt 0 -and $allExternal.Count -eq 0)
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $OutputPath
if (-not $result.passed) { throw 'Lantern process-tree TCP connection check did not pass; inspect the saved JSON evidence.' }
