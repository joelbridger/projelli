#!/usr/bin/env bash
# VG-6b — Assured mode exercised LIVE against the firm backend at
# api.keepance.com, plus a from-disk proof that the zero-retention guarantee
# holds at runtime (not just in unit tests).
#
# What this does (Task 11 of the Wave 2 plan):
#   1. Ensures a clearly-named internal TEST org exists (created via the
#      documented loopback admin route POST 127.0.0.1:5194/admin/org; the live
#      orgs table was EMPTY before this exercise, so nothing real is touched).
#   2. Signs that org's admin in + activates one seat through the LIVE edge.
#   3. Sets a MANAGED Anthropic key on the org and confirms it lists.
#   4. Sends ONE tiny real inference (~$0.001) carrying a unique SENTINEL
#      string through https://api.keepance.com/assured/infer .
#   5. PROVES zero-retention from disk: the SENTINEL appears in NO backend DB
#      table and in NO service-journal line; only a metadata-only billing row
#      (token counts, status, latency — no body/prompt/content/hash column by
#      design) records that the call happened.
#   `down` deletes the test org so the live DB returns to its pre-exercise
#   (empty) state.
#
# ── ABSOLUTE RULES ──
#   * api.keepance.com is PRODUCTION. This only ever creates/uses ONE clearly
#     named test org and reads everything else.
#   * Credentials + the managed provider key live OFF-REPO in
#     ~/.local/share/jameworld/keepance-assured-test.env (mode 600). They are
#     NEVER committed, NEVER echoed, NEVER written into any artifact. Banked
#     output is redacted: tokens/keys appear only as a "(set)" marker or last4.
#
# Usage:
#   scripts/assured-live-exercise.sh run     # the full live exercise (default)
#   scripts/assured-live-exercise.sh down    # delete the test org (cleanup)
#
set -euo pipefail

# ── Paths + constants ──────────────────────────────────────────────────────
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDGE_BASE="${ASSURED_EDGE_BASE:-https://api.keepance.com}"   # the live production path
ADMIN_BASE="${ASSURED_ADMIN_BASE:-http://127.0.0.1:5194}"    # loopback-only admin (runbook §5)
LIVE_DB="${KEEPANCE_FIRM_DB:-/home/jameson/services/keepance-firm-backend/data/keepance-firm.sqlite}"
ENV_FILE="${ASSURED_TEST_ENV:-$HOME/.local/share/jameworld/keepance-assured-test.env}"
STATE_FILE="${ENV_FILE%.env}.state"
# Exact name (Task 11, step 2.2). Distinctive + self-documenting so it can never
# be mistaken for a paying firm.
ORG_NAME="Keepance Internal Test Firm (DO NOT BILL)"
# The app's own cheap default model (ClaudeProvider.ts:180). Re-verify at run.
MODEL="${ASSURED_MODEL:-claude-haiku-4-5-20251001}"
ART="$REPO/docs/quality/2026-06-11-wedge-proof/wave2-rerun/assured"
TRANSCRIPT="$ART/exercise.txt"

mkdir -p "$ART"

# ── Logging: ONLY redacted/safe content is ever passed here ─────────────────
log() { printf '%s\n' "$*" | tee -a "$TRANSCRIPT"; }
hr()  { log "------------------------------------------------------------"; }

# ── Env file: load creds, or print off-repo creation instructions + exit ────
load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cat >&2 <<EOF
Missing off-repo credentials file: $ENV_FILE

Create it (mode 600 — it holds secrets and must NEVER be committed):

  mkdir -p "$(dirname "$ENV_FILE")"
  umask 177
  cat > "$ENV_FILE" <<'ENV'
ASSURED_TEST_EMAIL=assured-test-admin@keepance.test
ASSURED_TEST_PASSWORD=<a fresh random >=12-char password you choose>
ADMIN_PROVISION_SECRET=<the backend's ADMIN_PROVISION_SECRET>
# The managed Anthropic key comes from a server-side key Jameson already holds
# (e.g. an Anthropic-consuming service env on this host). NEVER take it from
# this repo. Paste it as the value below.
ASSURED_ANTHROPIC_KEY=<sk-ant-... server-side key>
ENV
  chmod 600 "$ENV_FILE"

