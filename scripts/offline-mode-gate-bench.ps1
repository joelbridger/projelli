# Temporary Windows-bench setup/cleanup for the Offline Mode traffic gate.
# Packet Monitor is passive: it never binds DNS, changes the Wi-Fi DNS server,
# or competes with Windows' DNS Client service. Run setup, smoke, launch,
# capture-start, then capture-stop; always finish with cleanup.
param([ValidateSet('setup','smoke','launch','proxy-start','capture-start','capture-stop','cleanup')][string]$Action)
$ErrorActionPreference = 'Stop'
$root = if ($env:OFFLINE_GATE_ROOT) { $env:OFFLINE_GATE_ROOT } else { 'C:\offline-mode-gate' }
$evidence = "$root\evidence"
$state = "$root\pre-gate-state.json"
$pktmonMarker = "$root\pktmon-gate-active.txt"
$proxyPort = 18080
$cdpPort = if ($env:OFFLINE_GATE_CDP_PORT) { $env:OFFLINE_GATE_CDP_PORT } else { '9223' }
$vitePort = if ($env:OFFLINE_GATE_VITE_PORT) { $env:OFFLINE_GATE_VITE_PORT } else { '5173' }
$appRoot = if ($env:OFFLINE_GATE_APP_ROOT) { $env:OFFLINE_GATE_APP_ROOT } else { 'C:\keepance' }
$python = 'C:\Users\james\AppData\Local\Programs\Python\Python312\python.exe'
$mitm = 'C:\Users\james\AppData\Roaming\Python\Python312\Scripts\mitmdump.exe'
$lantern = Join-Path $appRoot 'src-tauri\target\debug\lantern.exe'
$webview = Get-ChildItem 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe' | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
$node = (Get-Command node -ErrorAction Stop).Source

function Stop-GateProcesses {
  # Do not match this setup PowerShell process itself. Only the disposable
  # recording proxy is safe to stop here.
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*mitmdump*offline-mode-proxy-log*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-GateProxy {
  Stop-GateProcesses
  $proxyRunner = "$root\run-proxy.cmd"
  @"
@echo off
set OFFLINE_GATE_PROXY_LOG=$evidence\proxy.jsonl
"$mitm" -q --listen-host 127.0.0.1 -p $proxyPort --set "confdir=$root\mitm" -s "$appRoot\scripts\offline-mode-proxy-log.py" -w "$evidence\proxy.flows"
"@ | Set-Content -Encoding ASCII $proxyRunner
  # Like Lantern itself, run the long-lived recorder in the real interactive
  # desktop session. SSH-owned child processes are otherwise torn down when
  # their remote shell closes.
  schtasks.exe /Create /TN '\LanternOfflineGateProxy' /TR "cmd.exe /c $proxyRunner" /SC ONCE /ST 00:00 /RL HIGHEST /IT /F | Out-File "$evidence\proxy-task-create.log"
  schtasks.exe /Run /TN '\LanternOfflineGateProxy' | Out-File "$evidence\proxy-task-start.log"
  Start-Sleep -Seconds 3
  if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port $proxyPort -InformationLevel Quiet)) { throw 'mitmproxy did not open its recording listener.' }
}

function Assert-PktMonIdle {
  $status = (pktmon status | Out-String)
  if ($status -notmatch 'not running') {
    throw 'Packet Monitor is already in use. Do not disturb another bench capture.'
  }
}

