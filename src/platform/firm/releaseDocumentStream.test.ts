import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { parseMatterHandle, parseStreamHandle } from './contract';
import {
  addDocumentStreamToPrivateIndex,
  FIRM_PRIVATE_INDEX_STREAMS_V2_MAP,
  writeFirmMatterPrivateIndex,
} from './firmMatterPrivateIndex';
import { retirePinnedDocumentStream } from './firmKeychain';
import { tombstoneAndReleaseDocumentStream } from './releaseDocumentStream';

const matterHandle = parseMatterHandle(`mh2_${'A'.repeat(43)}`);
const rootStream = parseStreamHandle(`sh2_${'R'.repeat(43)}`);
const draftStream = parseStreamHandle(`sh2_${'D'.repeat(43)}`);
const attackerStream = parseStreamHandle(`sh2_${'X'.repeat(43)}`);

afterEach(() => { localStorage.clear(); });

function documentWithIndex(): Y.Doc {
  const doc = new Y.Doc();
  writeFirmMatterPrivateIndex(doc, {
    version: 1,
    clientName: 'client',
    displayName: 'Client',
    streams: { _notes: { streamHandle: rootStream, kind: 'notes' } },
  });
  return doc;
}

describe('document stream release pinning', () => {
  it('blocks a peer rewrite of an already-pinned document mapping before it can release another stream', async () => {
    const honest = documentWithIndex();
    await addDocumentStreamToPrivateIndex(honest, matterHandle, 'draft.docx', draftStream);

    // Device B has the same shared root state, but writes a hostile raw Yjs
    // map value directly instead of using the local creation helper.
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, Y.encodeStateAsUpdate(honest));
    attacker.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP).set(
      'draft.docx', { streamHandle: attackerStream, kind: 'document' },
    );
    Y.applyUpdate(honest, Y.encodeStateAsUpdate(attacker));

    const releaseMatterStream = vi.fn().mockResolvedValue({ ok: true });
    await expect(tombstoneAndReleaseDocumentStream({
      doc: honest,
      localDocumentId: 'draft.docx',
      matterHandle,
      rootSync: { flush: vi.fn().mockResolvedValue(undefined) } as never,
      client: { releaseMatterStream } as never,
    })).rejects.toThrow('Document deletion was blocked');
    expect(releaseMatterStream).not.toHaveBeenCalled();
    expect(releaseMatterStream).not.toHaveBeenCalledWith(matterHandle, attackerStream);
  });

  it('still releases the stream the local device created when its mapping has not changed', async () => {
    const doc = documentWithIndex();
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'draft.docx', draftStream);
    const flush = vi.fn().mockResolvedValue(undefined);
    const releaseMatterStream = vi.fn().mockResolvedValue({ ok: true });

    await expect(tombstoneAndReleaseDocumentStream({
      doc,
      localDocumentId: 'draft.docx',
      matterHandle,
      rootSync: { flush } as never,
      client: { releaseMatterStream } as never,
    })).resolves.toBe(draftStream);
    expect(flush).toHaveBeenCalledOnce();
    expect(releaseMatterStream).toHaveBeenCalledWith(matterHandle, draftStream);
  });

  it('resumes a delete interrupted after local retirement and releases the originally pinned stream', async () => {
    const doc = documentWithIndex();
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'draft.docx', draftStream);
    await retirePinnedDocumentStream(matterHandle, 'draft.docx');
    const flush = vi.fn().mockResolvedValue(undefined);
    const releaseMatterStream = vi.fn().mockResolvedValue({ ok: true });

    await expect(tombstoneAndReleaseDocumentStream({
      doc,
      localDocumentId: 'draft.docx',
      matterHandle,
      rootSync: { flush } as never,
      client: { releaseMatterStream } as never,
    })).resolves.toBe(draftStream);
    expect(flush).toHaveBeenCalledOnce();
    expect(releaseMatterStream).toHaveBeenCalledWith(matterHandle, draftStream);
  });

  it('still blocks a changed shared mapping after local retirement', async () => {
    const doc = documentWithIndex();
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'draft.docx', draftStream);
    await retirePinnedDocumentStream(matterHandle, 'draft.docx');
    doc.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP).set(
      'draft.docx', { streamHandle: attackerStream, kind: 'document' },
    );
    const releaseMatterStream = vi.fn().mockResolvedValue({ ok: true });

    await expect(tombstoneAndReleaseDocumentStream({
      doc,
      localDocumentId: 'draft.docx',
      matterHandle,
      rootSync: { flush: vi.fn().mockResolvedValue(undefined) } as never,
      client: { releaseMatterStream } as never,
    })).rejects.toThrow('retired');
    expect(releaseMatterStream).not.toHaveBeenCalled();
  });
});
