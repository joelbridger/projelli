#!/usr/bin/env bash
# VG-1 LEG 3 — real-machine wedge proof: environment orchestration.
#
# The REAL Tauri debug binary, on this rig, headless:
#   Xvfb :99 1366x768 · production frontend via `vite preview` on :5173 (no
#   HMR reload storms — the campaign's F-422 session killer) · fresh XDG
#   profile with the e5-small model cache PRE-SEEDED (no network; Option B
#   gate satisfied) · fixture workspace seeded on disk (NEVER the GTK file
#   chooser — keyboard-isolated headless) · headless Secret Service
#   (gnome-keyring under dbus-run-session): the live vector store fetches its
#   master key from the OS keychain BEFORE embedding (rag/mod.rs:446), so
#   without this, indexing fails with "vectors key: …" on any headless box.
#   Memory: systemd-run scope, MemoryMax=3G (embedder plateau ~1.4G, transient
#   peak ~2.05G — native-findings.md F-416). Check `free -h` first; this box
#   is memory-tight.
#
# Rig-verified corrections baked in (2026-06-10):
#   · gnome-keyring 46 rejects `--unlock --start` ("incompatible") and its
#     collection prompter needs a display — headless bring-up is the two-step
#     `--daemonize --login` (empty password on stdin, creates/unlocks the
#     login keyring) then `--start --components=secrets`. Probe-verified.
#   · `systemd-run --user --scope` works unchanged INSIDE dbus-run-session on
#     this rig (probe-verified), so no bus-address gymnastics are needed.
#   · resolve_cache_dir() (embedder.rs:54-66) prefers an exe-adjacent model
#     bundle when it is POPULATED — and this rig has one (gitignored Option B
#     artifact at src-tauri/resources/embeddings, mirrored by tauri-build into
#     target/debug/resources/embeddings; all 5 REQUIRED_FILES resolve). The
#     `--fresh-model` run therefore stashes the TARGET-side bundle (build
#     output, never product source) or the download card could never appear;
#     `down` restores it.
#   · README.md stays OUT of the seeded workspace: it documents the planted
#     contradictions (the answer key — indexing it would contaminate the
#     proof) and would bump the indexable count past the expected 4 files
#     (extractor.rs TEXT_EXTENSIONS over the corpus = deposition .txt,
#     incident-summary .md, huge-notes.md, acme-supply-agreement.txt).
#   · huge-notes.md ALSO stays OUT (Task 7, 2026-06-11 — RESULTS.md F-501):
#     first-indexing it oom-killed the real app at 3G (twice), 6G and 12G
#     caps, identical phase, monotonic ~1.5 GB/s growth with no release
#     (logs/cgroup-mem.csv; index_one_file embeds all ~1,400 chunks of the
#     2 MB file through one embed_documents call → fastembed's internal
#     256-sequence batches). None of the wedge claims live in that file
#     (leg 1's corpus never included it), so the positive pass runs on the
#     3 indexable survivors and the OOM is a logged P1 finding, not fixed
#     here. Expected banner/status count for this harness is therefore
#     "3 files", not the plan's original 4.
#
# OUT OF SCOPE on this rig (stays on the Windows spot check): live mail
# import (TLS-only IMAP vs the plaintext greenmail fixture, F-419) and the
# live-audit-capture micro-item (F-425 assigns it to a keychain-bearing
# desktop; if events incidentally capture here with the headless keyring up,
# bank them as bonus evidence only).
#
# The UI pass itself is attended (xdotool + screenshots per
# docs/quality/2026-06-11-wedge-proof/RUNBOOK.md); this script provides the
# helpers (`shot`, `click`, `key`, `type`) and the disk-truth `assert`.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${WEDGE_PROFILE:-/tmp/wedge-profile}"
WS="${WEDGE_WS:-/tmp/wedge-ws}"
ART="$REPO/docs/quality/2026-06-11-wedge-proof"
DISP=":99"
PORT=5173
BIN="$REPO/src-tauri/target/debug/keepance"
MODEL_SRC="$HOME/.local/share/keepance/models/e5-small"
APP_LOG="$ART/logs/app.log"
RSS_CSV="$ART/logs/rss.csv"
SAMPLER_PID="$ART/logs/rss-sampler.pid"
# Exe-adjacent model bundle (resolve_cache_dir() prefers it when populated).
BUNDLE_MODEL="$REPO/src-tauri/target/debug/resources/embeddings/models--intfloat--multilingual-e5-small"
BUNDLE_STASH="$REPO/src-tauri/target/debug/resources/embeddings/.wedge-stash-models--intfloat--multilingual-e5-small"
# Our vite preview's exact cmdline shape (node resolves the .bin shim), so
# pkill/pgrep only ever touch the instance THIS script started.
PREVIEW_PAT="$REPO/node_modules/.bin/vite preview --port $PORT"

