# Offline Mode adversarial traffic-gate result — PARTIAL / NOT A RELEASE PASS

Ran on the shared Legion Windows bench on 2026-07-11 using the real Tauri desktop app and Windows Packet Monitor (`pktmon`). Earlier evidence folders remain unchanged.

## Packet-recorder proof

The passive recorder smoke test passed before the app run. It used the bench's normal DNS server (`75.75.75.75`) plus a direct HTTPS request to Cloudflare. The saved packet summary records two DNS queries, two TCP SYN packets, and TLS record bytes. No DNS listener was started and the bench DNS configuration was never changed.

## Required assertions

| Assertion | Result | Evidence |
|---|---|---|
| No off-device DNS during exercised Offline Mode actions | Pass | `offline-packet-analysis.json` has zero DNS queries. |
| No new off-device TCP/UDP attempt during exercised actions | Pass, scoped | The same action window has zero TCP SYN and zero UDP packets. It contains one already-open external TCP data packet, which is recorded rather than hidden. |
| No proxy request or WebSocket upgrade while Offline Mode was exercised | Pass | The proxy flow file is zero bytes and no proxy JSON log was written. |
| Loopback Local AI works | Not run | The installed local-model status was `error`; no verified local model was available. |
| Clear block text and exactly one receipt per online action | Pass for mail, calendar, Wealthbox, local-model download, meeting join, and MCP | `offline-driver-result.json` has the standard Offline Mode text for each, six blocked receipts, and verified audit integrity. The cached RAG model was already ready, so it made no download attempt. |
| No late reconnect during the three-minute idle period | Not proven | The app's proxy count stayed at zero and its connection snapshot was loopback-only, but machine-wide `pktmon` recorded unrelated DNS-free external TCP/UDP traffic. It cannot attribute those packets to Lantern. |
| Local data readable and cached entitlement usable | Not run | The disposable profile had no suitable local-file or previously confirmed entitlement fixture. |

## Online control

Offline Mode was then started fresh as off (rather than relying on a Windows file-replace that was temporarily locked). The app wrote `allowed` then `failed` receipts for Outlook mail and Wealthbox. The packet capture independently recorded DNS for `login.microsoftonline.com` and an external TCP SYN/TLS traffic during that control window.

The proxy did **not** record those requests. The proxy listener was healthy, but the native requests still went directly to the network. Therefore the required “traffic observed in both proxy and packet capture” control did not pass.

## Overall verdict

**Not a full pass.** The new passive capture method works and gives meaningful proof for the immediate Offline Mode action window. The app-side guards, messages, receipts, and no-new-connection result all passed. The release gate remains open because the three-minute packet proof cannot isolate Lantern from unrelated bench traffic, and because the online proxy control still bypasses the recorder.

## Bench restoration

Restored live after the run: normal DNS (IPv4 `75.75.75.75`, `75.75.76.76`, plus the original IPv6 servers), direct proxy settings, zero `Lantern Offline Gate` firewall rules, no running Packet Monitor capture, the original launcher, and CDP HTTP 200 from the normal launcher.