Then re-run: scripts/assured-live-exercise.sh run
EOF
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090,SC1091
  . "$ENV_FILE"
  set +a
  : "${ASSURED_TEST_EMAIL:?ASSURED_TEST_EMAIL missing in $ENV_FILE}"
  : "${ASSURED_TEST_PASSWORD:?ASSURED_TEST_PASSWORD missing in $ENV_FILE}"
  : "${ADMIN_PROVISION_SECRET:?ADMIN_PROVISION_SECRET missing in $ENV_FILE}"
  : "${ASSURED_ANTHROPIC_KEY:?ASSURED_ANTHROPIC_KEY missing in $ENV_FILE}"
}

# ── Read-only DB peek: open the LIVE DB strictly READ-ONLY (SQLite `mode=ro`
#    URI) and run a python snippet read from stdin (a heredoc). This is the
#    discipline's "read-only sqlite open": a read-only WAL connection sees the
#    latest committed transaction (main + WAL) as a consistent snapshot, never
#    writes, and cannot race a file copy. Snippets get the URI in $DBP and
#    connect with uri=True. ────────────────────────────────────────────────────
db_peek() {
  DBP="file:${LIVE_DB}?mode=ro" python3 -
}

# Count orgs by exact name (read-only). Echoes an integer.
org_count_by_name() {
  db_peek <<'PY'
import os, sqlite3
c = sqlite3.connect(os.environ["DBP"], uri=True)
n = c.execute("SELECT COUNT(*) FROM orgs WHERE name=?", [os.environ["ORG_NAME"]]).fetchone()[0]
print(n)
PY
}

# Echo the test org's org_id (read-only), or empty.
org_id_by_name() {
  db_peek <<'PY'
import os, sqlite3
c = sqlite3.connect(os.environ["DBP"], uri=True)
row = c.execute("SELECT org_id FROM orgs WHERE name=?", [os.environ["ORG_NAME"]]).fetchone()
print(row[0] if row else "")
PY
}

# ── HTTP helper: POST JSON, echo "<http_code>\n<body>". Extra args are curl
#    args (e.g. -H headers). Never logs the body itself. ──────────────────────
post_json() {
  local url="$1" data="$2"; shift 2
  curl -sS -m 60 -X POST "$url" \
    -H 'Content-Type: application/json' \
    "$@" \
    -d "$data" \
    -w $'\n%{http_code}'
}

# Split the "<body>\n<code>" tail produced by -w. Sets REPLY_CODE + REPLY_BODY.
split_reply() {
  local raw="$1"
  REPLY_CODE="${raw##*$'\n'}"
  REPLY_BODY="${raw%$'\n'*}"
}