say() { printf '\n== %s ==\n' "$*"; }

cmd_preflight() {
  say "preflight"
  free -h | sed -n '1,2p'
  local avail_gb t
  avail_gb=$(free -g | awk '/^Mem:/{print $7}')
  [ "$avail_gb" -ge 4 ] || echo "WARN: <4G available — close something before launch"
  for t in Xvfb xdotool scrot unzip python3 secret-tool dbus-run-session rsync curl; do
    command -v "$t" >/dev/null || { echo "FAIL: required tool missing: $t"; exit 1; }
  done
  curl -sf localhost:11434/api/tags | grep -q 'llama3.2' \
    || { echo "FAIL: ollama llama3.2:3b not available"; exit 1; }
  [ -d "$MODEL_SRC/models--intfloat--multilingual-e5-small" ] \
    || { echo "FAIL: e5-small cache missing at $MODEL_SRC"; exit 1; }
  if ! dpkg -s gnome-keyring >/dev/null 2>&1; then
    echo "gnome-keyring not installed. Run once:  sudo apt-get install -y gnome-keyring"
    exit 1
  fi
  if [ -x "$BIN" ]; then
    echo "debug binary present: $BIN"
  else
    echo "NOTE: debug binary not built yet — 'up' will build it"
  fi
  if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
    echo "NOTE: port $PORT is currently in use — 'up' needs it free (or held by our own preview):"
    ss -ltnp "sport = :$PORT" 2>/dev/null || true
  fi
  echo "preflight OK"
}

# Idempotent Xvfb bring-up: start only when $DISP is not already serving.
# `down` kills Xvfb, but `launch` must be re-runnable after `down` — the
# seeding flow is launch → down → seed-localstorage → launch, and Task 7's
# Option B run is down → launch --fresh-model.
ensure_xvfb() {
  mkdir -p "$ART/logs" "$ART/screenshots" "$ART/output"
  if ! DISPLAY="$DISP" xdotool getdisplaygeometry >/dev/null 2>&1; then
    Xvfb "$DISP" -screen 0 1366x768x24 >"$ART/logs/xvfb.log" 2>&1 &
    sleep 1
  fi
  DISPLAY="$DISP" xdotool getdisplaygeometry >/dev/null \
    || { echo "FAIL: Xvfb $DISP did not come up (see $ART/logs/xvfb.log)"; exit 1; }
}

# Idempotent vite-preview bring-up. OURS = cmdline matches PREVIEW_PAT; a
# foreign listener on $PORT is a hard FAIL (never killed, never reused).
ensure_preview() {
  if pgrep -f "$PREVIEW_PAT" >/dev/null 2>&1; then
    curl -sf "http://localhost:$PORT" >/dev/null \
      || { echo "FAIL: our preview is running but :$PORT does not answer (see $ART/logs/vite-preview.log)"; exit 1; }
    return 0
  fi
  if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
    echo "FAIL: port $PORT is held by a process this harness did not start:"
    ss -ltnp "sport = :$PORT" 2>/dev/null || true
    echo "Leg 3 needs $PORT (tauri.conf.json devUrl is fixed to it)."
    echo "Stop that process yourself — this script never kills foreign processes."
    exit 1
  fi
  (cd "$REPO" && nohup npx vite preview --port "$PORT" --strictPort \
      >"$ART/logs/vite-preview.log" 2>&1 &)
  for _ in $(seq 1 20); do
    curl -sf "http://localhost:$PORT" >/dev/null && break
    sleep 1
  done
  curl -sf "http://localhost:$PORT" >/dev/null \
    || { echo "FAIL: preview not up (see $ART/logs/vite-preview.log)"; exit 1; }
}

