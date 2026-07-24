# Milestone 1 package and Laptop-2 regression — 2026-07-24

## Verdict: PARTIAL

Legion safely built the exact accepted `5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef` app once. The new unsigned development installer is hash-bound from Legion to a fresh server staging folder.

**First blocker:** Laptop-2 rejected the required direct PowerShell-over-SSH command before any Laptop-2 command ran. This lane forbids changing that command shape. Therefore the installer was not copied to Laptop-2, nothing was installed or launched there, and the Milestone 1 desktop journey is **NOT RUN**.

This is not release proof and does not re-confirm Milestone 1. The build task returned exit code 1 only because the expected updater signing private key was absent after it had already produced the executable and NSIS installer. Both artifacts are unsigned development bytes.

See `receipt.json` for the exact build, hash, resource, fixture, and stop facts. Run `python3 verify.py` to validate the fail-closed stop boundary.