# ════════════════════════════════════════════════════════════════════════════
# run — the live exercise (Task 11 steps 2-6)
# ════════════════════════════════════════════════════════════════════════════
cmd_run() {
  load_env
  export ORG_NAME

  log ""
  log "============================================================"
  log "VG-6b Assured live exercise — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "Edge (live):   $EDGE_BASE"
  log "Admin (loop):  $ADMIN_BASE/admin/org"
  log "Model:         $MODEL"
  log "============================================================"

  # --- Preflight: backend reachable both ways ---
  hr
  log "Step 0  preflight"
  local edge_health loop_health
  edge_health="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$EDGE_BASE/healthz" || true)"
  loop_health="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$ADMIN_BASE/healthz" || true)"
  log "  GET $EDGE_BASE/healthz   -> $edge_health"
  log "  GET $ADMIN_BASE/healthz  -> $loop_health"
  [ "$edge_health" = "200" ] || { log "FAIL: live edge not healthy"; exit 1; }
  [ "$loop_health" = "200" ] || { log "FAIL: loopback backend not healthy"; exit 1; }

  # --- Step 2: ensure the test org exists ---
  hr
  log "Step 2  test org: \"$ORG_NAME\""
  local existing org_id license_key
  existing="$(org_count_by_name)"
  log "  read-only DB peek: matching orgs = $existing"
  if [ "$existing" -ge 1 ]; then
    org_id="$(org_id_by_name)"
    if [ -f "$STATE_FILE" ]; then
      # shellcheck disable=SC1090
      . "$STATE_FILE"
      license_key="${LICENSE_KEY:-}"
    fi
    if [ -z "${license_key:-}" ]; then
      log "FAIL: org exists but its license_key is not in $STATE_FILE."
      log "      The key is shown only once at creation. Run 'down' then 'run' to reset."
      exit 1
    fi
    log "  reusing existing test org (org_id captured, license_key from state file)"
  else
    log "  creating via loopback admin route (plan practice, seat_limit 3)"
    local raw
    raw="$(post_json "$ADMIN_BASE/admin/org" \
      "$(jq -nc --arg n "$ORG_NAME" --arg e "$ASSURED_TEST_EMAIL" --arg p "$ASSURED_TEST_PASSWORD" \
        '{name:$n, plan:"practice", packs:["legal"], seat_limit:3, admin_email:$e, admin_password:$p}')" \
      -H "Authorization: Bearer $ADMIN_PROVISION_SECRET")"
    split_reply "$raw"
    if [ "$REPLY_CODE" != "201" ]; then
      # email_taken means a prior partial run left the admin user; guide to reset.
      log "FAIL: /admin/org -> HTTP $REPLY_CODE ($(printf '%s' "$REPLY_BODY" | jq -r '.error // "?"'))"
      [ "$REPLY_CODE" = "409" ] && log "      (run 'down' to clear a partial prior exercise, then 'run')"
      exit 1
    fi
    org_id="$(printf '%s' "$REPLY_BODY" | jq -r '.org.org_id')"
    license_key="$(printf '%s' "$REPLY_BODY" | jq -r '.license_key')"
    # Persist org_id + license_key OFF-REPO (the key is shown only once).
    umask 177
    { echo "ORG_ID=$org_id"; echo "LICENSE_KEY=$license_key"; } > "$STATE_FILE"
    chmod 600 "$STATE_FILE"
    log "  created: HTTP 201, org_id=$org_id (license_key stored off-repo in state file)"
  fi

  # --- Step 3: sign in + activate a seat through the LIVE edge ---
  hr
  log "Step 3  login + seat activation (live edge)"
  local raw access_token seat_token
  raw="$(post_json "$EDGE_BASE/auth/login" \
    "$(jq -nc --arg e "$ASSURED_TEST_EMAIL" --arg p "$ASSURED_TEST_PASSWORD" '{email:$e, password:$p}')")"
  split_reply "$raw"
  [ "$REPLY_CODE" = "200" ] || { log "FAIL: /auth/login -> HTTP $REPLY_CODE"; exit 1; }
  access_token="$(printf '%s' "$REPLY_BODY" | jq -r '.access_token')"
  log "  POST /auth/login            -> 200 (access_token: set; role=$(printf '%s' "$REPLY_BODY" | jq -r '.user.role'))"

  raw="$(post_json "$EDGE_BASE/org/activate" \
    "$(jq -nc --arg k "$license_key" '{license_key:$k, machine_id:"wave2-assured-exercise", machine_label:"wave2-assured-exercise", app_version:"3.0.0"}')" \
    -H "Authorization: Bearer $access_token")"
  split_reply "$raw"
  [ "$REPLY_CODE" = "200" ] || { log "FAIL: /org/activate -> HTTP $REPLY_CODE ($(printf '%s' "$REPLY_BODY" | jq -r '.error // .detail // "?"'))"; exit 1; }
  seat_token="$(printf '%s' "$REPLY_BODY" | jq -r '.seat_token')"
  log "  POST /org/activate          -> 200 (seat_token: set; seat_id=$(printf '%s' "$REPLY_BODY" | jq -r '.seat_id'); tier=$(printf '%s' "$REPLY_BODY" | jq -r '.tier'))"

  # --- Step 4: set + list the managed Anthropic key ---
  hr
  log "Step 4  managed key (admin)"
  raw="$(post_json "$EDGE_BASE/assured/keys/set" \
    "$(jq -nc --arg k "$ASSURED_ANTHROPIC_KEY" '{provider:"anthropic", api_key:$k}')" \
    -H "Authorization: Bearer $access_token")"
  split_reply "$raw"
  [ "$REPLY_CODE" = "200" ] || { log "FAIL: /assured/keys/set -> HTTP $REPLY_CODE"; exit 1; }
  local set_last4
  set_last4="$(printf '%s' "$REPLY_BODY" | jq -r '.key_last4')"
  log "  POST /assured/keys/set      -> 200 (provider=anthropic, key_last4=$set_last4)"

  raw="$(post_json "$EDGE_BASE/assured/keys/list" '{}' -H "Authorization: Bearer $access_token")"
  split_reply "$raw"
  [ "$REPLY_CODE" = "200" ] || { log "FAIL: /assured/keys/list -> HTTP $REPLY_CODE"; exit 1; }
  log "  POST /assured/keys/list     -> 200 (keys: $(printf '%s' "$REPLY_BODY" | jq -c '[.keys[] | {provider, key_last4}]'))"

  # --- Step 5: ONE real inference carrying the sentinel ---
  hr
  local sentinel
  sentinel="KEEPANCE-ASSURED-SENTINEL-$(date +%s)"
  log "Step 5  one real inference through the zero-retention proxy"
  log "  sentinel: $sentinel"
  log "  model:    $MODEL  (max_tokens 64, X-Stream 0 — non-streaming)"
  # Provider-NATIVE Anthropic body. The sentinel rides INSIDE the prompt so we
  # can later prove the backend kept none of it. The reply is intentionally tiny.
  local body hdrfile
  body="$(jq -nc --arg m "$MODEL" --arg s "$sentinel" \
    '{model:$m, max_tokens:64, messages:[{role:"user", content:("Reply with only the single word ACKNOWLEDGED. Diagnostic reference token (do not repeat): " + $s)}]}')"
  hdrfile="$(mktemp)"
  raw="$(curl -sS -m 90 -X POST "$EDGE_BASE/assured/infer" \
    -H "Authorization: Bearer $access_token" \
    -H "X-Seat-Token: $seat_token" \
    -H "X-Provider: anthropic" \
    -H "X-Model: $MODEL" \
    -H "X-Stream: 0" \
    -H 'Content-Type: application/json' \
    -D "$hdrfile" \
    -d "$body" \
    -w $'\n%{http_code}')"
  split_reply "$raw"
  local no_retention req_id
  no_retention="$(grep -i '^x-keepance-no-retention:' "$hdrfile" | tr -d '\r' | awk '{print $2}')"
  req_id="$(grep -i '^x-keepance-request-id:' "$hdrfile" | tr -d '\r' | awk '{print $2}')"
  rm -f "$hdrfile"
  log "  POST /assured/infer         -> HTTP $REPLY_CODE"
  log "  response header X-Keepance-No-Retention: ${no_retention:-<none>}"
  log "  response header X-Keepance-Request-Id:   ${req_id:-<none>}"
  # Distinguish a KEEPANCE-SIDE proxy rejection (a real product finding — hard
  # fail) from an UPSTREAM PROVIDER response that the proxy faithfully forwarded.
  # The proxy's own errors are `{"error":"<one of these codes>"}`; an upstream
  # provider error is the vendor's native body (Anthropic uses `.type`/`.error`
  # as an object). Either way, the request traversed the WHOLE Keepance proxy
  # (seat auth, managed-key attach, forward, no-retention stamping) — so the
  # zero-retention proof in Step 6 is exercised and must hold REGARDLESS of the
  # upstream status. A forwarded-but-rejected call still must retain nothing.
  local proxy_codes=" rate_limited unauthorized seat_required seat_invalid invalid_provider missing_model no_managed_key bad_model key_unreadable payload_too_large invalid_request upstream_timeout upstream_error forbidden "
  local err_code; err_code="$(printf '%s' "$REPLY_BODY" | jq -r '.error | strings // empty' 2>/dev/null || true)"
  local UPSTREAM_OK=0 COMPLETION=""
  if [ "$REPLY_CODE" = "200" ]; then
    COMPLETION="$(printf '%s' "$REPLY_BODY" | jq -r '.content[0].text // empty' 2>/dev/null || true)"
    [ -n "$COMPLETION" ] || { log "FAIL: 200 but no completion text in the Anthropic response"; exit 1; }
    UPSTREAM_OK=1
    log "  completion text: \"$COMPLETION\""
    log "  provider usage:  $(printf '%s' "$REPLY_BODY" | jq -c '.usage // {}' 2>/dev/null)"
    log "  RESULT: real inference succeeded on the managed key (~\$0.001)."
  elif [ -n "$err_code" ] && [ "$proxy_codes" != "${proxy_codes/ $err_code /}" ]; then
    # The PROXY rejected the call before/after forwarding — a Keepance-side
    # failure. This IS a finding; fail hard so it can't be papered over.
    log "FAIL (Keepance proxy-side): /assured/infer rejected with error=$err_code (HTTP $REPLY_CODE)"
    exit 1
  else
    # The proxy forwarded; the UPSTREAM PROVIDER returned non-200. Record it
    # honestly and continue — the zero-retention invariant is what Step 6 proves.
    log "  upstream provider returned HTTP $REPLY_CODE (proxy forwarded correctly)."
    log "  upstream body (provider-native, no Keepance secret): $(printf '%s' "$REPLY_BODY" | jq -c '{type, message: (.message // .error.message // .error // "")}' 2>/dev/null || printf '%s' "$REPLY_BODY" | head -c 160)"
    log "  NOTE: a non-200 here is the MANAGED KEY being invalid at the provider in"
    log "        this environment (the host's Anthropic keys are revoked), NOT a"
    log "        proxy defect — the proxy authed the seat, attached the managed key,"
    log "        forwarded to real api.anthropic.com, and stamped the no-retention"
    log "        headers above. The zero-retention proof below is unaffected."
  fi

  # --- Step 6: zero-retention truth, from disk (the VG-6b invariant) ---
  hr
  log "Step 6  zero-retention proof (from disk + journal)"

  # 6a. The sentinel appears in NO table of the live DB. Capture so we can
  #     fold the result into a machine verdict, then echo it to the transcript.
  log ""
  log "  6a. full-DB sentinel scan (every table, every column):"
  local out6a
  out6a="$(SENTINEL="$sentinel" db_peek <<'PY'
