#!/usr/bin/env bash
# Focused proof for Foundation C. It links only accepted shared dependencies,
# captures exactly one Rust-produced record, and removes every temporary link.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_root="/home/jameson/lantern/app/integration"
node_modules_source="$source_root/node_modules"
node_modules_target="$repo_root/node_modules"
piper_source="$source_root/src-tauri/binaries/piper-x86_64-unknown-linux-gnu"
llama_source="$source_root/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu"
piper_target="$repo_root/src-tauri/binaries/piper-x86_64-unknown-linux-gnu"
llama_target="$repo_root/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu"
package_sha256="192f9b6e8237344fe730d4dcf058759bd3b0457664501f3fa1f0b351f380e012"
package_lock_sha256="ce074d4be9d8fa7bd1ae9454692d74e7376fbf819a6f9b9d1e473dbb1f38c4ae"
piper_sha256="12672a94ca6716e5a8f335cfa68bf43bd9a33284960e3f9d16b85090bf7aab6b"
llama_sha256="64682459ee4095f62cf39002cd9429f1c1a911721564ef8c9598077cdf71fb77"
rust_output="$(mktemp)"
generated_json="$(mktemp)"

remove_exact_link() {
  local link="$1" source="$2"
  if test -L "$link"; then test "$(readlink "$link")" = "$source"; rm "$link"; else test ! -e "$link"; fi
}
cleanup() {
  remove_exact_link "$node_modules_target" "$node_modules_source"
  remove_exact_link "$piper_target" "$piper_source"
  remove_exact_link "$llama_target" "$llama_source"
  rm -f "$rust_output" "$generated_json"
}
trap cleanup EXIT

test ! -e "$node_modules_target" && test ! -L "$node_modules_target"
test ! -e "$piper_target" && test ! -L "$piper_target"
test ! -e "$llama_target" && test ! -L "$llama_target"
test "$(sha256sum "$repo_root/package.json" | awk '{print $1}')" = "$package_sha256"
test "$(sha256sum "$repo_root/package-lock.json" | awk '{print $1}')" = "$package_lock_sha256"
test -d "$node_modules_source" && test ! -L "$node_modules_source"
test "$(sha256sum "$piper_source" | awk '{print $1}')" = "$piper_sha256"
test "$(sha256sum "$llama_source" | awk '{print $1}')" = "$llama_sha256"
ln -s "$node_modules_source" "$node_modules_target"
ln -s "$piper_source" "$piper_target"
ln -s "$llama_source" "$llama_target"

# The lane permits one Cargo operation. This executes real SQLCipher tests.
(cd "$repo_root/src-tauri" && cargo test --lib commands::crm::features::local_task::commands::tests -- --nocapture) 2>&1 | tee "$rust_output"
sentinel_count="$(grep -c '^FOUNDATION_C_RUST_TASK_JSON:' "$rust_output" || true)"
test "$sentinel_count" = 1
sed -n 's/^FOUNDATION_C_RUST_TASK_JSON://p' "$rust_output" > "$generated_json"
test -s "$generated_json"

python3 -B - "$repo_root" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
native = (root / 'src-tauri/src/commands/crm/features/local_task/commands.rs').read_text()
context = (root / 'src-tauri/src/commands/crm/active_client_context.rs').read_text()
transport = (root / 'src/platform/crm/localMeetingTaskTransport.ts').read_text()
assert 'hold_active_client_lease_through_transaction' in native
assert 'ActiveClientLeaseExecutionGuard' in context
assert 'with_immediate_transaction' in native
assert 'INSERT INTO crm_docs' in native and 'fail_after_task_insert' in native
assert 'local_task_delivery_receipts' in native and 'local_task_record' in native
assert 'artifactId' in transport and 'proposalRevision' in transport
for forbidden in ('commands::mail', 'commands::provider', 'reqwest', 'http://', 'https://'):
    assert forbidden not in native
PY

(cd "$repo_root" && FOUNDATION_C_RUST_TASK_JSON_PATH="$generated_json" npx vitest run src/platform/crm/localMeetingTaskTransport.test.ts src/features/crm-tasks/testing/roundTripTaskRecord.test.tsx)
cleanup
trap - EXIT
test ! -e "$node_modules_target" && test ! -L "$node_modules_target"
test ! -e "$piper_target" && test ! -L "$piper_target"
test ! -e "$llama_target" && test ! -L "$llama_target"
