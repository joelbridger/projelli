# Offline Mode adversarial traffic gate — final follow-up result

**Overall: PARTIAL — not an unconditional release pass.** The one remaining gap is a real local-AI sidecar cycle: the bench has no verified local model, and the production model is a 2.5 GB download that this gate deliberately did not start.

This folder adds the final two checks to the earlier passing packet evidence in `20260711T133300Z`. Packet Monitor was checked on this Legion before the run: `pktmon start help` shows no PID/process option, and `pktmon list` only reports network components. Therefore the three-minute check uses the process-tree TCP connection table as its attribution signal; Packet Monitor remains a machine-wide corroborating capture.

## Required assertions

| Assertion | Verdict | Reason |
|---|---|---|
| No off-device DNS during exercised Offline Mode actions | Pass | The prior packet action-window evidence records zero DNS queries; this follow-up’s rerun also records zero DNS queries, despite unrelated machine traffic. |
| No new off-device TCP/UDP attempt during exercised actions | Pass | The earlier scoped action-window packet evidence remains the clean proof. The follow-up capture was deliberately retained as machine-wide context only because shared-bench traffic appeared during it and cannot be attributed to Lantern. |
| No proxy request or WebSocket upgrade while Offline Mode was exercised | Pass | The earlier gate’s proxy flow file and JSON log remain empty while the guarded actions return their block messages. |
| Loopback Local AI works | Not run | `local_llm_model_status` is `error`; the only small model fixtures are Rust download-unit fixtures, not a usable sidecar model. The production Qwen GGUF is 2,497,280,736 bytes, so no fresh download was started. |
| Clear block text and exactly one receipt per online action | Pass | The desktop driver again received the standard block text for Outlook mail, Outlook Calendar, Wealthbox, local-model download, meeting join, and MCP; the earlier full receipt evidence remains controlling, and this follow-up retains its new blocked-receipt subset plus verified audit integrity in `offline-rerun-driver-summary.json`. |
| No late reconnect during the three-minute idle period | Pass (TCP, process-scoped) | `quiet-process-connections.json` contains 29 samples across 182 seconds, following Lantern.exe and six WebView2 children, with zero non-loopback TCP connections. This is precise for TCP; it cannot attribute UDP, which the Packet Monitor version also cannot scope to a process. |
| Local data readable and cached entitlement usable | Pass | The app’s own Tauri filesystem bridge listed and read the seeded file after Offline Mode actions; after a reload from the two production cache keys, the Account panel showed Professional, the Offline Mode cached-license message, and no degraded warning. |

## Method and limits

- `quiet-process-summary.json` is the small reviewable result of the process-tree watcher. The full samples are in `quiet-process-connections.json`.
- `pktmon-start-help.txt` and `pktmon-list.txt` document why a process-filtered packet capture was unavailable on this Windows build.
- `offline-rerun-driver-summary.json` records the seeded local-file read and the cached-entitlement UI result through the real desktop app without retaining unrelated older audit entries from the shared bench.
- The proxy-based online control remains a known non-blocking harness limitation. It was not re-run: the earlier Packet Monitor control already independently observed real DNS, TCP SYN, and TLS traffic with Offline Mode off, which is stronger evidence than the proxy recorder.
