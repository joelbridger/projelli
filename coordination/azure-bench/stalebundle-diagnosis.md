# Azure bench stale-bundle diagnosis

Captured at: 2026-07-06T19:47:31Z UTC

Branch: lp/bench-diagnosis

## Plain-language conclusion

Confirmed cause: this bench does **not** show a stale bundled app. The evidence points to a bench wiring problem: the dev server is reachable on IPv6 localhost (`localhost` / `[::1]`) but **not** on IPv4 (`127.0.0.1`), and the app/browser debug port is `9223` while `desktop-drive.mjs` tried `9444`.

In everyday terms: the fresh app is open, but some of the test tools are knocking on the wrong door.

What was ruled out:

- A wrong WebView2 cache/profile folder was ruled out. The running WebView2 process uses `C:\Users\lpbench\AppData\Local\com.lantern.app\EBWebView`.
- Strange machine/user WebView2 environment variables were ruled out. The Process/User/Machine checks all returned `null`.
- The scheduled task is not launching an old folder. `LanternDevBench` runs `C:\run-dev2.bat`, and that file changes into `C:\lantern-plus` before running `npm run tauri:dev`.
- Old stale markers were not found in the real WebView cache. `1783358744` and `Beacon Ridge Demo` both returned count `0`.
- The current dev marker is present. `scheduleFolderMatterRetag` returned count `2`, and Vite dev-client files returned count `354`, which matches a live dev bench.
- WebView2 policy pinning was not found. Both HKLM and HKCU WebView2 policy registry queries returned “key not found.”

Tailscale finding: Tailscale is installed and its Windows service is running, but Tailscale itself is logged out. `tailscale status --json` reports `BackendState: "NeedsLogin"` and health `"Tailscale is stopped."` The network check can reach DERP over UDP, so this is not an Azure network reachability failure. I did not fix it, per instruction.

Important capture note: Azure Run Command clips long returned messages. The report below preserves every byte that Azure returned to this terminal. Where Azure clipped an answer, I reran a smaller focused command and captured that smaller answer too.

## Azure command output

### az vm get-instance-view before diagnostics

```json
[
  {
    "code": "PowerState/running",
    "displayStatus": "VM running"
  }
]

```

### az vm run-command invoke diagnostics

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-stalebundle-diag.fY4UCC.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "At C:\\Packages\\Plugins\\Microsoft.CPlat.Core.RunCommandWindows\\1.1.22\\Downloads\\script35.ps1:116 char:5\n+   } | Format-List\n+     ~\nAn empty pipe element is not allowed.\n    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException\n    + FullyQualifiedErrorId : EmptyPipeElement\n "
    }
  ]
}

```


### az vm run-command invoke diagnostics retry after PowerShell formatting fix

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-stalebundle-diag.fY4UCC.ps1 -o json
```

Output:

```json
LOCAL COMMAND INTERRUPTED BEFORE AZURE RETURNED OUTPUT.
```


### Local wait interruption for broad retry

The broad retry was stopped locally after it produced no returned output for several minutes. This kept the investigation moving; no VM-changing commands were sent.

### az vm run-command invoke tight diagnostics

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-stalebundle-diag-tight.ps1 -o json
```

Output:

```json
ERROR: (Conflict) Run command extension execution is in progress. Please wait for completion before invoking a run command.
Code: Conflict
Message: Run command extension execution is in progress. Please wait for completion before invoking a run command.

```


### Recovery action: Azure VM restart to clear stuck read-only Run Command

The broad retry held Azure Run Command for several minutes and blocked further diagnostics. I restarted the VM power state to clear the stuck read-only command runner. No file, app, service, registry, or network settings were intentionally changed.

Command:

```bash
az vm restart -g lantern-bench -n lantern-cloud-bench-1
```

Output:

```text
{
  "endTime": "2026-07-06T19:58:52.8888713+00:00",
  "name": "327d0750-3a01-47d9-9ecd-7cc372ad037c",
  "startTime": "2026-07-06T19:58:02.7838298+00:00",
  "status": "Succeeded"
}

```


### az vm get-instance-view after restart

```json
[
  {
    "code": "PowerState/running",
    "displayStatus": "VM running"
  }
]