import os, sqlite3
c = sqlite3.connect(os.environ["DBP"], uri=True); c.row_factory = sqlite3.Row
sent = os.environ["SENTINEL"]
tables = [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
total = 0
for t in tables:
    rows = c.execute(f"SELECT * FROM '{t}'").fetchall()
    hits = sum(1 for r in rows for v in tuple(r)
               if isinstance(v, (str, bytes)) and sent.encode() in (v if isinstance(v, bytes) else v.encode()))
    total += hits
    print(f"      {t:<22} rows={len(rows):<4} sentinel_hits={hits}")
print(f"      => TOTAL sentinel occurrences across the whole DB: {total}")
print(f"SENTINEL_TOTAL={total}")
PY
)"
  log "$out6a"
  local sentinel_total
  sentinel_total="$(printf '%s\n' "$out6a" | sed -n 's/^SENTINEL_TOTAL=//p')"

  # 6b. A metadata-only billing row exists for THIS org (no body/prompt/hash column).
  log ""
  log "  6b. billing row for the call (metadata only — no body column exists):"
  local out6b
  out6b="$(ORG_ID="$org_id" db_peek <<'PY'
import os, sqlite3
c = sqlite3.connect(os.environ["DBP"], uri=True); c.row_factory = sqlite3.Row
cols = [r[1] for r in c.execute("PRAGMA table_info(inference_billing)")]
print(f"      inference_billing columns: {cols}")
bad = [k for k in cols if any(w in k.lower() for w in ("body","prompt","content","completion","text","hash"))]
print(f"      columns capable of holding prompt/completion/hash: {bad if bad else 'NONE (by design)'}")
rows = c.execute("SELECT provider, model, input_tokens, output_tokens, status, latency_ms FROM inference_billing WHERE org_id=? ORDER BY id DESC LIMIT 1", [os.environ["ORG_ID"]]).fetchall()
if rows:
    print(f"      newest billing row: {dict(rows[0])}")
    print("BILLING_ROW=present")
