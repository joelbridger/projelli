#!/usr/bin/env bash
# Real-OS bench runner: syncs source + runs cargo test on the Windows Legion and M1 Mac.
#
# Both benches hold a synced COPY of the source (not a git checkout). This script:
#   1. Probes each bench for reachability (short ConnectTimeout only for the probe).
#   2. If reachable: syncs source via tarball, then runs `cargo test` with the correct PATH.
#   3. Parses OUTPUT (not exit code) to decide pass/fail — Windows SSH exit codes are unreliable.
#   4. Maintains a soft-fail STATUS FILE at ~/.local/share/keepance-bench/status.json:
#        - bench OFFLINE first night → warning log only (no critical text)
#        - bench OFFLINE 2+ consecutive nights → critical notify
#        - bench test FAILURE → critical notify immediately naming the OS
#        - bench PASS → reset counters, update last_pass (timestamp + commit SHA)
#   5. Notifies Jameson via notify-jameson for failures/escalations (in plain language).
#
# --check   Safe probe mode: test reachability + cargo --version on each bench (proves PATH
#           and capture path work), exercise status-file read/write, but SKIP tarball sync
#           and the full cargo test. Use this to validate the script without heavy work.
#
# RELEASE-GATE HOOK (future):
#   The status file records last_pass.timestamp + last_pass.commit per bench.
#   A pre-release check can read ~/.local/share/keepance-bench/status.json and require
#   both benches to have a recent passing run before cutting a signed build.
#   See the update_status() / read_status() helpers below.
#
# Safety rules (from ops guide §5 — violating these wasted 49 minutes last time):
#   - NEVER wrap the actual remote build/test in a short timeout; it orphans the remote process.
#     Only the reachability PROBE uses ConnectTimeout=15.
#   - Windows SSH exit codes are unreliable; always parse the output for pass/fail signals.
#   - macOS over SSH won't auto-load PATH; prepend it in every remote command.
#   - The OS keychain can't be tested over SSH; keychain tests are gated by env var and excluded.

set -uo pipefail

# ── Flags ────────────────────────────────────────────────────────────────────
CHECK_MODE=0
for arg in "$@"; do
  [[ "$arg" == "--check" ]] && CHECK_MODE=1
done

# ── Bench config ──────────────────────────────────────────────────────────────
WIN_USER="james"
WIN_HOST="100.127.67.22"
# Windows code dir on the bench: C:\keepance (hardcoded in the remote commands below)

MAC_USER="keepancebench"
MAC_HOST="100.113.42.26"
# macOS code dir on the bench: ~/keepance (keepancebench's home; hardcoded in remote commands below)

# ── Status file ──────────────────────────────────────────────────────────────
STATUS_DIR="$HOME/.local/share/keepance-bench"
STATUS_FILE="$STATUS_DIR/status.json"

mkdir -p "$STATUS_DIR"

# Initialise status file if missing
if [[ ! -f "$STATUS_FILE" ]]; then
  cat > "$STATUS_FILE" <<'EOF'
{
  "windows": {
    "last_attempt": null,
    "last_result": null,
    "consecutive_offline": 0,
    "consecutive_fail": 0,
    "last_pass": { "timestamp": null, "commit": null }
  },
  "mac": {
    "last_attempt": null,
    "last_result": null,
    "consecutive_offline": 0,
    "consecutive_fail": 0,
    "last_pass": { "timestamp": null, "commit": null }
  }
}
EOF
fi

# read_field BENCH FIELD  → prints value (strips surrounding quotes if a string)
read_field() {
  local bench="$1" field="$2"
  python3 -c "
import json, sys
with open('$STATUS_FILE') as f:
  d = json.load(f)
v = d.get('$bench', {}).get('$field')
print(v if v is not None else '')
" 2>/dev/null || echo ""
}

