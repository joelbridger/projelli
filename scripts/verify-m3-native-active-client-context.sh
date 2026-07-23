#!/usr/bin/env bash
# Focused proof for native-only active-client context. The two links are the
# only temporary build helpers and are removed on every exit path.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_root="/home/jameson/lantern/app/integration"
piper_source="$source_root/src-tauri/binaries/piper-x86_64-unknown-linux-gnu"
llama_source="$source_root/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu"
piper_target="$repo_root/src-tauri/binaries/piper-x86_64-unknown-linux-gnu"
llama_target="$repo_root/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu"
piper_sha256="12672a94ca6716e5a8f335cfa68bf43bd9a33284960e3f9d16b85090bf7aab6b"
llama_sha256="64682459ee4095f62cf39002cd9429f1c1a911721564ef8c9598077cdf71fb77"

# Verify both canonical files before creating either link.
test "$(sha256sum "$piper_source" | awk '{print $1}')" = "$piper_sha256"
test "$(sha256sum "$llama_source" | awk '{print $1}')" = "$llama_sha256"

cleanup() {
  rm -f "$piper_target" "$llama_target"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

test ! -e "$piper_target" && test ! -L "$piper_target"
test ! -e "$llama_target" && test ! -L "$llama_target"
ln -s "$piper_source" "$piper_target"
ln -s "$llama_source" "$llama_target"

(cd "$repo_root/src-tauri" && cargo test --lib commands::crm::active_client_context::tests)
(cd "$repo_root" && npx vitest run src/platform/client-context/nativeActiveClientContext.test.ts src/platform/client-context/clientContextStore.test.ts)
