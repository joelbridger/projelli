Start-Sleep -Seconds 180
$lantern = Get-Process lantern -ErrorAction SilentlyContinue
[pscustomobject]@{
  at = (Get-Date).ToUniversalTime().ToString('o')
  dnsLines = (Get-Content C:\offline-mode-gate\evidence\dns.jsonl -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
  proxyLines = (Get-Content C:\offline-mode-gate\evidence\proxy.jsonl -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
  remoteConnections = @(Get-NetTCPConnection -OwningProcess $lantern.Id -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -notin '127.0.0.1','::1' } | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State)
} | ConvertTo-Json -Depth 4 | Set-Content C:\offline-mode-gate\evidence\quiet-3min.json