# update_status BENCH RESULT [COMMIT_SHA]
#   RESULT is one of: pass | test_fail | offline
update_status() {
  local bench="$1" result="$2" commit="${3:-}"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 - "$bench" "$result" "$commit" "$now" "$STATUS_FILE" <<'PYEOF'
import json, sys

bench, result, commit, now, path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

with open(path) as f:
    d = json.load(f)

b = d.setdefault(bench, {
    "last_attempt": None, "last_result": None,
    "consecutive_offline": 0, "consecutive_fail": 0,
    "last_pass": {"timestamp": None, "commit": None}
})

b["last_attempt"] = now
b["last_result"]  = result

if result == "offline":
    b["consecutive_offline"] = b.get("consecutive_offline", 0) + 1
    # leave consecutive_fail unchanged
elif result == "test_fail":
    b["consecutive_offline"] = 0
    b["consecutive_fail"] = b.get("consecutive_fail", 0) + 1
elif result == "pass":
    b["consecutive_offline"] = 0
    b["consecutive_fail"] = 0
    b["last_pass"] = {"timestamp": now, "commit": commit or "unknown"}

d[bench] = b
with open(path, "w") as f:
    json.dump(d, f, indent=2)
PYEOF
}

# ── Source commit for status tracking ─────────────────────────────────────────
REPO_DIR="$HOME/keepance"
COMMIT_SHA="unknown"
if command -v git &>/dev/null && [[ -d "$REPO_DIR/.git" ]]; then
  COMMIT_SHA="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
fi

# ── Logging ───────────────────────────────────────────────────────────────────
echo "=== Keepance bench tests $(date -u) ==="
echo "Commit: $COMMIT_SHA"
if [[ "$CHECK_MODE" -eq 1 ]]; then
  echo "(--check mode: probe + cargo --version only, no sync or full test)"
fi
echo ""

# ── SSH helper: reachability probe only ───────────────────────────────────────
# Returns 0 if reachable, 1 if not.
probe_reachable() {
  local user="$1" host="$2"
  # -o BatchMode=yes   → never prompt for password/passphrase (fails fast)
  # -o ConnectTimeout=15 → give up after 15 s if no route
  # -o StrictHostKeyChecking=no → don't hang on unknown host key in automation
  ssh -o BatchMode=yes \
      -o ConnectTimeout=15 \
      -o StrictHostKeyChecking=no \
      "${user}@${host}" "exit 0" 2>/dev/null
}

# ── Result accumulators ───────────────────────────────────────────────────────
WIN_RESULT=""   # pass | test_fail | offline
MAC_RESULT=""

# ═════════════════════════════════════════════════════════════════════════════
#  WINDOWS — Legion (james@100.127.67.22, PowerShell, C:\keepance)
# ═════════════════════════════════════════════════════════════════════════════
echo "##### Windows bench (${WIN_USER}@${WIN_HOST}) #####"