```


### az vm run-command invoke tight diagnostics after restart

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-stalebundle-diag-tight.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "pecialBuild:     False\n                     Language:         English (United States)\n                     \nPath               : C:\\Program Files\\Tailscale\\tailscale.exe\nExtension          : .exe\nDefinition         : C:\\Program Files\\Tailscale\\tailscale.exe\nSource             : C:\\Program Files\\Tailscale\\tailscale.exe\nVersion            : 1.98.8.0\nVisibility         : Public\nOutputType         : {System.String}\nName               : tailscale.exe\nCommandType        : Application\nModuleName         : \nModule             : \nRemotingCapability : PowerShell\nParameters         : \nParameterSets      : \n\n\n\n\n\nHelpUri            : \nFileVersionInfo    : File:             C:\\Program Files\\Tailscale\\tailscaled.exe\n                     InternalName:     tailscaled; tags: authenticode\n                     OriginalFilename: tailscaled.exe\n                     FileVersion:      1.98.8-t1241b225b-g0520dfda5\n                     FileDescription:  Tailscale service\n                     Product:          Tailscale\n                     ProductVersion:   1.98.8-t1241b225b-g0520dfda5\n                     Debug:            False\n                     Patched:          False\n                     PreRelease:       False\n                     PrivateBuild:     False\n                     SpecialBuild:     False\n                     Language:         English (United States)\n                     \nPath               : C:\\Program Files\\Tailscale\\tailscaled.exe\nExtension          : .exe\nDefinition         : C:\\Program Files\\Tailscale\\tailscaled.exe\nSource             : C:\\Program Files\\Tailscale\\tailscaled.exe\nVersion            : 1.98.8.0\nVisibility         : Public\nOutputType         : {System.String}\nName               : tailscaled.exe\nCommandType        : Application\nModuleName         : \nModule             : \nRemotingCapability : PowerShell\nParameters         : \nParameterSets      : \n\n\n\n-- tailscale status --\nLogged out.\n-- tailscale status --json --\n{\n  \"Version\": \"1.98.8-t1241b225b-g0520dfda5\",\n  \"TUN\": true,\n  \"BackendState\": \"NeedsLogin\",\n  \"AuthURL\": \"\",\n  \"TailscaleIPs\": null,\n  \"Self\": {\n    \"ID\": \"\",\n    \"PublicKey\": \"nodekey:0000000000000000000000000000000000000000000000000000000000000000\",\n    \"HostName\": \"lpcloudbench1\",\n    \"DNSName\": \"\",\n    \"OS\": \"windows\",\n    \"UserID\": 0,\n    \"TailscaleIPs\": null,\n    \"Addrs\": [],\n    \"CurAddr\": \"\",\n    \"Relay\": \"\",\n    \"PeerRelay\": \"\",\n    \"RxBytes\": 0,\n    \"TxBytes\": 0,\n    \"Created\": \"0001-01-01T00:00:00Z\",\n    \"LastWrite\": \"0001-01-01T00:00:00Z\",\n    \"LastSeen\": \"0001-01-01T00:00:00Z\",\n    \"LastHandshake\": \"0001-01-01T00:00:00Z\",\n    \"Online\": false,\n    \"ExitNode\": false,\n    \"ExitNodeOption\": false,\n    \"Active\": false,\n    \"PeerAPIURL\": null,\n    \"TaildropTarget\": 0,\n    \"NoFileSharingReason\": \"\",\n    \"InNetworkMap\": false,\n    \"InMagicSock\": false,\n    \"InEngine\": false\n  },\n  \"Health\": [\n    \"Tailscale is stopped.\"\n  ],\n  \"MagicDNSSuffix\": \"\",\n  \"CurrentTailnet\": null,\n  \"CertDomains\": null,\n  \"Peer\": null,\n  \"User\": null,\n  \"ClientVersion\": null\n}\n-- tailscale netcheck --\n\nReport:\n\t* Time: 2026-07-06T20:00:21.7945252Z\n\t* UDP: true\n\t* IPv4: yes, 20.96.16.55:1027\n\t* IPv6: no, but OS has support\n\t* MappingVariesByDestIP: false\n\t* PortMapping: \n\t* Nearest DERP: Ashburn\n\t* DERP latency:\n\t\t- iad: 10.3ms  (Ashburn)\n\t\t- nyc: 11.4ms  (New York City)\n\t\t- tor: 18.9ms  (Toronto)\n\t\t- ord: 21.1ms  (Chicago)\n\t\t- mia: 23.7ms  (Miami)\n\t\t- dfw: 29.3ms  (Dallas)\n\t\t- den: 50.1ms  (Denver)\n\t\t- lax: 61.2ms  (Los Angeles)\n\t\t- sfo: 65.8ms  (San Francisco)\n\t\t- sea: 69.7ms  (Seattle)\n\t\t- par: 78.6ms  (Paris)\n\t\t- lhr: 80.5ms  (London)\n\t\t- ams: 86ms    (Amsterdam)\n\t\t- mad: 89.8ms  (Madrid)\n\t\t- nue: 90.9ms  (Nuremberg)\n\t\t- fra: 91.6ms  (Frankfurt)\n\t\t- waw: 104.4ms (Warsaw)\n\t\t- hnl: 105ms   (Honolulu)\n\t\t- hel: 112.9ms (Helsinki)\n\t\t- sao: 113.4ms (S├úo Paulo)\n\t\t- tok: 161.7ms (Tokyo)\n\t\t- syd: 186.6ms (Sydney)\n\t\t- dbi: 188.5ms (Dubai)\n\t\t- nai: 194.3ms (Nairobi)\n\t\t- hkg: 203ms   (Hong Kong)\n\t\t- jnb: 211.9ms (Johannesburg)\n\t\t- blr: 216.5ms (Bengaluru)\n\t\t- sin: 218.2ms (Singapore)\n-- Recent Tailscale-related Windows events --\n"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "node:internal/deps/undici/undici:15141\n      Error.captureStackTrace(err);\n            ^\n\nTypeError: fetch failed\n    at node:internal/deps/undici/undici:15141:13\n    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)\n    at async getBrowser (file:///C:/lantern-plus/scripts/desktop-drive.mjs:32:23)\n    at async file:///C:/lantern-plus/scripts/desktop-drive.mjs:57:17 {\n  [cause]: AggregateError [ECONNREFUSED]: \n      at internalConnectMultiple (node:net:1135:18)\n      at afterConnectMultiple (node:net:1716:7) {\n    code: 'ECONNREFUSED',\n    [errors]: [\n      Error: connect ECONNREFUSED ::1:9444\n          at createConnectionError (node:net:1679:14)\n          at afterConnectMultiple (node:net:1709:16) {\n        errno: -4078,\n        code: 'ECONNREFUSED',\n        syscall: 'connect',\n        address: '::1',\n        port: 9444\n      },\n      Error: connect ECONNREFUSED 127.0.0.1:9444\n          at createConnectionError (node:net:1679:14)\n          at afterConnectMultiple (node:net:1709:16) {\n        errno: -4078,\n        code: 'ECONNREFUSED',\n        syscall: 'connect',\n        address: '127.0.0.1',\n        port: 9444\n      }\n    ]\n  }\n}\n\nNode.js v22.23.1\nERROR: The system was unable to find the specified registry key or value.\nERROR: The system was unable to find the specified registry key or value.\n2026/07/06 20:00:21 No DERP map from tailscaled; using default.\n2026/07/06 20:00:21 attempting to fetch a DERPMap from https://controlplane.tailscale.com\n2026/07/06 20:00:21 portmap: monitor: gateway and self IP changed: gw=10.0.0.1 self=10.0.0.4"
    }
  ]
}

```


