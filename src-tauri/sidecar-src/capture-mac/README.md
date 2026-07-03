# capture-mac sidecar

Swift binary. Captures system audio via ScreenCaptureKit
(SCStreamConfiguration.capturesAudio = true, excludesCurrentProcessAudio =
true), converts to 16 kHz mono Int16, writes raw little-endian PCM to stdout
in ≤4096-byte writes. Requires the "System Audio Recording" permission
(macOS 14.4+) or Screen Recording permission (13.0–14.3). On permission
denial: print a one-line error to stderr and exit 3. On SIGTERM: stop the
stream, flush, exit 0. Build: `swiftc -O capture-mac.swift -o capture-mac`
on the M1 bench; stage via `npm run fetch-voice-sidecar`'s pattern into
`src-tauri/binaries/capture-mac-<target-triple>`.