if probe_reachable "$WIN_USER" "$WIN_HOST"; then
  echo "[windows] Reachable."

  if [[ "$CHECK_MODE" -eq 1 ]]; then
    # --check: just prove toolchain PATH + capture path work.
    # Use a base64-encoded PowerShell command to avoid bash/SSH quoting issues
    # (backslashes in Windows paths get mangled otherwise).
    echo "[windows] --check: running cargo --version to verify toolchain PATH ..."
    # The PowerShell one-liner (single-quoted so bash doesn't touch it):
    #   $env:Path = "$env:USERPROFILE\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;" + $env:Path; cargo --version
    # Encoded as UTF-16LE base64 for powershell -EncodedCommand (avoids all quoting issues).
    WIN_OUTPUT="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
      "${WIN_USER}@${WIN_HOST}" \
      'powershell -NonInteractive -Command { $env:Path = $env:USERPROFILE + "\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;" + $env:Path; cargo --version }' \
      2>&1 || true)"
    echo "[windows] Output: $WIN_OUTPUT"
    if echo "$WIN_OUTPUT" | grep -qi "cargo"; then
      echo "[windows] --check PASSED (cargo found)"
      WIN_RESULT="pass"
    else
      echo "[windows] --check WARNING: cargo not found in output"
      WIN_RESULT="test_fail"
    fi

  else
    # Full run: sync source then run cargo test
    echo "[windows] Syncing source via tarball ..."
    TARBALL="/tmp/keepance-src-$(date +%Y%m%d-%H%M%S).tgz"
    tar czf "$TARBALL" -C "$REPO_DIR" \
      --exclude=node_modules --exclude=target --exclude=.git \
      --exclude=dist --exclude=dist-web-demo --exclude=dist-node \
      --exclude=playwright-report --exclude=test-results \
      . 2>&1
    echo "[windows] Tarball created: $TARBALL"

    # scp to Windows home dir (PowerShell expands ~ to USERPROFILE)
    scp -o BatchMode=yes -o StrictHostKeyChecking=no \
        "$TARBALL" "${WIN_USER}@${WIN_HOST}:keepance-src.tgz" 2>&1
    rm -f "$TARBALL"
    echo "[windows] Tarball transferred."

    # Extract on Windows (PowerShell), then run cargo test.
    # NOTE: Do NOT wrap in a short local timeout — that orphans the remote process.
    # The systemd service already caps the whole nightly at 7200 s.
    # We parse OUTPUT to decide pass/fail; Windows SSH exit codes are unreliable.
    # Use { } block syntax to avoid bash/SSH double-quote escaping issues with backslash paths.
    echo "[windows] Extracting + running cargo test (this takes ~7 min; no short timeout) ..."
    WIN_OUTPUT="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
      "${WIN_USER}@${WIN_HOST}" \
      'powershell -NonInteractive -Command { $env:Path = $env:USERPROFILE + "\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;" + $env:Path; Remove-Item -Recurse -Force C:\keepance -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force C:\keepance | Out-Null; tar -xzf ($env:USERPROFILE + "\keepance-src.tgz") -C C:\keepance; Remove-Item ($env:USERPROFILE + "\keepance-src.tgz") -ErrorAction SilentlyContinue; Set-Location C:\keepance\src-tauri; cargo test --workspace 2>&1 }' \
      2>&1 || true)"

    echo "$WIN_OUTPUT"

    # Parse output for pass/fail (DO NOT trust exit code on Windows)
    if echo "$WIN_OUTPUT" | grep -qE "test result: FAILED|error\[E[0-9]+\]|^error:"; then
      echo "[windows] FAILED (failure signal found in output)"
      WIN_RESULT="test_fail"
    elif echo "$WIN_OUTPUT" | grep -qE "test result: ok"; then
      echo "[windows] PASSED"
      WIN_RESULT="pass"
    else
      # Neither a clear pass nor a clear failure — treat as failure to be safe
      echo "[windows] INDETERMINATE (no 'test result: ok' found) — treating as FAILED"
      WIN_RESULT="test_fail"
    fi
  fi

else
  echo "[windows] OFFLINE (unreachable within 15 s)"
  WIN_RESULT="offline"
fi

echo ""

# ═════════════════════════════════════════════════════════════════════════════
#  macOS — M1 (keepancebench@100.113.42.26, zsh, ~/keepance)
# ═════════════════════════════════════════════════════════════════════════════
echo "##### macOS bench (${MAC_USER}@${MAC_HOST}) #####"

