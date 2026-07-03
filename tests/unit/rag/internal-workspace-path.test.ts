/**
 * fix/ask-list-hang — the RAG watcher path must never re-index the app's own
 * internal `.lantern/` files. The MCP session-scope heartbeat rewrites
 * `.lantern/mcp-session-scope.json` constantly; indexing that churn kept
 * LanceDB perpetually busy and starved Ask retrieval into an indefinite hang.
 */
import { describe, it, expect } from 'vitest';
import { isInternalWorkspacePath } from '@/platform/hooks/useMemoryWiring';
import { WORKSPACE_DATA_DIR, MCP_SESSION_SCOPE_REL_PATH } from '@/config/identity';

describe('isInternalWorkspacePath', () => {
  it('flags the MCP session-scope file (the churn that caused the hang)', () => {
    expect(isInternalWorkspacePath(`/ws/${MCP_SESSION_SCOPE_REL_PATH}`)).toBe(true);
    // The atomic writer's temp files churn the fastest.
    expect(
      isInternalWorkspacePath(`/ws/${MCP_SESSION_SCOPE_REL_PATH}.tmp-123-abc`),
    ).toBe(true);
  });

  it('flags any file inside the internal data dir, on both path separators', () => {
    expect(isInternalWorkspacePath(`/ws/${WORKSPACE_DATA_DIR}/vectors/data.lance`)).toBe(true);
    expect(
      isInternalWorkspacePath(`C:\\Users\\me\\ws\\${WORKSPACE_DATA_DIR}\\rag-manifest-v1.json`),
    ).toBe(true);
  });

  it('does NOT flag real user documents (including a lookalike name)', () => {
    expect(isInternalWorkspacePath('/ws/Clients/Webb/Agreements/plan.docx')).toBe(false);
    expect(isInternalWorkspacePath('/ws/Clients/Koch/statement.pdf')).toBe(false);
    // A segment must equal WORKSPACE_DATA_DIR — a filename that merely contains
    // it (e.g. "my.lantern.notes.txt") is a real doc and stays indexable.
    expect(isInternalWorkspacePath('/ws/Clients/my.lantern.notes.txt')).toBe(false);
  });
});
