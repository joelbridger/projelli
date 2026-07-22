/**
 * QA-44 (P0 privilege/isolation) — retrieval fail-closed regression tests.
 *
 * The bug: when a source is marked privileged (or a folder is re-scoped to a
 * different client) the re-tag of its already-indexed chunks can fail, and the
 * failure used to be swallowed. The index then keeps the OLD tag, so the
 * backend's `includePrivileged=false` filter still returns the source in normal
 * Ask — a silent privilege leak — or returns a file under the WRONG client.
 *
 * The durable fix makes retrieval fail CLOSED regardless of whether the re-tag
 * ever succeeded:
 *   - Privilege: `retrieve()` re-checks every hit against the LIVE privilege
 *     store (the persisted source of truth) and drops any privileged source on
 *     the default (non-privileged) path — even if its index tag is a stale
 *     'none'. Defense in depth: privilege no longer depends on tag freshness.
 *   - Matter/client: while a folder's re-tag is pending or failed, its files
 *     are excluded from retrieval via an injected exclusion predicate, so stale
 *     content can never surface under the wrong client until the re-tag lands.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryService,
  resetPrivilegeResolver,
  resetMeetingFileVisibilityResolver,
  resetRetrievalBackend,
  resetRetrievalHitExclusion,
  resetSourceIdForms,
  setPrivilegeResolver,
  setMeetingFileVisibilityResolver,
  setRetrievalBackend,
  setRetrievalHitExclusion,
  setSourceIdForms,
} from '@/platform/rag/MemoryService';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';

function hit(sourceId: string, privilege: RagHit['privilege'] = 'none'): RagHit {
  return {
    path: sourceId,
    sourceId,
    chunkText: `text of ${sourceId}`,
    score: 0.9,
    paragraphIndex: 0,
    matterId: 'm1',
    privilege,
  };
}

/** Install a fixed hit list as the retrieval backend. */
function backend(hits: RagHit[]): void {
  setRetrievalBackend(() => Promise.resolve(hits));
}

const ALL: RetrievalScope = { kind: 'allMatters' };

beforeEach(() => {
  setMeetingFileVisibilityResolver((paths) =>
    Promise.resolve(new Map(paths.map((path) => [path, 'not-meeting'] as const)))
  );
});

afterEach(() => {
  resetRetrievalBackend();
  resetPrivilegeResolver();
  resetRetrievalHitExclusion();
  resetSourceIdForms();
  resetMeetingFileVisibilityResolver();
});

describe('QA-44 privilege fail-closed at retrieval', () => {
  it('excludes a source the live privilege store marks privileged even when its index tag is a stale none', async () => {
    // The re-tag FAILED, so the backend still returns the privileged source with
    // a stale 'none' tag on the default path.
    setPrivilegeResolver((id) => (id === '/ws/secret.docx' ? 'attorney-client' : 'none'));
    backend([hit('/ws/secret.docx', 'none'), hit('/ws/public.docx', 'none')]);

    const hits = await MemoryService.retrieve('q', 5, ALL, false);

    expect(hits.map((h) => h.sourceId)).toEqual(['/ws/public.docx']);
  });

  it('still returns the privileged source on a deliberate include-privileged query', async () => {
    setPrivilegeResolver((id) => (id === '/ws/secret.docx' ? 'work-product' : 'none'));
    backend([hit('/ws/secret.docx', 'work-product'), hit('/ws/public.docx')]);

    const hits = await MemoryService.retrieve('q', 5, ALL, true);

    expect(hits.map((h) => h.sourceId).sort()).toEqual(['/ws/public.docx', '/ws/secret.docx']);
  });

  it('fails closed across path forms: privilege stored under the RELATIVE key still excludes an ABSOLUTE hit', async () => {
    // The privilege UI marks a file by its workspace-relative path, but the RAG
    // hit carries the absolute path (Codex round 1 finding). The forms provider
    // yields both, so the re-check still matches.
    setPrivilegeResolver((id) => (id === 'Clients/Acme/secret.docx' ? 'attorney-client' : 'none'));
    setSourceIdForms((id) =>
      id === '/ws/Clients/Acme/secret.docx'
        ? ['/ws/Clients/Acme/secret.docx', 'Clients/Acme/secret.docx']
        : [id],
    );
    backend([hit('/ws/Clients/Acme/secret.docx', 'none'), hit('/ws/public.docx', 'none')]);

    const hits = await MemoryService.retrieve('q', 5, ALL, false);

    expect(hits.map((h) => h.sourceId)).toEqual(['/ws/public.docx']);
  });

  it('does not exclude anything when nothing is marked privileged (no regression on the happy path)', async () => {
    backend([hit('/ws/a.docx'), hit('/ws/b.docx')]);

    const hits = await MemoryService.retrieve('q', 5, ALL, false);

    expect(hits.map((h) => h.sourceId)).toEqual(['/ws/a.docx', '/ws/b.docx']);
  });
});

describe('QA-44 matter/client fail-closed at retrieval', () => {
  it('drops hits the injected exclusion predicate marks (folder re-tag pending/failed)', async () => {
    backend([hit('/ws/Acme/deal.docx'), hit('/ws/Beta/note.docx')]);
    // Simulate a pending/failed folder re-tag for /ws/Acme.
    setRetrievalHitExclusion((h) => (h.sourceId ?? h.path).startsWith('/ws/Acme/'));

    const hits = await MemoryService.retrieve('q', 5, ALL, false);

    expect(hits.map((h) => h.sourceId)).toEqual(['/ws/Beta/note.docx']);
  });

  it('applies the matter exclusion on the include-privileged path too (wrong-client is never opt-in)', async () => {
    backend([hit('/ws/Acme/deal.docx'), hit('/ws/Beta/note.docx')]);
    setRetrievalHitExclusion((h) => (h.sourceId ?? h.path).startsWith('/ws/Acme/'));

    const hits = await MemoryService.retrieve('q', 5, ALL, true);

    expect(hits.map((h) => h.sourceId)).toEqual(['/ws/Beta/note.docx']);
  });
});