if probe_reachable "$MAC_USER" "$MAC_HOST"; then
  echo "[mac] Reachable."

  if [[ "$CHECK_MODE" -eq 1 ]]; then
    # --check: prove toolchain PATH + capture path work
    echo "[mac] --check: running cargo --version to verify toolchain PATH ..."
    MAC_OUTPUT="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
      "${MAC_USER}@${MAC_HOST}" \
      'export PATH="$HOME/.cargo/bin:$HOME/node/bin:$HOME/protoc/bin:$PATH"; cargo --version' \
      2>&1 || true)"
    echo "[mac] Output: $MAC_OUTPUT"
    if echo "$MAC_OUTPUT" | grep -qi "cargo"; then
      echo "[mac] --check PASSED (cargo found)"
      MAC_RESULT="pass"
    else
      echo "[mac] --check WARNING: cargo not found in output"
      MAC_RESULT="test_fail"
    fi

  else
    # Full run: sync source then run cargo test
    echo "[mac] Syncing source via tarball ..."
    TARBALL="/tmp/keepance-src-mac-$(date +%Y%m%d-%H%M%S).tgz"
    tar czf "$TARBALL" -C "$REPO_DIR" \
      --exclude=node_modules --exclude=target --exclude=.git \
      --exclude=dist --exclude=dist-web-demo --exclude=dist-node \
      --exclude=playwright-report --exclude=test-results \
      . 2>&1
    echo "[mac] Tarball created: $TARBALL"

    scp -o BatchMode=yes -o StrictHostKeyChecking=no \
        "$TARBALL" "${MAC_USER}@${MAC_HOST}:keepance-src.tgz" 2>&1
    rm -f "$TARBALL"
    echo "[mac] Tarball transferred."

    echo "[mac] Extracting + running cargo test (no short timeout) ..."
    MAC_OUTPUT="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
      "${MAC_USER}@${MAC_HOST}" \
      'export PATH="$HOME/.cargo/bin:$HOME/node/bin:$HOME/protoc/bin:$PATH";
       rm -rf ~/keepance;
       mkdir -p ~/keepance;
       tar -xzf ~/keepance-src.tgz -C ~/keepance;
       rm -f ~/keepance-src.tgz;
       cd ~/keepance/src-tauri;
       cargo test --workspace 2>&1' \
      2>&1 || true)"

    echo "$MAC_OUTPUT"

    # Parse output for pass/fail
    if echo "$MAC_OUTPUT" | grep -qE "test result: FAILED|error\[E[0-9]+\]|^error:"; then
      echo "[mac] FAILED (failure signal found in output)"
      MAC_RESULT="test_fail"
    elif echo "$MAC_OUTPUT" | grep -qE "test result: ok"; then
      echo "[mac] PASSED"
      MAC_RESULT="pass"
    else
      echo "[mac] INDETERMINATE (no 'test result: ok' found) — treating as FAILED"
      MAC_RESULT="test_fail"
    fi
  fi

else
  echo "[mac] OFFLINE (unreachable within 15 s)"
  MAC_RESULT="offline"
fi

echo ""

# ═════════════════════════════════════════════════════════════════════════════
#  Update status file + soft-fail escalation notifications
# ═════════════════════════════════════════════════════════════════════════════

# -- Windows --
update_status "windows" "$WIN_RESULT" "$COMMIT_SHA"
NEW_WIN_OFFLINE="$(read_field windows consecutive_offline)"
NEW_WIN_FAIL="$(read_field windows consecutive_fail)"

if [[ "$WIN_RESULT" == "pass" ]]; then
  echo "[status] Windows: PASS — status file updated with last_pass commit $COMMIT_SHA"

elif [[ "$WIN_RESULT" == "test_fail" ]]; then
  WIN_LOG="/tmp/keepance-bench-windows-$(date +%Y%m%d).log"
  echo "$WIN_OUTPUT" > "$WIN_LOG" 2>/dev/null || true
  echo "[status] Windows: TEST FAIL — notifying Jameson"
  notify-jameson \
    --subject "[Keepance] NEED YOU: Windows bench tests failed tonight" \
    --body "Project: Keepance (~/keepance)
Task: Nightly real-OS tests on the Windows test machine
Result: The Windows test run found failures tonight (consecutive fail streak: ${NEW_WIN_FAIL}). Something in the Rust code is broken specifically on Windows. The full test output is saved on the server at ${WIN_LOG}
Next: Open a Claude session, have it read that log file, and fix the Windows-specific failures." \
    --level critical --channel email,telegram || true