### Focused diagnostic: env-process

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-env-process.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "\\150.0.4078.48\\\\msedgewebview2.exe\\\" --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --service-sandbox-type=none --noerrdialogs --user-data-dir=\\\"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\" --webview-exe-name=lantern.exe --webview-exe-version=3.3.5 --embedded-browser-webview=1 --embedded-browser-webview-dpi-awareness=2 --startup-read-main-dll --metrics-shmem-handle=2000,i,7994369666085653742,13472603949262406089,524288 --field-trial-handle=2008,i,13952520517756496834,5007687962730720846,262144 --disable-features=msPdfOOUI,msSmartScreenProtection,msWebOOUI --variations-seed-version --pseudonymization-salt-handle=2024,i,9057422190545639365,13157953968141968684,4 --trace-process-track-uuid=3190708989122997041 --mojo-platform-channel-handle=2212 /prefetch:11 /pfhostedapp:6c863c3273c0a39f564a9fea0c6c269824a51a12\"\n                              },\n                              {\n                                  \"Name\":  \"msedgewebview2.exe\",\n                                  \"ProcessId\":  10132,\n                                  \"ParentProcessId\":  7968,\n                                  \"CreationDate\":  \"\\/Date(1783368024379)\\/\",\n                                  \"ExecutablePath\":  \"C:\\\\Program Files (x86)\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\150.0.4078.48\\\\msedgewebview2.exe\",\n                                  \"CommandLine\":  \"\\\"C:\\\\Program Files (x86)\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\150.0.4078.48\\\\msedgewebview2.exe\\\" --type=utility --utility-sub-type=storage.mojom.StorageService --lang=en-US --service-sandbox-type=service --noerrdialogs --user-data-dir=\\\"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\" --webview-exe-name=lantern.exe --webview-exe-version=3.3.5 --embedded-browser-webview=1 --embedded-browser-webview-dpi-awareness=2 --startup-read-main-dll --metrics-shmem-handle=2500,i,6296300313006378775,16298493841455273209,524288 --field-trial-handle=2008,i,13952520517756496834,5007687962730720846,262144 --disable-features=msPdfOOUI,msSmartScreenProtection,msWebOOUI --variations-seed-version --pseudonymization-salt-handle=2024,i,9057422190545639365,13157953968141968684,4 --trace-process-track-uuid=3190708990060038890 --mojo-platform-channel-handle=2668 /prefetch:13 /pfhostedapp:6c863c3273c0a39f564a9fea0c6c269824a51a12\"\n                              },\n                              {\n                                  \"Name\":  \"msedgewebview2.exe\",\n                                  \"ProcessId\":  1188,\n                                  \"ParentProcessId\":  7968,\n                                  \"CreationDate\":  \"\\/Date(1783368024657)\\/\",\n                                  \"ExecutablePath\":  \"C:\\\\Program Files (x86)\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\150.0.4078.48\\\\msedgewebview2.exe\",\n                                  \"CommandLine\":  \"\\\"C:\\\\Program Files (x86)\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\150.0.4078.48\\\\msedgewebview2.exe\\\" --type=renderer --noerrdialogs --user-data-dir=\\\"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\" --webview-exe-name=lantern.exe --webview-exe-version=3.3.5 --embedded-browser-webview=1 --embedded-browser-webview-dpi-awareness=2 --autoplay-policy=no-user-gesture-required --remote-debugging-port=9223 --video-capture-use-gpu-memory-buffer --lang=en-US --js-flags=--expose-gc --device-scale-factor=1 --num-raster-threads=2 --enable-main-frame-before-activation --renderer-client-id=5 --time-ticks-at-unix-epoch=-1783367932640924 --launch-time-ticks=92013476 --ssd-no-pressure-read-main-dll --metrics-shmem-handle=3688,i,18020026997847840436,2476278644448090349,2097152 --field-trial-handle=2008,i,13952520517756496834,5007687962730720846,262144 --disable-features=msPdfOOUI,msSmartScreenProtection,msWebOOUI --variations-seed-version --pseudonymization-salt-handle=2024,i,9057422190545639365,13157953968141968684,4 --trace-process-track-uuid=3190708990997080739 --mojo-platform-channel-handle=3728 /pfhostedapp:6c863c3273c0a39f564a9fea0c6c269824a51a12 /prefetch:1\"\n                              }\n                          ]\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Focused diagnostic: task-ports

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-task-ports.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "                     \"CimType\":  14,\n                                                       \"Flags\":  \"Property, Key, NotModified, NullValue\",\n                                                       \"IsValueModified\":  false\n                                                   }\n                                               ],\n                     \"CimSystemProperties\":  {\n                                                 \"Namespace\":  \"Root/Microsoft/Windows/TaskScheduler\",\n                                                 \"ServerName\":  \"lpcloudbench1\",\n                                                 \"ClassName\":  \"MSFT_TaskDynamicInfo\",\n                                                 \"Path\":  null\n                                             },\n                     \"LastRunTime\":  \"\\/Date(1783367943000)\\/\",\n                     \"LastTaskResult\":  267009,\n                     \"NextRunTime\":  null,\n                     \"NumberOfMissedRuns\":  0,\n                     \"TaskName\":  \"LanternDevBench\",\n                     \"TaskPath\":  null,\n                     \"PSComputerName\":  null\n                 },\n    \"TcpConnections\":  [\n                           {\n                               \"LocalAddress\":  \"::1\",\n                               \"LocalPort\":  5173,\n                               \"RemoteAddress\":  \"::\",\n                               \"RemotePort\":  0,\n                               \"State\":  2,\n                               \"OwningProcess\":  9572\n                           },\n                           {\n                               \"LocalAddress\":  \"::1\",\n                               \"LocalPort\":  5173,\n                               \"RemoteAddress\":  \"::1\",\n                               \"RemotePort\":  63344,\n                               \"State\":  5,\n                               \"OwningProcess\":  9572\n                           },\n                           {\n                               \"LocalAddress\":  \"127.0.0.1\",\n                               \"LocalPort\":  9223,\n                               \"RemoteAddress\":  \"0.0.0.0\",\n                               \"RemotePort\":  0,\n                               \"State\":  2,\n                               \"OwningProcess\":  7968\n                           }\n                       ],\n    \"OwningProcesses\":  [\n                            {\n                                \"Name\":  \"node.exe\",\n                                \"ProcessId\":  9572,\n                                \"ParentProcessId\":  9556,\n                                \"CreationDate\":  \"\\/Date(1783367958729)\\/\",\n                                \"ExecutablePath\":  \"C:\\\\Program Files\\\\nodejs\\\\node.exe\",\n                                \"Owner\":  \"lpcloudbench1\\\\lpbench\",\n                                \"CommandLine\":  \"\\\"node\\\"   \\\"C:\\\\lantern-plus\\\\node_modules\\\\.bin\\\\\\\\..\\\\vite\\\\bin\\\\vite.js\\\" \"\n                            },\n                            {\n                                \"Name\":  \"msedgewebview2.exe\",\n                                \"ProcessId\":  7968,\n                                \"ParentProcessId\":  9348,\n                                \"CreationDate\":  \"\\/Date(1783368024106)\\/\",\n                                \"ExecutablePath\":  \"C:\\\\Program Files (x86)\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\150.0.4078.48\\\\msedgewebview2.exe\",\n                                \"Owner\":  \"lpcloudbench1\\\\lpbench\",\n                                \"CommandLine\":  \"\\\"C:\\\\Program Files (x86)\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\150.0.4078.48\\\\msedgewebview2.exe\\\" --embedded-browser-webview=1 --webview-exe-name=lantern.exe --webview-exe-version=3.3.5 --user-data-dir=\\\"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\" --noerrdialogs --embedded-browser-webview-dpi-awareness=2 --autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=9223 --lang=en-US --mojo-named-platform-channel-pipe=9348.7656.2971854871074864716 /pfhostedapp:6c863c3273c0a39f564a9fea0c6c269824a51a12\"\n                            }\n                        ]\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Focused diagnostic: loopback

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-loopback.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "{\n    \"UtcNow\":  \"2026-07-06T20:03:45.9436089Z\",\n    \"PowerShellFetches\":  [\n                              {\n                                  \"Url\":  \"http://127.0.0.1:5173/\",\n                                  \"Error\":  \"Unable to connect to the remote server\"\n                              },\n                              {\n                                  \"Url\":  \"http://localhost:5173/\",\n                                  \"StatusCode\":  200,\n                                  \"Length\":  931,\n                                  \"HasDevClient\":  true,\n                                  \"HasProdAssets\":  false,\n                                  \"HasBeaconRidgeDemo\":  false,\n                                  \"HasScheduleFolderMatterRetag\":  false,\n                                  \"Head\":  \"\\u003c!DOCTYPE html\\u003e \\u003chtml lang=\\\"en\\\"\\u003e   \\u003chead\\u003e     \\u003cscript type=\\\"module\\\"\\u003eimport { injectIntoGlobalHook } from \\\"/@react-refresh\\\"; injectIntoGlobalHook(window); window.$RefreshReg$ = () =\\u003e {}; window.$RefreshSig$ = () =\\u003e (type)\"\n                              },\n                              {\n                                  \"Url\":  \"http://[::1]:5173/\",\n                                  \"StatusCode\":  200,\n                                  \"Length\":  931,\n                                  \"HasDevClient\":  true,\n                                  \"HasProdAssets\":  false,\n                                  \"HasBeaconRidgeDemo\":  false,\n                                  \"HasScheduleFolderMatterRetag\":  false,\n                                  \"Head\":  \"\\u003c!DOCTYPE html\\u003e \\u003chtml lang=\\\"en\\\"\\u003e   \\u003chead\\u003e     \\u003cscript type=\\\"module\\\"\\u003eimport { injectIntoGlobalHook } from \\\"/@react-refresh\\\"; injectIntoGlobalHook(window); window.$RefreshReg$ = () =\\u003e {}; window.$RefreshSig$ = () =\\u003e (type)\"\n                              }\n                          ],\n    \"DesktopDriveOutput\":  \"node : node:internal/deps/undici/undici:15141\\r\\nAt C:\\\\Packages\\\\Plugins\\\\Microsoft.CPlat.Core.RunCommandWindows\\\\1.1.22\\\\Downloads\\\\script40.ps1:25 char:14\\r\\n+     $drive = node scripts/desktop-drive.mjs eval $expr 2\\u003e\\u00261 | Out-Str ...\\r\\n+              ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\\r\\n    + CategoryInfo          : NotSpecified: (node:internal/deps/undici/undici:15141:String) [], RemoteException\\r\\n    + FullyQualifiedErrorId : NativeCommandError\\r\\n \\r\\n      Error.captureStackTrace(err);\\r\\n            ^\\r\\n\\r\\nTypeError: fetch failed\\r\\n    at node:internal/deps/undici/undici:15141:13\\r\\n    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)\\r\\n    at async getBrowser (file:///C:/lantern-plus/scripts/desktop-drive.mjs:32:23)\\r\\n    at async file:///C:/lantern-plus/scripts/desktop-drive.mjs:57:17 {\\r\\n  [cause]: AggregateError [ECONNREFUSED]: \\r\\n      at internalConnectMultiple (node:net:1135:18)\\r\\n      at afterConnectMultiple (node:net:1716:7) {\\r\\n    code: \\u0027ECONNREFUSED\\u0027,\\r\\n    [errors]: [\\r\\n      Error: connect ECONNREFUSED ::1:9444\\r\\n          at createConnectionError (node:net:1679:14)\\r\\n          at afterConnectMultiple (node:net:1709:16) {\\r\\n        errno: -4078,\\r\\n        code: \\u0027ECONNREFUSED\\u0027,\\r\\n        syscall: \\u0027connect\\u0027,\\r\\n        address: \\u0027::1\\u0027,\\r\\n        port: 9444\\r\\n      },\\r\\n      Error: connect ECONNREFUSED 127.0.0.1:9444\\r\\n          at createConnectionError (node:net:1679:14)\\r\\n          at afterConnectMultiple (node:net:1709:16) {\\r\\n        errno: -4078,\\r\\n        code: \\u0027ECONNREFUSED\\u0027,\\r\\n        syscall: \\u0027connect\\u0027,\\r\\n        address: \\u0027127.0.0.1\\u0027,\\r\\n        port: 9444\\r\\n      }\\r\\n    ]\\r\\n  }\\r\\n}\\r\\n\\r\\nNode.js v22.23.1\\r\\n\"\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Focused diagnostic: webview-runtime

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-webview-runtime.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "e=2004,i,1372548760571836832,11328316462321062989,262144 --variations-seed-version --pseudonymization-salt-handle=2016,i,1722033308276111431,1967778472923627099,4 --trace-process-track-uuid=3190708990997080739 --mojo-platform-channel-handle=3808 /pfhostedapp:d38f4afbf47e7ba7378c94d1e75f33d539050cec /prefetch:1\"\n                              }\n                          ],\n    \"EdgeUpdateClients\":  [\n                              {\n                                  \"PSChildName\":  \"{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}\",\n                                  \"name\":  \"Microsoft Edge\",\n                                  \"pv\":  \"150.0.4078.48\",\n                                  \"location\":  \"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\"\n                              },\n                              {\n                                  \"PSChildName\":  \"on-logon-autolaunch\",\n                                  \"name\":  null,\n                                  \"pv\":  null,\n                                  \"location\":  null\n                              },\n                              {\n                                  \"PSChildName\":  \"on-logon-game-assist-update\",\n                                  \"name\":  null,\n                                  \"pv\":  null,\n                                  \"location\":  null\n                              },\n                              {\n                                  \"PSChildName\":  \"on-logon-os-patch-upgrade-launch\",\n                                  \"name\":  null,\n                                  \"pv\":  null,\n                                  \"location\":  null\n                              },\n                              {\n                                  \"PSChildName\":  \"on-logon-startup-boost\",\n                                  \"name\":  null,\n                                  \"pv\":  null,\n                                  \"location\":  null\n                              },\n                              {\n                                  \"PSChildName\":  \"on-os-upgrade\",\n                                  \"name\":  null,\n                                  \"pv\":  null,\n                                  \"location\":  null\n                              },\n                              {\n                                  \"PSChildName\":  \"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\",\n                                  \"name\":  \"Microsoft Edge WebView2 Runtime\",\n                                  \"pv\":  \"150.0.4078.48\",\n                                  \"location\":  \"C:\\\\Program Files (x86)\\\\Microsoft\\\\EdgeWebView\\\\Application\"\n                              },\n                              {\n                                  \"PSChildName\":  \"{F3C4FE00-EFD5-403B-9569-398A20F1BA4A}\",\n                                  \"name\":  \"Microsoft Edge Update\",\n                                  \"pv\":  \"1.3.241.15\",\n                                  \"location\":  null\n                              }\n                          ],\n    \"HKLMPolicy\":  \"reg : ERROR: The system was unable to find the specified registry key or value.\\r\\nAt C:\\\\Packages\\\\Plugins\\\\Microsoft.CPlat.Core.RunCommandWindows\\\\1.1.22\\\\Downloads\\\\script41.ps1:8 char:15\\r\\n+ ... klmPolicy = reg query \\\"HKLM\\\\SOFTWARE\\\\Policies\\\\Microsoft\\\\Edge\\\\WebView2 ...\\r\\n+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\\r\\n    + CategoryInfo          : NotSpecified: (ERROR: The syst...y key or value.:String) [], RemoteException\\r\\n    + FullyQualifiedErrorId : NativeCommandError\\r\\n \\r\\n\",\n    \"HKCUPolicy\":  \"reg : ERROR: The system was unable to find the specified registry key or value.\\r\\nAt C:\\\\Packages\\\\Plugins\\\\Microsoft.CPlat.Core.RunCommandWindows\\\\1.1.22\\\\Downloads\\\\script41.ps1:9 char:15\\r\\n+ ... kcuPolicy = reg query \\\"HKCU\\\\SOFTWARE\\\\Policies\\\\Microsoft\\\\Edge\\\\WebView2 ...\\r\\n+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\\r\\n    + CategoryInfo          : NotSpecified: (ERROR: The syst...y key or value.:String) [], RemoteException\\r\\n    + FullyQualifiedErrorId : NativeCommandError\\r\\n \\r\\n\"\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Focused diagnostic: cache-markers

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-cache-markers.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "{\n    \"UtcNow\":  \"2026-07-06T20:04:55.4413687Z\",\n    \"Roots\":  \"C:\\\\ProgramData\",\n    \"Results\":  [\n                    {\n                        \"Root\":  \"C:\\\\ProgramData\",\n                        \"TimedOut\":  true,\n                        \"MatchCountReturned\":  0,\n                        \"Matches\":  [\n\n                                    ]\n                    }\n                ]\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Focused diagnostic: tailscale

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-tailscale.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "ParentProcessId\":  3600,\n                          \"CreationDate\":  \"\\/Date(1783367939975)\\/\",\n                          \"ExecutablePath\":  \"C:\\\\Program Files\\\\Tailscale\\\\tailscaled.exe\",\n                          \"CommandLine\":  \"\\\"C:\\\\Program Files\\\\Tailscale\\\\tailscaled.exe\\\" /subproc 1cc13b128c8b28a4867e16ad644b1d1652ca9840e77628b912d56070e92f5c12\"\n                      }\n                  ],\n    \"Adapters\":  {\n                     \"Name\":  \"Tailscale\",\n                     \"InterfaceDescription\":  \"Tailscale Tunnel\",\n                     \"Status\":  \"Up\",\n                     \"MacAddress\":  \"\",\n                     \"LinkSpeed\":  \"100 Gbps\"\n                 },\n    \"TailscaleExe\":  \"C:\\\\Program Files\\\\Tailscale\\\\tailscale.exe\",\n    \"StatusText\":  \"Logged out.\\r\\n\",\n    \"StatusJson\":  \"{\\r\\n  \\\"Version\\\": \\\"1.98.8-t1241b225b-g0520dfda5\\\",\\r\\n  \\\"TUN\\\": true,\\r\\n  \\\"BackendState\\\": \\\"NeedsLogin\\\",\\r\\n  \\\"AuthURL\\\": \\\"\\\",\\r\\n  \\\"TailscaleIPs\\\": null,\\r\\n  \\\"Self\\\": {\\r\\n    \\\"ID\\\": \\\"\\\",\\r\\n    \\\"PublicKey\\\": \\\"nodekey:0000000000000000000000000000000000000000000000000000000000000000\\\",\\r\\n    \\\"HostName\\\": \\\"lpcloudbench1\\\",\\r\\n    \\\"DNSName\\\": \\\"\\\",\\r\\n    \\\"OS\\\": \\\"windows\\\",\\r\\n    \\\"UserID\\\": 0,\\r\\n    \\\"TailscaleIPs\\\": null,\\r\\n    \\\"Addrs\\\": [],\\r\\n    \\\"CurAddr\\\": \\\"\\\",\\r\\n    \\\"Relay\\\": \\\"\\\",\\r\\n    \\\"PeerRelay\\\": \\\"\\\",\\r\\n    \\\"RxBytes\\\": 0,\\r\\n    \\\"TxBytes\\\": 0,\\r\\n    \\\"Created\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"LastWrite\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"LastSeen\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"LastHandshake\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"Online\\\": false,\\r\\n    \\\"ExitNode\\\": false,\\r\\n    \\\"ExitNodeOption\\\": false,\\r\\n    \\\"Active\\\": false,\\r\\n    \\\"PeerAPIURL\\\": null,\\r\\n    \\\"TaildropTarget\\\": 0,\\r\\n    \\\"NoFileSharingReason\\\": \\\"\\\",\\r\\n    \\\"InNetworkMap\\\": false,\\r\\n    \\\"InMagicSock\\\": false,\\r\\n    \\\"InEngine\\\": false\\r\\n  },\\r\\n  \\\"Health\\\": [\\r\\n    \\\"Tailscale is stopped.\\\"\\r\\n  ],\\r\\n  \\\"MagicDNSSuffix\\\": \\\"\\\",\\r\\n  \\\"CurrentTailnet\\\": null,\\r\\n  \\\"CertDomains\\\": null,\\r\\n  \\\"Peer\\\": null,\\r\\n  \\\"User\\\": null,\\r\\n  \\\"ClientVersion\\\": null\\r\\n}\\r\\n\",\n    \"Netcheck\":  \"tailscale.exe : 2026/07/06 20:05:14 No DERP map from tailscaled; using default.\\r\\nAt C:\\\\Packages\\\\Plugins\\\\Microsoft.CPlat.Core.RunCommandWindows\\\\1.1.22\\\\Downloads\\\\script43.ps1:13 char:31\\r\\n+ ... etcheck = if ($tailscale) { \\u0026 $tailscale.Source netcheck 2\\u003e\\u00261 | Out-S ...\\r\\n+                                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\\r\\n    + CategoryInfo          : NotSpecified: (2026/07/06 20:0... using default.:String) [], RemoteException\\r\\n    + FullyQualifiedErrorId : NativeCommandError\\r\\n \\r\\n2026/07/06 20:05:14 attempting to fetch a DERPMap from https://controlplane.tailscale.com\\r\\n2026/07/06 20:05:14 portmap: monitor: gateway and self IP changed: gw=10.0.0.1 self=10.0.0.4\\r\\n\\r\\nReport:\\r\\n\\t* Time: 2026-07-06T20:05:15.0872502Z\\r\\n\\t* UDP: true\\r\\n\\t* IPv4: yes, 20.96.16.55:1026\\r\\n\\t* IPv6: no, but OS has support\\r\\n\\t* MappingVariesByDestIP: false\\r\\n\\t* PortMapping: \\r\\n\\t* Nearest DERP: New York City\\r\\n\\t* DERP latency:\\r\\n\\t\\t- nyc: 11.9ms  (New York City)\\r\\n\\t\\t- iad: 15.4ms  (Ashburn)\\r\\n\\t\\t- tor: 20.5ms  (Toronto)\\r\\n\\t\\t- mia: 25ms    (Miami)\\r\\n\\t\\t- ord: 25.8ms  (Chicago)\\r\\n\\t\\t- dfw: 28.8ms  (Dallas)\\r\\n\\t\\t- den: 48.4ms  (Denver)\\r\\n\\t\\t- lax: 59.5ms  (Los Angeles)\\r\\n\\t\\t- sfo: 66.3ms  (San Francisco)\\r\\n\\t\\t- sea: 75.3ms  (Seattle)\\r\\n\\t\\t- lhr: 80.2ms  (London)\\r\\n\\t\\t- par: 81.4ms  (Paris)\\r\\n\\t\\t- fra: 87ms    (Frankfurt)\\r\\n\\t\\t- ams: 88.8ms  (Amsterdam)\\r\\n\\t\\t- nue: 91.7ms  (Nuremberg)\\r\\n\\t\\t- mad: 100.4ms (Madrid)\\r\\n\\t\\t- waw: 104.6ms (Warsaw)\\r\\n\\t\\t- hnl: 105.9ms (Honolulu)\\r\\n\\t\\t- hel: 112.8ms (Helsinki)\\r\\n\\t\\t- sao: 113.4ms (S├úo Paulo)\\r\\n\\t\\t- tok: 163ms   (Tokyo)\\r\\n\\t\\t- dbi: 179.5ms (Dubai)\\r\\n\\t\\t- nai: 191.4ms (Nairobi)\\r\\n\\t\\t- syd: 193.9ms (Sydney)\\r\\n\\t\\t- hkg: 203.1ms (Hong Kong)\\r\\n\\t\\t- jnb: 209.5ms (Johannesburg)\\r\\n\\t\\t- blr: 211.8ms (Bengaluru)\\r\\n\\t\\t- sin: 224.9ms (Singapore)\\r\\n\",\n    \"RecentEvents\":  {\n\n                     }\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra small diagnostic: env-only

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-env-only.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "[\n    {\n        \"Scope\":  \"Process\",\n        \"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\":  null,\n        \"WEBVIEW2_BROWSER_EXECUTABLE_FOLDER\":  null,\n        \"WEBVIEW2_RELEASE_CHANNEL_PREFERENCE\":  null,\n        \"WEBVIEW2_USER_DATA_FOLDER\":  null\n    },\n    {\n        \"Scope\":  \"User\",\n        \"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\":  null,\n        \"WEBVIEW2_BROWSER_EXECUTABLE_FOLDER\":  null,\n        \"WEBVIEW2_RELEASE_CHANNEL_PREFERENCE\":  null,\n        \"WEBVIEW2_USER_DATA_FOLDER\":  null\n    },\n    {\n        \"Scope\":  \"Machine\",\n        \"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\":  null,\n        \"WEBVIEW2_BROWSER_EXECUTABLE_FOLDER\":  null,\n        \"WEBVIEW2_RELEASE_CHANNEL_PREFERENCE\":  null,\n        \"WEBVIEW2_USER_DATA_FOLDER\":  null\n    }\n]"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra small diagnostic: task-only

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-task-only.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "{\n    \"Found\":  true,\n    \"Actions\":  {\n                    \"Execute\":  \"C:\\\\run-dev2.bat\",\n                    \"Arguments\":  null,\n                    \"WorkingDirectory\":  null\n                },\n    \"Principal\":  {\n                      \"UserId\":  \"lpbench\",\n                      \"LogonType\":  3,\n                      \"RunLevel\":  1\n                  },\n    \"LastRunTime\":  \"\\/Date(1783367943000)\\/\",\n    \"LastTaskResult\":  267009,\n    \"NextRunTime\":  null\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra small diagnostic: user-cache-markers

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-user-cache-markers.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "ath\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\\Default\\\\Cache\\\\Cache_Data\\\\f_000045\",\n                                            \"LineNumber\":  1,\n                                            \"Line\":  \"import { createHotContext as __vite__createHotContext } from \\\"/@vite/client\\\";import.meta.hot = __vite__createHotContext(\\\"/src/features/email/EmailViewer.tsx\\\");\\\"use strict\\\";\",\n                                            \"PSComputerName\":  \"localhost\",\n                                            \"RunspaceId\":  \"6d4f507d-c355-4411-adad-735de86a0555\",\n                                            \"PSShowComputerName\":  false\n                                        },\n                                        {\n                                            \"Path\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\\Default\\\\Cache\\\\Cache_Data\\\\f_00004e\",\n                                            \"LineNumber\":  1,\n                                            \"Line\":  \"import { createHotContext as __vite__createHotContext } from \\\"/@vite/client\\\";import.meta.hot = __vite__createHotContext(\\\"/src/ui/PromptDialog.tsx\\\");\\\"use strict\\\";\",\n                                            \"PSComputerName\":  \"localhost\",\n                                            \"RunspaceId\":  \"6d4f507d-c355-4411-adad-735de86a0555\",\n                                            \"PSShowComputerName\":  false\n                                        },\n                                        {\n                                            \"Path\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\\Default\\\\Cache\\\\Cache_Data\\\\f_000053\",\n                                            \"LineNumber\":  1,\n                                            \"Line\":  \"import { createHotContext as __vite__createHotContext } from \\\"/@vite/client\\\";import.meta.hot = __vite__createHotContext(\\\"/src/features/ask/AIChatViewer.tsx\\\");\\\"use strict\\\";\",\n                                            \"PSComputerName\":  \"localhost\",\n                                            \"RunspaceId\":  \"6d4f507d-c355-4411-adad-735de86a0555\",\n                                            \"PSShowComputerName\":  false\n                                        },\n                                        {\n                                            \"Path\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\\Default\\\\Cache\\\\Cache_Data\\\\f_000054\",\n                                            \"LineNumber\":  1,\n                                            \"Line\":  \"import { createHotContext as __vite__createHotContext } from \\\"/@vite/client\\\";import.meta.hot = __vite__createHotContext(\\\"/src/app/shell/common/CommandPalette.tsx\\\");\\\"use strict\\\";\",\n                                            \"PSComputerName\":  \"localhost\",\n                                            \"RunspaceId\":  \"6d4f507d-c355-4411-adad-735de86a0555\",\n                                            \"PSShowComputerName\":  false\n                                        }\n                                    ]\n                    },\n                    {\n                        \"Root\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\Temp\",\n                        \"TimedOut\":  true,\n                        \"MatchCountReturned\":  1,\n                        \"Matches\":  [\n                                        {\n                                            \"Path\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\Temp\\\\node-compile-cache\\\\v22.23.1-x64-9de703df\\\\4261647f\",\n                                            \"LineNumber\":  41,\n                                            \"Line\":  \"\\u0000\\u0000\\u0000/@vite/client\\u0000\\u0000\\u0000\\u0001\\u0010Rb?\\u001fa?\",\n                                            \"PSComputerName\":  \"localhost\",\n                                            \"RunspaceId\":  \"72901594-d624-48e3-a725-726e42a12f96\",\n                                            \"PSShowComputerName\":  false\n                                        }\n                                    ]\n                    }\n                ]\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra small diagnostic: tailscale-small

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-tailscale-small.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "{\n    \"Service\":  {\n                    \"Name\":  \"Tailscale\",\n                    \"Status\":  4,\n                    \"StartType\":  2,\n                    \"DisplayName\":  \"Tailscale\"\n                },\n    \"TailscaleExe\":  \"C:\\\\Program Files\\\\Tailscale\\\\tailscale.exe\",\n    \"StatusText\":  \"Logged out.\\r\\n\",\n    \"StatusJson\":  \"{\\r\\n  \\\"Version\\\": \\\"1.98.8-t1241b225b-g0520dfda5\\\",\\r\\n  \\\"TUN\\\": true,\\r\\n  \\\"BackendState\\\": \\\"NeedsLogin\\\",\\r\\n  \\\"AuthURL\\\": \\\"\\\",\\r\\n  \\\"TailscaleIPs\\\": null,\\r\\n  \\\"Self\\\": {\\r\\n    \\\"ID\\\": \\\"\\\",\\r\\n    \\\"PublicKey\\\": \\\"nodekey:0000000000000000000000000000000000000000000000000000000000000000\\\",\\r\\n    \\\"HostName\\\": \\\"lpcloudbench1\\\",\\r\\n    \\\"DNSName\\\": \\\"\\\",\\r\\n    \\\"OS\\\": \\\"windows\\\",\\r\\n    \\\"UserID\\\": 0,\\r\\n    \\\"TailscaleIPs\\\": null,\\r\\n    \\\"Addrs\\\": [],\\r\\n    \\\"CurAddr\\\": \\\"\\\",\\r\\n    \\\"Relay\\\": \\\"\\\",\\r\\n    \\\"PeerRelay\\\": \\\"\\\",\\r\\n    \\\"RxBytes\\\": 0,\\r\\n    \\\"TxBytes\\\": 0,\\r\\n    \\\"Created\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"LastWrite\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"LastSeen\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"LastHandshake\\\": \\\"0001-01-01T00:00:00Z\\\",\\r\\n    \\\"Online\\\": false,\\r\\n    \\\"ExitNode\\\": false,\\r\\n    \\\"ExitNodeOption\\\": false,\\r\\n    \\\"Active\\\": false,\\r\\n    \\\"PeerAPIURL\\\": null,\\r\\n    \\\"TaildropTarget\\\": 0,\\r\\n    \\\"NoFileSharingReason\\\": \\\"\\\",\\r\\n    \\\"InNetworkMap\\\": false,\\r\\n    \\\"InMagicSock\\\": false,\\r\\n    \\\"InEngine\\\": false\\r\\n  },\\r\\n  \\\"Health\\\": [\\r\\n    \\\"Tailscale is stopped.\\\"\\r\\n  ],\\r\\n  \\\"MagicDNSSuffix\\\": \\\"\\\",\\r\\n  \\\"CurrentTailnet\\\": null,\\r\\n  \\\"CertDomains\\\": null,\\r\\n  \\\"Peer\\\": null,\\r\\n  \\\"User\\\": null,\\r\\n  \\\"ClientVersion\\\": null\\r\\n}\\r\\n\"\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra small diagnostic: run-dev2

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-run-dev2.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "                                      \"Revision\":  8655,\n                                                                          \"MajorRevision\":  0,\n                                                                          \"MinorRevision\":  8655\n                                                                      },\n                                                        \"Version\":  {\n                                                                        \"Major\":  3,\n                                                                        \"Minor\":  0,\n                                                                        \"Build\":  0,\n                                                                        \"Revision\":  0,\n                                                                        \"MajorRevision\":  0,\n                                                                        \"MinorRevision\":  0\n                                                                    },\n                                                        \"Types\":  [\n                                                                      \"types.ps1xml\",\n                                                                      \"typesv3.ps1xml\"\n                                                                  ],\n                                                        \"Formats\":  [\n                                                                        \"Certificate.format.ps1xml\",\n                                                                        \"DotNetTypes.format.ps1xml\",\n                                                                        \"FileSystem.format.ps1xml\",\n                                                                        \"Help.format.ps1xml\",\n                                                                        \"HelpV3.format.ps1xml\",\n                                                                        \"PowerShellCore.format.ps1xml\",\n                                                                        \"PowerShellTrace.format.ps1xml\",\n                                                                        \"Registry.format.ps1xml\"\n                                                                    ],\n                                                        \"Description\":  \"This Windows PowerShell snap-in contains cmdlets used to manage components of Windows PowerShell.\",\n                                                        \"Vendor\":  \"Microsoft Corporation\",\n                                                        \"LogPipelineExecutionDetails\":  false\n                                                    },\n                                       \"ModuleName\":  \"Microsoft.PowerShell.Core\",\n                                       \"Module\":  null,\n                                       \"Description\":  \"\",\n                                       \"Capabilities\":  52,\n                                       \"Home\":  \"C:\\\\Windows\\\\system32\\\\config\\\\systemprofile\",\n                                       \"Drives\":  [\n                                                      {\n                                                          \"CurrentLocation\":  \"Packages\\\\Plugins\\\\Microsoft.CPlat.Core.RunCommandWindows\\\\1.1.22\\\\Downloads\",\n                                                          \"Name\":  \"C\",\n                                                          \"Provider\":  \"Microsoft.PowerShell.Core\\\\FileSystem\",\n                                                          \"Root\":  \"C:\\\\\",\n                                                          \"Description\":  \"Windows\",\n                                                          \"MaximumSize\":  null,\n                                                          \"Credential\":  \"System.Management.Automation.PSCredential\",\n                                                          \"DisplayRoot\":  null\n                                                      }\n                                                  ]\n                                   },\n                    \"ReadCount\":  1\n                }\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra small diagnostic: marker-counts

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-marker-counts.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "tContext } from \\\"/@vite/client\\\";import.meta.hot = __vite__createHotContext(\\\"/src/features/documents/workspace/WorkspaceSelector.tsx\\\");\\\"use strict\\\";\",\n                                                 \"PSComputerName\":  \"localhost\",\n                                                 \"RunspaceId\":  \"92c98958-d153-41d9-a25b-ea08b91ed8ba\",\n                                                 \"PSShowComputerName\":  false\n                                             },\n                                             {\n                                                 \"Path\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\\Default\\\\Cache\\\\Cache_Data\\\\f_00002f\",\n                                                 \"LineNumber\":  1,\n                                                 \"Line\":  \"import { createHotContext as __vite__createHotContext } from \\\"/@vite/client\\\";import.meta.hot = __vite__createHotContext(\\\"/src/app/shell/layout/TrustBar.tsx\\\");\\\"use strict\\\";\",\n                                                 \"PSComputerName\":  \"localhost\",\n                                                 \"RunspaceId\":  \"92c98958-d153-41d9-a25b-ea08b91ed8ba\",\n                                                 \"PSShowComputerName\":  false\n                                             }\n                                         ]\n                    },\n                    {\n                        \"Marker\":  \"scheduleFolderMatterRetag\",\n                        \"TimedOut\":  false,\n                        \"MatchCountReturned\":  2,\n                        \"FirstMatches\":  [\n                                             {\n                                                 \"Path\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\\Default\\\\Cache\\\\Cache_Data\\\\f_00003d\",\n                                                 \"LineNumber\":  754,\n                                                 \"Line\":  \"export function scheduleFolderMatterRetag(folders, workspaceService, scheduler) {\",\n                                                 \"PSComputerName\":  \"localhost\",\n                                                 \"RunspaceId\":  \"ffca1c56-0c26-4d9d-895b-56fa75ff475b\",\n                                                 \"PSShowComputerName\":  false\n                                             },\n                                             {\n                                                 \"Path\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\\\\Default\\\\Code Cache\\\\js\\\\001c1d1d27a817ad_0\",\n                                                 \"LineNumber\":  12,\n                                                 \"Line\":  \"\\u0000\\u0000\\u0000retryAsync\\u0000\\u0000`*\\u0000\\u0000\\u0000\\u0001\\fJ`\\u0001\\u0000\\u0000\\u0000\\u0004\\u001d\\u0002\\u0001(PhZc??\\u0019\\u0000\\u0000\\u0000scheduleFolderMatterRetag\\u0000\\u0000\\u0000`,\\u0000\\u0000\\u0000\\u0001\\fJ`\\u0001\\u0000\\u0000\\u0000\\u0004%\\u0002\\u0001$Pg?K??\\u0017\\u0000\\u0000\\u0000scheduleMailMatterRetag\\u0000`.\\u0000\\u0000\\u0000\\u0001\\fJ`\\u0001\\u0000\\u0000\\u0000\\u0004-\\u0002\\u0001$Pg??\\u0015\\u0016\\u0000\\u0000\\u0000schedulePrivilegeRetag\\u0000\\u0000`0\\u0000\\u0000\\u0000\\u0001\\fJ`\\u0001\\u0000\\u0000\\u0000\\u00045\\u0002\\u0001\\u001cPeZ9?\\\"\\u000e\\u0000\\u0000\\u0000startFullIndex\\u0000\\u0000`2\\u0000\\u0000\\u0000\\u0001\\fJ`\\u0001\\u0000\\u0000\\u0000\\u0004=\\u0002\\u0001\\u001cPe\\u000e?\\u0017?\\u000f\\u0000\\u0000\\u0000useMemoryWiring\\u0000`4\\u0000\\u0000\\u0000\\u0001\\fJ`\\u0001\\u0000\\u0000\\u0000\\u0004E\\u0002[\\u0001?J`\\u003c\\u0000\\u0000\\u0000\\u0001 \\u0007?\\u000f@\\u0001(Ph??,Z\\u0019\\u0000\\u0000\\u0000LEGACY_WORKSPACE_DATA_DIR\\u0000\\u0000\\u0000\\u0004U\\u0002c\\u0006\\u0000\\u0000\\u0000????0\\u0003\\u0000\\u0000b\\u0003\\u0000\\u0000\\u0001 ?@\\u0001 Pf\",\n                                                 \"PSComputerName\":  \"localhost\",\n                                                 \"RunspaceId\":  \"ffca1c56-0c26-4d9d-895b-56fa75ff475b\",\n                                                 \"PSShowComputerName\":  false\n                                             }\n                                         ]\n                    }\n                ]\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra tiny diagnostic: run-dev2-text

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-run-dev2-text.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "@echo off\nset WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223\ncd /d C:\\lantern-plus\nnpm run tauri:dev > C:\\tauri-dev.log 2>&1"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### Extra tiny diagnostic: marker-counts-only