cmd_up() {
  say "build binary (debug) + production frontend"
  echo "(if another session holds the cargo lock, cargo waits — do not kill it)"
  (cd "$REPO/src-tauri" && cargo build 2>&1 | tail -2)
  (cd "$REPO" && npm run build 2>&1 | tail -3)

  say "Xvfb $DISP"
  # ^-anchored: must never match a shell whose cmdline merely MENTIONS the
  # pattern (e.g. a tool wrapper quoting this very command).
  pkill -f "^Xvfb $DISP" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    pgrep -f "^Xvfb $DISP" >/dev/null || break
    sleep 1
  done
  ensure_xvfb

  say "vite preview :$PORT (quiesced frontend — no HMR)"
  pkill -f "$PREVIEW_PAT" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    pgrep -f "$PREVIEW_PAT" >/dev/null || break
    sleep 1
  done
  ensure_preview

  say "fresh profile + model pre-seed + fixture workspace"
  rm -rf "$PROFILE" "$WS"
  mkdir -p "$PROFILE/data/keepance/models" "$PROFILE/config" "$PROFILE/cache" "$WS"
  cp -a "$MODEL_SRC" "$PROFILE/data/keepance/models/e5-small"
  # huge-notes.md excluded — F-501 (embedding it oom-kills the app; header).
  rsync -a --exclude generators --exclude README.md --exclude huge-notes.md \
    "$REPO/tests/fixtures/matter-corpus/" "$WS/"
  echo "workspace files:"; ls "$WS"
  echo "up OK — next: $0 launch   (run it in the background; it blocks)"
}

# Runs INSIDE the private dbus session (exported via `export -f`): brings up
# the headless Secret Service, proves it with a secret-tool round-trip, then
# starts the app under a 3G systemd scope with the fresh-profile XDG env.
wedge_launch_inner() {
  set -euo pipefail
  # Two-step headless keyring (gnome-keyring 46: --start and --unlock are
  # mutually exclusive, and collection creation wants a display-bound
  # prompter). --login reads an empty password from stdin and creates or
  # unlocks the login keyring; --start then raises the secrets component.
  eval "$(printf '\n' | gnome-keyring-daemon --daemonize --login)"
  eval "$(gnome-keyring-daemon --start --components=secrets)"
  export GNOME_KEYRING_CONTROL
  # Prove the Secret Service is alive BEFORE launching (otherwise the first
  # index dies with "vectors key: …", rag/mod.rs:446).
  printf 'x' | secret-tool store --label=wedge-probe service wedge key probe
  [ "$(secret-tool lookup service wedge key probe)" = "x" ] \
    || { echo "FAIL: keyring probe"; exit 1; }
  echo "keyring OK"

  ( while :; do
      pid=$(pgrep -x keepance | head -1) || true
      if [ -n "${pid:-}" ]; then
        echo "$(date +%s),$(awk '/VmRSS/{print $2}' "/proc/$pid/status" 2>/dev/null)" >>"$RSS_CSV"
      fi
      sleep 5
    done ) &
  sampler=$!
  echo "$sampler" >"$SAMPLER_PID"
  # No `exec` before systemd-run: exec would replace this shell, the EXIT
  # trap would never fire, and the sampler loop would be orphaned.
  trap 'kill "$sampler" 2>/dev/null || true; rm -f "$SAMPLER_PID"' EXIT

  # MemoryMax RECALIBRATED 3G→12G during Task 7 (2026-06-11). The campaign's
  # 3G bound was measured on a run whose embedder never embedded a document
  # (F-415/F-416 — the model never downloaded). REAL first-indexing of the
  # fixture corpus oom-killed the scope at 3G twice AND at 6G once, at the
  # identical phase (journal 'Failed with result oom-kill'; 1 s curve in
  # logs/cgroup-mem.csv: 188 MB → 6.0 GiB in ~5 s). Grounded mechanism, the
  # RESULTS.md finding: index_one_file embeds EVERY chunk of a file in one
  # embed_documents call (rag/mod.rs:343, batch_size None) and fastembed
  # 4.9.1 then batches 256 sequences internally (DEFAULT_BATCH_SIZE,
  # text_embedding/impl.rs:292); huge-notes.md (2 MB ≈ 1,400 chunks of ~384
  # tokens, chunker.rs:15) makes fp32 BERT attention buffers of ~5 GB per
  # internal batch. 12G lets the bounded one-time spike complete and STILL
  # guards the box (the incident-class leak was an unbounded accelerating
  # climb; preflight checks available RAM; MemorySwapMax=0 keeps the scope
  # un-swappable). The spike is logged as a product finding, not fixed here.
  systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 \
    --slice=wedgeproof \
    env DISPLAY="$DISP" GDK_BACKEND=x11 \
        XDG_DATA_HOME="$PROFILE/data" \
        XDG_CONFIG_HOME="$PROFILE/config" \
        XDG_CACHE_HOME="$PROFILE/cache" \
    "$BIN" >>"$APP_LOG" 2>&1
}