elif [[ "$WIN_RESULT" == "offline" ]]; then
  if [[ "${NEW_WIN_OFFLINE:-0}" -ge 2 ]]; then
    echo "[status] Windows: OFFLINE for ${NEW_WIN_OFFLINE} consecutive nights — sending critical alert"
    notify-jameson \
      --subject "[Keepance] NEED YOU: Windows test machine unreachable ${NEW_WIN_OFFLINE} nights in a row" \
      --body "Project: Keepance (~/keepance)
Task: Nightly real-OS tests on the Windows test machine
Result: The Windows test machine (the Legion laptop) has been unreachable for ${NEW_WIN_OFFLINE} nights in a row, so we have not been able to confirm Keepance still works on Windows.
Next: Check that the Legion is on, connected to the internet, and Tailscale is running on it. Then run 'bash scripts/nightly-bench-tests.sh --check' from the server to confirm it's reachable again." \
      --level critical --channel email,telegram || true
  else
    echo "[status] Windows: OFFLINE (night ${NEW_WIN_OFFLINE}) — logging warning only (threshold is 2)"
  fi
fi

# -- macOS --
update_status "mac" "$MAC_RESULT" "$COMMIT_SHA"
NEW_MAC_OFFLINE="$(read_field mac consecutive_offline)"
NEW_MAC_FAIL="$(read_field mac consecutive_fail)"

if [[ "$MAC_RESULT" == "pass" ]]; then
  echo "[status] macOS: PASS — status file updated with last_pass commit $COMMIT_SHA"

elif [[ "$MAC_RESULT" == "test_fail" ]]; then
  MAC_LOG="/tmp/keepance-bench-mac-$(date +%Y%m%d).log"
  echo "$MAC_OUTPUT" > "$MAC_LOG" 2>/dev/null || true
  echo "[status] macOS: TEST FAIL — notifying Jameson"
  notify-jameson \
    --subject "[Keepance] NEED YOU: Mac bench tests failed tonight" \
    --body "Project: Keepance (~/keepance)
Task: Nightly real-OS tests on the Mac test machine (M1)
Result: The Mac test run found failures tonight (consecutive fail streak: ${NEW_MAC_FAIL}). Something in the Rust code is broken specifically on macOS. The full test output is saved on the server at ${MAC_LOG}
Next: Open a Claude session, have it read that log file, and fix the Mac-specific failures." \
    --level critical --channel email,telegram || true

elif [[ "$MAC_RESULT" == "offline" ]]; then
  if [[ "${NEW_MAC_OFFLINE:-0}" -ge 2 ]]; then
    echo "[status] macOS: OFFLINE for ${NEW_MAC_OFFLINE} consecutive nights — sending critical alert"
    notify-jameson \
      --subject "[Keepance] NEED YOU: Mac test machine unreachable ${NEW_MAC_OFFLINE} nights in a row" \
      --body "Project: Keepance (~/keepance)
Task: Nightly real-OS tests on the Mac test machine (M1)
Result: The Mac test machine (Allison's M1) has been unreachable for ${NEW_MAC_OFFLINE} nights in a row, so we have not been able to confirm Keepance still works on macOS.
Next: Check that the Mac is on, connected to the internet, and Tailscale is running. Then run 'bash scripts/nightly-bench-tests.sh --check' from the server to confirm it's reachable again." \
      --level critical --channel email,telegram || true
  else
    echo "[status] macOS: OFFLINE (night ${NEW_MAC_OFFLINE}) — logging warning only (threshold is 2)"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
#  Summary
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== Bench test summary ==="
echo "  Windows : $WIN_RESULT"
echo "  macOS   : $MAC_RESULT"
echo "  Status file: $STATUS_FILE"
if [[ "$CHECK_MODE" -eq 1 ]]; then
  echo "  (--check mode: cargo --version probe only, no full tests run)"
fi
echo ""

# Exit 0 always — bench failures are reported via notify-jameson above.
# The parent nightly-tests.sh treats this as informational (non-fatal).
exit 0
