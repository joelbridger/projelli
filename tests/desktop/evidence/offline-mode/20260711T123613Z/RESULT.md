# Offline Mode adversarial traffic-gate result — FAILED

Ran on the Legion Windows bench on 2026-07-11 using the real dev-mode Lantern desktop app. This was **not** a signed build: code-signing credentials were unavailable, and signing does not change network egress behavior.

## What ran

- Full Rust rebuild from this branch, then the normal interactive `KeepanceDev` desktop launcher.
- Temporary per-process firewall blocks for the Lantern executable and WebView2 executable, allowing only local listeners.
- A local recording mitmproxy listener, a local DNS forwarder, and a disposable proxy certificate trusted only for this run. The certificate, rules, DNS setting, proxy setting, launcher edit, and native policy file were restored afterward. `restoration-check` was performed live: Wi-Fi DNS returned to `75.75.75.75, 75.75.76.76`, no gate firewall rule remained, the normal launcher file was restored, and CDP returned HTTP 200.
- Valid Offline Mode pre-start policy: `offlineMode: true`, native status hydrated successfully.
- Real desktop CDP run using production Tauri command surfaces where OAuth/CRM dialogs cannot be completed without bench credentials: Outlook mail sign-in, Outlook calendar sign-in, Wealthbox CRM validation, local-model download, meeting auto-join, and MCP access.
- A three-minute idle observation from 12:29 through 12:32 UTC.
- Control runs with Offline Mode off for Outlook mail and Wealthbox CRM.

## Required assertions

| Assertion | Result | Evidence / limitation |
|---|---|---|
| No off-device DNS | Not proven | DNS log stayed empty during the valid offline run, but the control run did not produce any recorder traffic. |
| No off-device TCP/UDP attempts | Not proven | The temporary outbound blocks were present and no established non-loopback Lantern connection was observed, but no PID-level blocked-packet trace was captured. |
| No proxy request or WebSocket upgrade | Not proven | Proxy flow and JSON logs are empty, but the control cannot show the proxy could observe Lantern traffic. |
| Loopback local AI works | Not run | No suitable local model/service was available on this bench. |
| Clear block message and exactly one receipt per online action | Failed | Mail, calendar, local model download, and meeting join had clear messages and native blocked receipts. Wealthbox wrote one blocked receipt but returned only `Could not connect to Wealthbox: invalid token or network error`; MCP returned the clear message but did not write a network receipt. |
| No late reconnect during quiet period | Not proven | No DNS/proxy log row appeared across the three-minute quiet period, but the recorder control failed. |
| Local data readable and cached entitlement usable | Not run | The isolated app profile had no pre-cached entitlement or local-file fixture. |

## Control result

**FAILED.** With Offline Mode off, Lantern wrote `allowed` then `failed` receipts for Outlook mail and Wealthbox, but mitmproxy recorded no requests and the flow file remained zero bytes. The firewall therefore blocked direct attempts instead of the recorder observing them. A zero-traffic offline run is not meaningful until this control is fixed.

## Important findings

1. Wealthbox's Offline Mode UI error is not the required clear Offline Mode message, even though its native blocked receipt is correct.
2. The MCP guard returns the correct clear message but does not make a network-egress receipt in this exercised path.
3. The proposed proxy routing did not intercept Lantern native traffic on the scheduled Windows desktop launcher. The next gate run needs a verified process-level redirect/capture method (for example Windows Filtering Platform/ETW packet events plus a proxy configuration that `reqwest` demonstrably honors) before claiming a pass.

The first attempt at 12:26 had a malformed test policy caused by a remote escaping mistake. Lantern safely failed closed and wrote receipts with `POLICY_CHANGED_OR_UNAVAILABLE`; it is retained in the audit export as a setup preflight and is not counted as the valid Offline Mode result.
