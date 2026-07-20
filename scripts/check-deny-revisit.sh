#!/usr/bin/env bash
# scripts/check-deny-revisit.sh — makes every cargo-deny advisory suppression
# carry an OWNER and a REVISIT date, and fails once a REVISIT date has passed.
#
# WHY THIS EXISTS
#   `cargo deny check advisories` was RED and UNREAD for ~3 months on
#   RUSTSEC-2026-0002 (lru 0.12.5). A suppression with no owner and no expiry is
#   how that happens again with a tidier face: the red becomes invisible and
#   nobody is accountable for it.
#   cargo-deny 0.19's ignore entry accepts ONLY the keys ["id", "reason"] —
#   adding an `expires` key fails with:
#       error[unexpected-keys]: found 1 unexpected keys, expected: ["id", "reason"]
#   so the expiry cannot be a schema field. It is carried inside the `reason`
#   string (which cargo-deny itself prints at `-L info`, under
#   `note[advisory-ignored] ... ignore reason`) and enforced here.
#
# RULES ENFORCED, per entry in [advisories].ignore of src-tauri/deny.toml:
#   1. a non-empty `reason`
#   2. the literal `OWNER:` followed by a name
#   3. the literal `REVISIT: YYYY-MM-DD`
#   4. that REVISIT date is today or later
#
# FAIL-CLOSED, on purpose. This script never "skips". If it cannot parse
# deny.toml, cannot find the ignore array, or has no TOML parser, it EXITS
# NONZERO. An unreadable policy file is not a clean policy file.
#
# 🔴 THE BOUND ON THIS CHECKER'S GREEN — read before trusting it.
#   It proves the fields are PRESENT AND PARSEABLE. It does NOT prove the
#   justification is MEANINGFUL, correct, or still true. Its green must never
#   be read as "the reason is good".
#   This is not a hypothetical bound; it has already been defeated once. Its
#   own author's first patch produced the reason text
#       "...past rustls 0.21 OWNER: Lantern maintainer..."
#   — a run-on with no sentence break — and this checker PASSED it, because it
#   only regex-matches `OWNER:`. A checker's SHAPE decides what it can see, and
#   this one cannot see a defect in the prose it validates. Likewise it cannot
#   tell a re-reviewed REVISIT date from one someone simply pushed 90 days out.
#   Only a human reading the reason can do either. This checker's job is
#   narrower and worth stating exactly: it guarantees there IS an owner and
#   there IS a live date, so a suppression can never again be anonymous and
#   permanent.
#
# WHERE IT MUST BE WIRED
#   scripts/gate.sh — the canonical pre-merge decision surface, alongside the
#   `cargo deny` step it enforces. It was originally wired ONLY into
#   scripts/gate-ci-parity.sh, which is exactly the runner its own headline
#   proved is OUTSIDE the merge decision surface — so the fail-closed expiry
#   would have fired in a script the merge never invokes. Enforcement must live
#   on the same surface as the gate it enforces.
#
#   ./scripts/check-deny-revisit.sh              # check the repo's deny.toml
#   ./scripts/check-deny-revisit.sh --self-test  # prove the checker can go RED
set -uo pipefail
cd "$(dirname "$0")/.."

DENY_TOML="${DENY_TOML:-src-tauri/deny.toml}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ check-deny-revisit: python3 not on PATH — cannot parse deny.toml. FAILING CLOSED." >&2
  exit 2
fi