# Launch the app inside a private dbus session with an unlocked gnome-keyring
# (the standard headless-CI Secret Service pattern), under a 3G systemd scope.
# --fresh-model: REMOVE the model cache from the profile AND stash the
# exe-adjacent bundle (network stays on) to observe the Option B
# download-card → rag-banner ready handoff for real.
cmd_launch() {
  local fresh=0
  [ "${1:-}" = "--fresh-model" ] && fresh=1
  [ -x "$BIN" ] || { echo "FAIL: $BIN missing — run '$0 up' first"; exit 1; }
  [ -d "$PROFILE" ] || { echo "FAIL: profile $PROFILE missing — run '$0 up' first"; exit 1; }
  free -h | sed -n '1,2p'
  # `down` tears Xvfb + preview down; bring them back so launch is
  # re-runnable standalone (never touches the profile, unlike `up`).
  ensure_xvfb
  ensure_preview
  if [ "$fresh" = 1 ]; then
    rm -rf "$PROFILE/data/keepance/models/e5-small"
    if [ -d "$BUNDLE_MODEL" ]; then
      mv "$BUNDLE_MODEL" "$BUNDLE_STASH"
      echo "fresh-model run: exe-adjacent model bundle stashed (restored by 'down')"
    fi
    echo "fresh-model run: model cache removed from profile (network stays on)"
  elif [ -d "$BUNDLE_STASH" ] && [ ! -d "$BUNDLE_MODEL" ]; then
    mv "$BUNDLE_STASH" "$BUNDLE_MODEL"
    echo "restored exe-adjacent model bundle from stash"
  fi
  mkdir -p "$ART/logs"
  # Rotate (never truncate) so the positive pass's evidence survives the
  # later --fresh-model run.
  if [ -s "$APP_LOG" ]; then mv "$APP_LOG" "$APP_LOG.$(date +%s)"; fi
  [ -f "$RSS_CSV" ] || echo "ts,rss_kb" >"$RSS_CSV"
  echo "# launch $(date -Is) fresh=$fresh" >>"$RSS_CSV"

  export REPO PROFILE WS ART DISP PORT BIN APP_LOG RSS_CSV SAMPLER_PID
  export -f wedge_launch_inner
  dbus-run-session -- bash -c wedge_launch_inner
}

