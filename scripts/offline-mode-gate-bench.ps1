# Temporary Windows-bench setup/cleanup for the Offline Mode traffic gate.
# It never alters the normal launcher and writes every prior state to the
# evidence folder before changing it. Run `setup`, verify `smoke`, then
# `launch`; always finish with `cleanup`.
param([ValidateSet('setup','smoke','launch','cleanup')][string]$Action)
$ErrorActionPreference = 'Stop'
$root = 'C:\offline-mode-gate'
$evidence = "$root\evidence"
$state = "$root\pre-gate-state.json"
$proxyPort = 18080
$cdpPort = if ($env:OFFLINE_GATE_CDP_PORT) { $env:OFFLINE_GATE_CDP_PORT } else { '9223' }
$vitePort = if ($env:OFFLINE_GATE_VITE_PORT) { $env:OFFLINE_GATE_VITE_PORT } else { '5173' }
$appRoot = if ($env:OFFLINE_GATE_APP_ROOT) { $env:OFFLINE_GATE_APP_ROOT } else { 'C:\keepance' }
$python = 'C:\Users\james\AppData\Local\Programs\Python\Python312\python.exe'
$mitm = 'C:\Users\james\AppData\Roaming\Python\Python312\Scripts\mitmdump.exe'
$lantern = Join-Path $appRoot 'src-tauri\target\debug\lantern.exe'
$webview = Get-ChildItem 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe' | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName

function Stop-GateProcesses {
  # Do not match this setup PowerShell process itself: its command line has the
  # gate script name. Only the two recorder helpers are safe to stop here.
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*mitmdump*offline-mode-proxy-log*' -or $_.CommandLine -like '*offline-mode-dns-sink*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Action -eq 'setup') {
  New-Item -ItemType Directory -Force -Path $evidence, "$root\appdata\Roaming\com.lantern.app", "$root\appdata\Local", "$root\workspace", "$root\mitm" | Out-Null
  $proxyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $oldProxy = Get-ItemProperty -Path $proxyKey | Select-Object ProxyEnable,ProxyServer,ProxyOverride
  $oldDns = Get-DnsClientServerAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 | Select-Object InterfaceAlias,ServerAddresses
  $oldWinHttp = (& netsh winhttp show proxy | Out-String)
  [pscustomobject]@{ createdAt=(Get-Date).ToUniversalTime().ToString('o'); proxy=$oldProxy; dns=$oldDns; winHttp=$oldWinHttp } |
    ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $state
  Get-NetFirewallRule -DisplayName 'Lantern Offline Gate*' -ErrorAction SilentlyContinue | Export-Clixml "$evidence\firewall-before.xml"

  Stop-GateProcesses
  Start-Process -FilePath $python -ArgumentList (Join-Path $appRoot 'scripts\offline-mode-dns-sink.py') -WindowStyle Hidden -RedirectStandardOutput "$evidence\dns-stdout.log" -RedirectStandardError "$evidence\dns-stderr.log"
  Start-Process -FilePath $mitm -ArgumentList @('-q','--listen-host','127.0.0.1','-p',$proxyPort,'--set',"confdir=$root\mitm",'-s',(Join-Path $appRoot 'scripts\offline-mode-proxy-log.py'),'-w',"$evidence\proxy.flows") -WindowStyle Hidden -RedirectStandardOutput "$evidence\proxy-stdout.log" -RedirectStandardError "$evidence\proxy-stderr.log"
  Start-Sleep -Seconds 3
  $cert = "$root\mitm\mitmproxy-ca-cert.cer"
  if (-not (Test-Path $cert)) { throw 'mitmproxy did not create its disposable certificate.' }
  $certInfo = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cert)
  $certInfo.Thumbprint | Set-Content "$evidence\mitm-ca-thumbprint.txt"
  & certutil -user -addstore Root $cert | Out-File "$evidence\mitm-cert-install.log"

  Set-ItemProperty -Path $proxyKey -Name ProxyEnable -Value 1
  Set-ItemProperty -Path $proxyKey -Name ProxyServer -Value "127.0.0.1:$proxyPort"
  Set-ItemProperty -Path $proxyKey -Name ProxyOverride -Value '<local>;127.0.0.1;localhost;::1'
  & netsh winhttp set proxy "127.0.0.1:$proxyPort" bypass-list='127.0.0.1;localhost;::1' | Out-File "$evidence\winhttp-set.log"
  Set-DnsClientServerAddress -InterfaceAlias 'Wi-Fi' -ServerAddresses '127.0.0.1'

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
set HTTP_PROXY=http://127.0.0.1:$proxyPort
set HTTPS_PROXY=http://127.0.0.1:$proxyPort
set ALL_PROXY=http://127.0.0.1:$proxyPort
set NO_PROXY=127.0.0.1,localhost,::1
cd /d $appRoot
npm run tauri:dev
"@ | Set-Content -Encoding ASCII "$root\run-gate.cmd"
  "SETUP_COMPLETE" | Set-Content "$evidence\setup-status.txt"
  exit 0
}