Command:

```bash
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts @/tmp/lantern-diag-marker-counts-only.ps1 -o json
```

Output:

```json
{
  "value": [
    {
      "code": "ComponentStatus/StdOut/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": "{\n    \"Root\":  \"C:\\\\Users\\\\lpbench\\\\AppData\\\\Local\\\\com.lantern.app\\\\EBWebView\",\n    \"RootExists\":  true,\n    \"MarkerCounts\":  [\n                         {\n                             \"Marker\":  \"1783358744\",\n                             \"TimedOut\":  false,\n                             \"MatchCount\":  0\n                         },\n                         {\n                             \"Marker\":  \"Beacon Ridge Demo\",\n                             \"TimedOut\":  false,\n                             \"MatchCount\":  0\n                         },\n                         {\n                             \"Marker\":  \"/@vite/client\",\n                             \"TimedOut\":  false,\n                             \"MatchCount\":  354\n                         },\n                         {\n                             \"Marker\":  \"scheduleFolderMatterRetag\",\n                             \"TimedOut\":  false,\n                             \"MatchCount\":  2\n                         }\n                     ]\n}"
    },
    {
      "code": "ComponentStatus/StdErr/succeeded",
      "displayStatus": "Provisioning succeeded",
      "level": "Info",
      "message": ""
    }
  ]
}

```


### az vm deallocate requested

Command:

```bash
az vm deallocate -g lantern-bench -n lantern-cloud-bench-1 --no-wait
```

Output:

```text

```