run_check () {
  python3 - "$1" <<'PY'
import sys, datetime, re
try:
    import tomllib
except ModuleNotFoundError:
    print("check-deny-revisit: python3 has no tomllib (needs 3.11+). FAILING CLOSED.", file=sys.stderr)
    sys.exit(2)

path = sys.argv[1]
try:
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
except FileNotFoundError:
    print(f"check-deny-revisit: {path} not found. FAILING CLOSED.", file=sys.stderr)
    sys.exit(2)
except tomllib.TOMLDecodeError as e:
    print(f"check-deny-revisit: {path} is not valid TOML ({e}). FAILING CLOSED.", file=sys.stderr)
    sys.exit(2)

advisories = cfg.get("advisories")
if advisories is None:
    print(f"check-deny-revisit: {path} has no [advisories] table. FAILING CLOSED.", file=sys.stderr)
    sys.exit(2)
if "ignore" not in advisories:
    print(f"check-deny-revisit: {path} [advisories] has no `ignore` key. FAILING CLOSED "
          "(an ignore list that has been renamed or removed is not an empty one).", file=sys.stderr)
    sys.exit(2)

entries = advisories["ignore"]
today = datetime.date.today()
problems = []
checked = 0

for i, e in enumerate(entries):
    checked += 1
    if isinstance(e, str):
        problems.append(f"entry #{i+1} `{e}` is a BARE id with no reason, owner or revisit date")
        continue
    if not isinstance(e, dict):
        problems.append(f"entry #{i+1} has an unrecognised shape {type(e).__name__}")
        continue
    ident = e.get("id", f"<no id, entry #{i+1}>")
    reason = (e.get("reason") or "").strip()
    if not reason:
        problems.append(f"{ident}: no reason")
        continue
    if not re.search(r"OWNER:\s*\S", reason):
        problems.append(f"{ident}: reason has no `OWNER: <name>`")
    m = re.search(r"REVISIT:\s*(\d{4}-\d{2}-\d{2})", reason)
    if not m:
        problems.append(f"{ident}: reason has no `REVISIT: YYYY-MM-DD`")
        continue
    try:
        due = datetime.date.fromisoformat(m.group(1))
    except ValueError:
        problems.append(f"{ident}: REVISIT date `{m.group(1)}` is not a real date")
        continue
    if due < today:
        problems.append(
            f"{ident}: REVISIT date {due.isoformat()} has PASSED (today {today.isoformat()}) — "
            "re-review this suppression or move the date with a written reason")

print(f"check-deny-revisit: {path} — {checked} ignore entr{'y' if checked==1 else 'ies'} checked, "
      f"{len(problems)} problem{'' if len(problems)==1 else 's'}")
for p in problems:
    print(f"  ❌ {p}")
sys.exit(1 if problems else 0)
PY
}

self_test () {
  local tmp rc fails=0
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  expect () { # expect <label> <expected-rc> <file>
    local label="$1" want="$2" file="$3" out
    out="$(run_check "$file" 2>&1)"; rc=$?
    if [ "$rc" -eq "$want" ]; then
      echo "  ✅ $label -> exit $rc (expected $want)"
      echo "$out" | sed 's/^/       /'
    else
      echo "  ❌ $label -> exit $rc (EXPECTED $want)"
      echo "$out" | sed 's/^/       /'
      fails=1
    fi
  }

  local future past
  future="$(python3 -c 'import datetime;print(datetime.date.today()+datetime.timedelta(days=30))')"
  past="$(python3 -c 'import datetime;print(datetime.date.today()-datetime.timedelta(days=1))')"

  printf '[advisories]\nignore = [\n  { id = "R-1", reason = "fine. OWNER: A Person. REVISIT: %s" },\n]\n' "$future" > "$tmp/good.toml"
  printf '[advisories]\nignore = [\n  { id = "R-1", reason = "fine. REVISIT: %s" },\n]\n' "$future" > "$tmp/no-owner.toml"
  printf '[advisories]\nignore = [\n  { id = "R-1", reason = "fine. OWNER: A Person." },\n]\n' > "$tmp/no-date.toml"
  printf '[advisories]\nignore = [\n  { id = "R-1", reason = "fine. OWNER: A Person. REVISIT: %s" },\n]\n' "$past" > "$tmp/expired.toml"
  printf '[advisories]\nignore = [\n  "R-1",\n]\n' > "$tmp/bare.toml"
  printf '[advisories]\nyanked = "deny"\n' > "$tmp/no-ignore-key.toml"
  printf '[licenses]\nallow = ["MIT"]\n' > "$tmp/no-advisories.toml"
  printf 'this is not toml [[[\n' > "$tmp/broken.toml"
  printf '[advisories]\nignore = []\n' > "$tmp/empty.toml"

  echo "=== check-deny-revisit self-test ==="
  expect "well-formed entry"                 0 "$tmp/good.toml"
  expect "empty ignore list"                 0 "$tmp/empty.toml"
  expect "missing OWNER"                     1 "$tmp/no-owner.toml"
  expect "missing REVISIT"                   1 "$tmp/no-date.toml"
  expect "REVISIT date already passed"       1 "$tmp/expired.toml"
  expect "bare string id (no reason)"        1 "$tmp/bare.toml"
  expect "no ignore key at all"              2 "$tmp/no-ignore-key.toml"
  expect "no [advisories] table"             2 "$tmp/no-advisories.toml"
  expect "unparseable TOML"                  2 "$tmp/broken.toml"
  expect "file does not exist"               2 "$tmp/nope.toml"
  if [ "$fails" -eq 0 ]; then
    echo "✅ check-deny-revisit SELF-TEST GREEN (10/10)"
    return 0
  fi
  echo "❌ check-deny-revisit SELF-TEST RED"
  return 1
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

run_check "$DENY_TOML"
exit $?