if ($Action -eq 'smoke') {
  if (-not (Test-Path $state)) { throw 'Run setup before the recorder smoke test.' }
  Clear-DnsClientCache
  $smokeUrl = "https://www.cloudflare.com/cdn-cgi/trace?offline-gate=$([guid]::NewGuid().ToString('N'))"
  & curl.exe --fail --silent --show-error --proxy "http://127.0.0.1:$proxyPort" $smokeUrl --output "$evidence\recorder-smoke-body.txt"
  if ($LASTEXITCODE -ne 0) { throw "Recorder smoke request failed with curl exit code $LASTEXITCODE." }
  Start-Sleep -Milliseconds 500
  $proxyLines = (Get-Content "$evidence\proxy.jsonl" -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
  $dnsLines = (Get-Content "$evidence\dns.jsonl" -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
  [pscustomobject]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    url = $smokeUrl
    proxyLines = $proxyLines
    dnsLines = $dnsLines
    passed = ($proxyLines -gt 0 -and $dnsLines -gt 0)
  } | ConvertTo-Json | Set-Content "$evidence\recorder-smoke.json"
  if ($proxyLines -le 0 -or $dnsLines -le 0) { throw 'Recorder smoke request was not visible in both proxy and DNS logs.' }
  exit 0
}

if ($Action -eq 'launch') {
  if (-not (Test-Path "$evidence\recorder-smoke.json")) { throw 'Run and pass the recorder smoke test before launching Lantern.' }
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "$root\run-gate.cmd" -WorkingDirectory $appRoot -RedirectStandardOutput "$evidence\lantern-stdout.log" -RedirectStandardError "$evidence\lantern-stderr.log"
  'LAUNCH_COMPLETE' | Set-Content "$evidence\launch-status.txt"
  exit 0
}

if (Test-Path $state) {
  $old = Get-Content $state -Raw | ConvertFrom-Json
  $proxyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  Set-ItemProperty -Path $proxyKey -Name ProxyEnable -Value ([int]$old.proxy.ProxyEnable)
  Set-ItemProperty -Path $proxyKey -Name ProxyServer -Value ([string]$old.proxy.ProxyServer)
  Set-ItemProperty -Path $proxyKey -Name ProxyOverride -Value ([string]$old.proxy.ProxyOverride)
  & netsh winhttp reset proxy | Out-File "$evidence\winhttp-reset.log"
  foreach ($item in $old.dns) { Set-DnsClientServerAddress -InterfaceAlias $item.InterfaceAlias -ServerAddresses @($item.ServerAddresses) }
}
Get-Content "$evidence\mitm-ca-thumbprint.txt" -ErrorAction SilentlyContinue | ForEach-Object { & certutil -user -delstore Root $_ | Out-File "$evidence\mitm-cert-remove.log" }
Remove-NetFirewallRule -DisplayName 'Lantern Offline Gate*' -ErrorAction SilentlyContinue
Stop-GateProcesses
Get-NetFirewallRule -DisplayName 'Lantern Offline Gate*' -ErrorAction SilentlyContinue | Format-List * | Out-File "$evidence\firewall-after.txt"
'CLEANUP_COMPLETE' | Set-Content "$evidence\cleanup-status.txt"
