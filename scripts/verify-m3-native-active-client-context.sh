#!/usr/bin/env bash
# Focused proof for native-only active-client context. The three links below
# are the only temporary build helpers and are removed on every exit path.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_root="/home/jameson/lantern/app/integration"
node_modules_source="$source_root/node_modules"
node_modules_target="$repo_root/node_modules"
piper_source="$source_root/src-tauri/binaries/piper-x86_64-unknown-linux-gnu"
llama_source="$source_root/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu"
piper_target="$repo_root/src-tauri/binaries/piper-x86_64-unknown-linux-gnu"
llama_target="$repo_root/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu"
piper_sha256="12672a94ca6716e5a8f335cfa68bf43bd9a33284960e3f9d16b85090bf7aab6b"
llama_sha256="64682459ee4095f62cf39002cd9429f1c1a911721564ef8c9598077cdf71fb77"
package_sha256="192f9b6e8237344fe730d4dcf058759bd3b0457664501f3fa1f0b351f380e012"
package_lock_sha256="ce074d4be9d8fa7bd1ae9454692d74e7376fbf819a6f9b9d1e473dbb1f38c4ae"

remove_exact_link() {
  local link="$1"
  local source="$2"
  if test -L "$link"; then
    test "$(readlink "$link")" = "$source"
    rm "$link"
  else
    test ! -e "$link"
  fi
}

cleanup() {
  remove_exact_link "$node_modules_target" "$node_modules_source"
  remove_exact_link "$piper_target" "$piper_source"
  remove_exact_link "$llama_target" "$llama_source"
}

# Cleanup is armed before any target link is created.
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Refuse every existing target, including a link to an unexpected location.
test ! -e "$node_modules_target" && test ! -L "$node_modules_target"
test ! -e "$piper_target" && test ! -L "$piper_target"
test ! -e "$llama_target" && test ! -L "$llama_target"

# Before npm/npx use, require the exact worktree lockfiles and a real canonical
# dependency directory; only then stage the one exact node_modules symlink.
test "$(sha256sum "$repo_root/package.json" | awk '{print $1}')" = "$package_sha256"
test "$(sha256sum "$repo_root/package-lock.json" | awk '{print $1}')" = "$package_lock_sha256"
test -d "$node_modules_source" && test ! -L "$node_modules_source"

# Verify both canonical Rust helpers before creating either link.
test "$(sha256sum "$piper_source" | awk '{print $1}')" = "$piper_sha256"
test "$(sha256sum "$llama_source" | awk '{print $1}')" = "$llama_sha256"

ln -s "$node_modules_source" "$node_modules_target"
ln -s "$piper_source" "$piper_target"
ln -s "$llama_source" "$llama_target"

(cd "$repo_root/src-tauri" && cargo test --lib commands::crm::active_client_context::tests)

python3 -B - "$repo_root" <<'PY'
from pathlib import Path
import sys

source = (Path(sys.argv[1]) / "src-tauri/src/commands/crm/active_client_context.rs").read_text()
lease = source[source.index("pub(crate) struct ActiveClientLease"):source.index("impl ActiveClientContextState")]
helper = source[source.index("pub(crate) async fn capture_active_client_lease_for"):source.index("pub(crate) async fn require_active_client_lease")]

assert "pub(crate) async fn capture_active_client_lease_for(\n    state: &CrmState,\n    household_id: &str,\n    matter_id: &str,\n) -> Result<ActiveClientLease, String>" in helper
assert "Serialize" not in lease
assert "impl ActiveClientLease" not in lease
assert "household_id(&self" not in lease
assert "matter_id(&self" not in lease
assert "#[tauri::command]" not in helper
assert "State<'" not in helper
assert "ActiveClientContextReceipt" not in helper
assert "pub async" not in helper
PY

(cd "$repo_root" && npx vitest run src/platform/client-context/nativeActiveClientContext.test.ts src/platform/client-context/clientContextStore.test.ts)

# Verify and remove only the exact three links this verifier created, then
# prove every temporary helper is absent before it returns successfully.
cleanup
trap - EXIT
test ! -e "$node_modules_target" && test ! -L "$node_modules_target"
test ! -e "$piper_target" && test ! -L "$piper_target"
test ! -e "$llama_target" && test ! -L "$llama_target"