cmd_shot()  { mkdir -p "$ART/screenshots"; DISPLAY="$DISP" scrot -z -o "$ART/screenshots/$1.png"; echo "$ART/screenshots/$1.png"; }
cmd_click() { DISPLAY="$DISP" xdotool mousemove "$1" "$2" click 1; }
cmd_key()   { DISPLAY="$DISP" xdotool key "$@"; }
cmd_type()  { DISPLAY="$DISP" xdotool type --delay 30 "$1"; }

cmd_down() {
  pkill -x keepance 2>/dev/null || true
  pkill -f "$PREVIEW_PAT" 2>/dev/null || true
  pkill -f "^Xvfb $DISP" 2>/dev/null || true
  # The launch trap kills the sampler; sweep a stale one if launch was
  # interrupted hard.
  if [ -f "$SAMPLER_PID" ]; then
    kill "$(cat "$SAMPLER_PID")" 2>/dev/null || true
    rm -f "$SAMPLER_PID"
  fi
  # gnome-keyring-daemon normally dies with its dbus session; sweep
  # stragglers. (Its comm exceeds pgrep's 15-char -x limit, so match the
  # full cmdline; nothing else on this headless box runs gnome-keyring.)
  pkill -f 'gnome-keyring-daemon.*(--login|--components=secrets)' 2>/dev/null || true
  if [ -d "$BUNDLE_STASH" ] && [ ! -d "$BUNDLE_MODEL" ]; then
    mv "$BUNDLE_STASH" "$BUNDLE_MODEL"
    echo "restored exe-adjacent model bundle from stash"
  fi
  # The systemd-run scope dies with the app; its parent slice unit lingers
  # loaded-but-empty. Stop it so down leaves zero systemd residue.
  systemctl --user stop wedgeproof.slice 2>/dev/null || true
  sleep 1
  local left
  left=$(pgrep -af "target/debug/keepance|$PREVIEW_PAT|^Xvfb $DISP|gnome-keyring-daemon --" 2>/dev/null || true)
  if [ -n "$left" ]; then
    echo "WARN: still running after down:"
    echo "$left"
  fi
  echo "down OK (profile + workspace kept for inspection: $PROFILE, $WS)"
}