function Start-GateCapture([string]$stem) {
  Assert-PktMonIdle
  $etl = Join-Path $evidence "$stem.etl"
  Remove-Item $etl, (Join-Path $evidence "$stem.pcapng"), (Join-Path $evidence "$stem.txt"), (Join-Path $evidence "$stem-analysis.json") -Force -ErrorAction SilentlyContinue
  # All components deliberately includes the DNS Client/WFP path as well as
  # NIC packets. The analyzer retains the raw pcapng and decoded ETL text.
  pktmon start --capture --comp all --pkt-size 0 --file-name $etl --file-size 128
  [pscustomobject]@{ stem=$stem; etl=$etl; startedAt=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -Encoding UTF8 $pktmonMarker
}

function Stop-GateCapture {
  if (-not (Test-Path $pktmonMarker)) { throw 'This gate did not start Packet Monitor.' }
  $capture = Get-Content $pktmonMarker -Raw | ConvertFrom-Json
  pktmon stop
  $pcap = Join-Path $evidence "$($capture.stem).pcapng"
  $txt = Join-Path $evidence "$($capture.stem).txt"
  $analysis = Join-Path $evidence "$($capture.stem)-analysis.json"
  pktmon etl2pcap $capture.etl --out $pcap
  pktmon etl2txt $capture.etl --out $txt
  & $node (Join-Path $appRoot 'scripts\offline-mode-pktmon-analyze.mjs') --text $txt --pcap $pcap --output $analysis
  if ($LASTEXITCODE -ne 0) { throw 'Packet Monitor analysis failed.' }
  Remove-Item $pktmonMarker -Force
}

if ($Action -eq 'setup') {
  Assert-PktMonIdle
  New-Item -ItemType Directory -Force -Path $evidence, "$root\appdata\Roaming\com.lantern.app", "$root\appdata\Local", "$root\workspace", "$root\mitm" | Out-Null
  $proxyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $oldProxy = Get-ItemProperty -Path $proxyKey | Select-Object ProxyEnable,ProxyServer,ProxyOverride
  $oldWinHttp = (& netsh winhttp show proxy | Out-String)
  [pscustomobject]@{ createdAt=(Get-Date).ToUniversalTime().ToString('o'); proxy=$oldProxy; winHttp=$oldWinHttp } |
    ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $state
  Get-NetFirewallRule -DisplayName 'Lantern Offline Gate*' -ErrorAction SilentlyContinue | Export-Clixml "$evidence\firewall-before.xml"
  Copy-Item 'C:\run-dev.bat' "$evidence\run-dev.before.bat" -Force

  Start-GateProxy
  $cert = "$root\mitm\mitmproxy-ca-cert.cer"
  if (-not (Test-Path $cert)) { throw 'mitmproxy did not create its disposable certificate.' }
  $certInfo = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cert)
  $certInfo.Thumbprint | Set-Content "$evidence\mitm-ca-thumbprint.txt"
  & certutil -user -addstore Root $cert | Out-File "$evidence\mitm-cert-install.log"

  Set-ItemProperty -Path $proxyKey -Name ProxyEnable -Value 1
  Set-ItemProperty -Path $proxyKey -Name ProxyServer -Value "127.0.0.1:$proxyPort"
  Set-ItemProperty -Path $proxyKey -Name ProxyOverride -Value '<local>;127.0.0.1;localhost;::1'
  & netsh winhttp set proxy "127.0.0.1:$proxyPort" bypass-list='127.0.0.1;localhost;::1' | Out-File "$evidence\winhttp-set.log"

  New-NetFirewallRule -DisplayName 'Lantern Offline Gate - Lantern remote block' -Direction Outbound -Action Block -Program $lantern -RemoteAddress Internet -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName 'Lantern Offline Gate - WebView remote block' -Direction Outbound -Action Block -Program $webview -RemoteAddress Internet -Profile Any | Out-Null
  Get-NetFirewallRule -DisplayName 'Lantern Offline Gate*' | Get-NetFirewallAddressFilter | Format-List * | Out-File "$evidence\firewall-active.txt"

  @{ version=1; offlineMode=$true; updatedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress |
    Set-Content -Encoding UTF8 "$root\appdata\Roaming\com.lantern.app\network-policy.json"
  @"
@echo off
set APPDATA=$root\appdata\Roaming
set LOCALAPPDATA=$root\appdata\Local
set LANTERN_DEV_PORT=$vitePort
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=$cdpPort
set LANTERN_OFFLINE_GATE_PROXY=http://127.0.0.1:$proxyPort
set OFFLINE_GATE_OUT=$evidence
set OFFLINE_GATE_WORKSPACE=$root\workspace
set HTTP_PROXY=http://127.0.0.1:$proxyPort
set HTTPS_PROXY=http://127.0.0.1:$proxyPort
set ALL_PROXY=http://127.0.0.1:$proxyPort
set NO_PROXY=127.0.0.1,localhost,::1
cd /d $appRoot
npm run tauri:dev
"@ | Set-Content -Encoding ASCII "$root\run-gate.cmd"
  'SETUP_COMPLETE' | Set-Content "$evidence\setup-status.txt"
  exit 0
}

if ($Action -eq 'smoke') {
  if (-not (Test-Path $state)) { throw 'Run setup before the packet-recorder smoke test.' }
  Start-GateCapture 'recorder-smoke'
  try {
    # Ask the currently configured real resolver directly. This proves that
    # port-53 packets are observable without changing the machine's DNS setup.
    $dnsServer = (Get-DnsClientServerAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4).ServerAddresses | Select-Object -First 1
    if (-not $dnsServer) { throw 'Wi-Fi has no IPv4 DNS server for the smoke test.' }
    Resolve-DnsName -Name 'www.cloudflare.com' -Server $dnsServer -DnsOnly | Out-File "$evidence\recorder-smoke-dns.txt"
    $smokeUrl = "https://www.cloudflare.com/cdn-cgi/trace?offline-gate=$([guid]::NewGuid().ToString('N'))"
    & curl.exe --noproxy '*' --fail --silent --show-error $smokeUrl --output "$evidence\recorder-smoke-body.txt"
    if ($LASTEXITCODE -ne 0) { throw "Packet-recorder smoke request failed with curl exit code $LASTEXITCODE." }
  } finally {
    Stop-GateCapture
  }
  $analysis = Get-Content "$evidence\recorder-smoke-analysis.json" -Raw | ConvertFrom-Json
  $passed = ($analysis.outboundDnsQueries.Count -gt 0 -and $analysis.outboundTcpSyn.Count -gt 0)
  [pscustomobject]@{ at=(Get-Date).ToUniversalTime().ToString('o'); dnsServer=$dnsServer; analysis='recorder-smoke-analysis.json'; passed=$passed } |
    ConvertTo-Json | Set-Content "$evidence\recorder-smoke.json"
  if (-not $passed) { throw 'Packet Monitor did not observe both the DNS query and external TCP SYN from the smoke request.' }
  exit 0
}

if ($Action -eq 'launch') {
  if (-not (Test-Path "$evidence\recorder-smoke.json")) { throw 'Run and pass the packet-recorder smoke test before launching Lantern.' }
  # The scheduled launcher runs in the real interactive desktop session.
  # Starting a WebView directly from SSH creates a non-interactive process that
  # cannot expose CDP, so temporarily substitute the command it runs instead.
  Copy-Item "$root\run-gate.cmd" 'C:\run-dev.bat' -Force
  schtasks.exe /Run /TN '\KeepanceDev' | Out-File "$evidence\launcher-task-start.log"
  'LAUNCH_COMPLETE' | Set-Content "$evidence\launch-status.txt"
  exit 0
}

if ($Action -eq 'capture-start') {
  $captureStem = if ($env:OFFLINE_GATE_CAPTURE_STEM) { $env:OFFLINE_GATE_CAPTURE_STEM } else { 'gate-capture' }
  Start-GateCapture $captureStem
  'CAPTURE_STARTED' | Set-Content "$evidence\capture-status.txt"
  exit 0
}

if ($Action -eq 'proxy-start') {
  Start-GateProxy
  exit 0
}

if ($Action -eq 'capture-stop') {
  Stop-GateCapture
  'CAPTURE_STOPPED' | Set-Content "$evidence\capture-status.txt"
  exit 0
}

if (Test-Path $pktmonMarker) {
  try { Stop-GateCapture } catch { $_ | Out-File "$evidence\pktmon-cleanup-error.log" }
}
if (Test-Path $state) {
  $old = Get-Content $state -Raw | ConvertFrom-Json
  $proxyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  Set-ItemProperty -Path $proxyKey -Name ProxyEnable -Value ([int]$old.proxy.ProxyEnable)
  Set-ItemProperty -Path $proxyKey -Name ProxyServer -Value ([string]$old.proxy.ProxyServer)
  Set-ItemProperty -Path $proxyKey -Name ProxyOverride -Value ([string]$old.proxy.ProxyOverride)
  & netsh winhttp reset proxy | Out-File "$evidence\winhttp-reset.log"
}
Get-Content "$evidence\mitm-ca-thumbprint.txt" -ErrorAction SilentlyContinue | ForEach-Object { & certutil -user -delstore Root $_ | Out-File "$evidence\mitm-cert-remove.log" }
Remove-NetFirewallRule -DisplayName 'Lantern Offline Gate*' -ErrorAction SilentlyContinue
Stop-GateProcesses
schtasks.exe /Delete /TN '\LanternOfflineGateProxy' /F 2>$null | Out-File "$evidence\proxy-task-remove.log"
if (Test-Path "$evidence\run-dev.before.bat") { Copy-Item "$evidence\run-dev.before.bat" 'C:\run-dev.bat' -Force }
Get-NetFirewallRule -DisplayName 'Lantern Offline Gate*' -ErrorAction SilentlyContinue | Format-List * | Out-File "$evidence\firewall-after.txt"
'CLEANUP_COMPLETE' | Set-Content "$evidence\cleanup-status.txt"