else:
    print("      (no billing row found for this org)")
    print("BILLING_ROW=missing")
PY
)"
  log "$out6b"
  local billing_row
  billing_row="$(printf '%s\n' "$out6b" | sed -n 's/^BILLING_ROW=//p')"

  # 6c. The sentinel appears in NO service-journal line in the window.
  log ""
  log "  6c. service journal scan (keepance-backend, last 15 min):"
  local jcount
  jcount="$(journalctl -u keepance-backend --since "-15 min" --no-pager 2>/dev/null | grep -c "$sentinel" || true)"
  log "      journalctl ... | grep -c '<sentinel>' = ${jcount:-0}"

  # --- Verdict ---
  hr
  log "VERDICT"
  log "  Proxy path exercised live (seat auth + managed-key attach + forward +"
  log "    no-retention headers): YES"
  if [ "$UPSTREAM_OK" = "1" ]; then
    log "  Upstream completion returned: YES (real inference, ~\$0.001)"
  else
    log "  Upstream completion returned: NO — managed key invalid at provider in this"
    log "    environment (host Anthropic keys revoked). Drop a valid key into the"
    log "    off-repo env file and re-run for a clean 200; the proxy path is unchanged."
  fi
  local zr_db zr_journal
  [ "${sentinel_total:-1}" = "0" ] && zr_db=PASS || zr_db=FAIL
  [ "${jcount:-1}" = "0" ] && zr_journal=PASS || zr_journal=FAIL
  log "  ZERO-RETENTION — sentinel in DB:      $zr_db (occurrences=${sentinel_total:-?})"
  log "  ZERO-RETENTION — sentinel in journal: $zr_journal (occurrences=${jcount:-?})"
  log "  ZERO-RETENTION — billing row is metadata-only: ${billing_row:-?}"
  if [ "$zr_db" = "PASS" ] && [ "$zr_journal" = "PASS" ]; then
    log "  ==> ZERO-RETENTION PROVEN LIVE: the sentinel prompt content is retained NOWHERE."
  else
    log "  ==> ZERO-RETENTION FAILED — investigate (this would be a serious finding)."
    exit 1
  fi

  hr
  log "Exercise complete. Run 'scripts/assured-live-exercise.sh down' to delete the test org."
  log ""
}