# Seed onboarding-complete + the recent-workspace entry into the webview's
# localStorage so the app boots straight to a selector with a clickable
# Recent entry (the GTK chooser is unusable headless). WebKit stores
# localStorage per-origin as an sqlite3 ItemTable with UTF-16-LE values;
# keys verified in src: keepance_recent_workspaces (workspaceStore.ts:155),
# keepance_onboarding_complete (FirstRunWizard.tsx:43),
# keepance_onboarding_completed_at (useOnboarding.ts:9). RecentWorkspace
# shape: {path,name,lastOpened} (types/workspace.ts:30-34). Method proven by
# the campaign (leak-investigation.md:54). The storage file exists only after
# one boot (App.tsx:798 writes `theme` on startup), so the flow is:
# launch (background) → wait for the window → down → seed-localstorage →
# launch again.
#
# Also seeds `keepance:settings` (zustand-persist, settingsStore.ts:125) with
# EXACTLY what the skipped onboarding would have persisted had the operator
# chosen "Keep everything on your computer": confidentialityMode=local-only
# (AiSetupStep.tsx:465 → setMode('local-only')). Without it the fresh profile
# defaults to 'direct' (egress.ts:65), the Ollama new-chat button never
# renders (AIAssistantPane.tsx gates it on modeRestrictsToLocal), and the
# workflow start dialog would not be the campaign's "$0 / runs on your local
# AI model" local path. featuresTourCompleted=true keeps the v1.6 auto-tour
# from obstructing the attended pass (same onboarding-class UI the seeding
# already skips).
cmd_seed_localstorage() {
  # Rig-verified layout (webkit2gtk on this box): flat per-origin file
  #   <profile>/data/com.keepance.app/localstorage/http_localhost_5173.localstorage
  # (an sqlite3 db despite the extension). Newer WebKit uses
  # storage/<salted-hash>/localstorage.sqlite3 — both shapes are matched.
  local db
  db=$(find "$PROFILE" -name '*localhost*5173*' \( -name '*.sqlite3' -o -name '*.localstorage' \) 2>/dev/null | head -1 || true)
  [ -z "$db" ] && db=$(find "$PROFILE" -ipath '*localstorage*' \( -name '*.sqlite3' -o -name '*.localstorage' \) 2>/dev/null | head -1 || true)
  if [ -z "$db" ]; then
    echo "FAIL: no localStorage sqlite under $PROFILE — boot the app once first (launch, wait for the window, down)"
    find "$PROFILE" \( -name '*.sqlite3' -o -name '*.localstorage' \) 2>/dev/null || true
    exit 1
  fi
  WS="$WS" python3 - "$db" <<'PY'
import json, os, sqlite3, sys
from datetime import datetime, timezone

db = sys.argv[1]
ws = os.environ["WS"]
recent = json.dumps([{
    "path": ws,
    "name": os.path.basename(ws),
    "lastOpened": datetime.now(timezone.utc).isoformat(),
}])
now = datetime.now(timezone.utc).isoformat()
# Mirror of the zustand-persist payload onboarding would have written
# (settingsStore partialize: values/_migrated/featuresTourCompleted/language).
#
# templateModelOverrides pins the Deposition Contradiction Finder to the
# local model — byte-identical to what Settings → Templates writes via
# handleProviderChange (TemplateModelSettings.tsx: firstModelFor('ollama')
# = 'llama3.1:8b'). Two reasons it is seeded rather than clicked (Task 7):
#   1. F-502 (RESULTS.md): without a pin, a local-only run silently no-ops —
#      handleStartWorkflow resolves provider from template pins + cloud keys
#      only (App.tsx:2306-2360 ignores confidentialityMode), lands on
#      'needs-provider', and returns before any workflow tab exists, so the
#      error banner (WorkflowExecutionTab.tsx:318) has nowhere to render.
#   2. The Settings provider <select> opens a native GTK popup that is
#      input-isolated on a no-WM Xvfb (same class as the GTK file chooser);
#      the pin cannot be clicked headless. The Settings surface itself is
#      screenshot-proven (run-08f..run-08i).
settings = json.dumps({
    "state": {
        "values": {
            "confidentialityMode": "local-only",
            "templateModelOverrides": {
                "legal-deposition-contradiction-finder": {
                    "provider": "ollama",
                    "model": "llama3.1:8b",
                }
            },
        },
        "_migrated": True,
        "featuresTourCompleted": True,
        "language": None,
    },
    "version": 0,
})

conn = sqlite3.connect(db)
conn.execute(
    "CREATE TABLE IF NOT EXISTS ItemTable "
    "(key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)"
)
for key, value in [
    ("keepance_recent_workspaces", recent),
    ("keepance_onboarding_complete", "true"),
    ("keepance_onboarding_completed_at", now),
    ("keepance:settings", settings),
]:
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (key, value.encode("utf-16-le")),
    )
conn.commit()
print(f"seeded {db}")
# Verification: decode every row back from UTF-16-LE so the seeding is
# self-evidencing (WebKit stores values as UTF-16-LE natively).
for key, value in conn.execute("SELECT key, value FROM ItemTable ORDER BY key"):
    preview = bytes(value).decode("utf-16-le", "replace")[:72]
    print(f"  {key}  ({len(value)} bytes)  {preview}")
PY
}