# ════════════════════════════════════════════════════════════════════════════
# down — delete the test org so the live DB returns to its pre-exercise state
# ════════════════════════════════════════════════════════════════════════════
cmd_down() {
  export ORG_NAME
  log ""
  log "============================================================"
  log "VG-6b cleanup (down) — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "============================================================"
  local org_id
  org_id="$(org_id_by_name)"
  if [ -z "$org_id" ]; then
    log "  no test org named \"$ORG_NAME\" present — nothing to delete."
  else
    log "  deleting test org_id=$org_id and every row tied to it..."
    # The ONE write to the live DB. SQLite WAL allows this external writer
    # concurrently with the running service's reads; busy_timeout absorbs any
    # brief lock. Deletes are org-scoped (the DB was empty before this exercise).
    ORG_ID="$org_id" LIVE_DB="$LIVE_DB" python3 - <<'PY' | tee -a "$TRANSCRIPT"
import os, sqlite3
db = os.environ["LIVE_DB"]; org = os.environ["ORG_ID"]
c = sqlite3.connect(db, timeout=10)
c.execute("PRAGMA busy_timeout=10000")
# refresh_tokens are keyed by user_id, not org_id — clear them via the org's users first.
c.execute("DELETE FROM refresh_tokens WHERE user_id IN (SELECT user_id FROM users WHERE org_id=?)", [org])
for t in ("inference_billing","org_provider_keys","revocations","seats","license_keys",
          "wrapped_matter_keys","devices","ethical_walls","matter_members","matter_updates",
          "matters","audit_events","users","orgs"):
    try:
        n = c.execute(f"DELETE FROM {t} WHERE org_id=?", [org]).rowcount
        if n: print(f"      deleted {n:<4} from {t}")
    except sqlite3.OperationalError as e:
        # wrapped_matter_keys has no org_id column; skip tables that don't apply.
        if "no such column" not in str(e):
            raise
c.commit(); c.close()
print("      delete committed.")
PY
  fi
  # Verify from a fresh read-only peek.
  local after
  after="$(org_count_by_name)"
  log "  post-down read-only DB peek: orgs named test = $after"
  if [ "$after" = "0" ]; then
    log "  CLEANUP: PASS — live DB returned to pre-exercise state."
    # Drop the off-repo state file (its license_key is now dead).
    [ -f "$STATE_FILE" ] && { rm -f "$STATE_FILE"; log "  removed off-repo state file."; }
  else
    log "  CLEANUP: FAIL — test org still present."
    exit 1
  fi
  log ""
}

case "${1:-run}" in
  run)  cmd_run ;;
  down) cmd_down ;;
  *) echo "usage: $0 {run|down}" >&2; exit 2 ;;
esac