# Disk-truth assertions + artifact collection after the attended pass.
# PASS/FAIL rubric for the contradiction .docx (LLM wording varies, so we
# match the planted FACTS, tolerantly — README.md:43-47):
#   C1: /personal\s+e-?mail/i
#   C2: /October\s+17/ AND /October\s+10/
#   C3: /four[-\s]?weeks?/i AND /eight\s*(\(8\)\s*)?[-\s]?weeks?/i
# PASS requires ALL clusters. Up to 2 attended attempts are allowed (LLM
# nondeterminism); two misses = a logged finding (diagnose with the run
# record's retrievedChunks/verified counts: feed problem vs model quality),
# never a weakened rubric.
# Exit codes distinguish the failure stage:
#   2 = vector store has no data fragments (index never populated — F-415)
#   3 = no 'Deposition Contradiction Analysis.docx' under the workspace
#   4 = fact rubric FAIL (extracted text still banked for diagnosis)
cmd_assert() {
  say "vector store populated?"
  local frags
  frags=$(find "$WS/.keepance/vectors/chunks.lance" -name '*.lance' -not -path '*_versions*' 2>/dev/null | wc -l || true)
  echo "data fragments: $frags"
  [ "$frags" -gt 0 ] || { echo "FAIL(2): chunks.lance has no data fragments (index never populated — F-415 would still be open)"; exit 2; }

  say "app log shows real indexing activity"
  grep -c -i 'commit' "$APP_LOG" || echo "WARN: no commit lines in app log"

  say "contradiction-finder .docx rubric"
  local docx rubric_rc=0
  # Newest docx wins — the two-attempt rule means re-runs leave siblings.
  docx=$(find "$WS" -name 'Deposition Contradiction Analysis.docx' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2- || true)
  [ -n "$docx" ] || { echo "FAIL(3): no 'Deposition Contradiction Analysis.docx' under $WS"; exit 3; }
  echo "found: $docx"
  mkdir -p "$ART/output"
  cp "$docx" "$ART/output/"
  # Extraction goes to ART/output ONLY — never next to the docx: the
  # workspace indexes .txt, so an in-workspace extraction would feed the
  # analysis text back into the semantic store and contaminate any re-run
  # (burned once on attempt 1, Task 7).
  ART="$ART" python3 - "$docx" <<'PY' || rubric_rc=4
import os, re, sys, zipfile

xml = zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8", "replace")
text = re.sub(r"<[^>]+>", " ", xml)
out = os.path.join(os.environ["ART"], "output",
                   os.path.basename(sys.argv[1]) + ".extracted.txt")
open(out, "w").write(text)

clusters = {
    "C1 personal-email forwarding": bool(re.search(r"personal\s+e-?mail", text, re.I)),
    "C2 October 17 side":           bool(re.search(r"October\s+17", text)),
    "C2 October 10 side":           bool(re.search(r"October\s+10", text)),
    "C3 four-week side":            bool(re.search(r"four[-\s]?weeks?", text, re.I)),
    "C3 eight-week side":           bool(re.search(r"eight\s*(\(8\)\s*)?[-\s]?weeks?", text, re.I)),
}
for name, ok in clusters.items():
    print(f"  {'PASS' if ok else 'MISS'}  {name}")
if all(clusters.values()):
    print("RUBRIC: PASS — all three planted contradictions mentioned by fact")
else:
    print("RUBRIC: FAIL — missing clusters above (diagnose: run-record retrievedChunks vs LLM quality)")
    sys.exit(1)
PY
  # (Extraction already lands in ART/output above — banked on PASS and FAIL;
  # it IS the diagnostic.)
  [ "$rubric_rc" -eq 0 ] || exit "$rubric_rc"

  say "artifacts banked"
  find "$ART" -type f | sort | head -40
}

case "${1:-}" in
  preflight) cmd_preflight ;;
  up) cmd_up ;;
  launch) shift; cmd_launch "$@" ;;
  shot) cmd_shot "${2:?usage: $0 shot <name>}" ;;
  click) cmd_click "${2:?usage: $0 click <x> <y>}" "${3:?usage: $0 click <x> <y>}" ;;
  key) shift; cmd_key "$@" ;;
  type) cmd_type "${2:?usage: $0 type <text>}" ;;
  seed-localstorage) cmd_seed_localstorage ;;
  assert) cmd_assert ;;
  down) cmd_down ;;
  *) echo "usage: $0 preflight|up|launch [--fresh-model]|shot <name>|click <x> <y>|key <keys>|type <text>|seed-localstorage|assert|down"; exit 1 ;;
esac
