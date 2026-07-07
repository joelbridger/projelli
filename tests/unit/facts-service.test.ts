/**
 * FactsService — CRUD through a mocked in-memory storage adapter, with
 * atomic-write semantics verified via write-call ordering.
 *
 * The service is the single source of truth for `<workspace>/.lantern/memory.json`,
 * so we pin:
 *   - empty-file on first load (no side effects)
 *   - addFact round-trips through serialize/parse
 *   - updateFact + deleteFact return null/false on miss
 *   - atomic write goes tmp -> final -> remove(tmp)
 *   - parseMemoryFactsJson coerces corrupt data to empty instead of
 *     throwing (so a bad file doesn't brick the app)
 *   - version mismatch falls back to empty list (migration placeholder)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFactsService,
  FACTS_FILE_RELATIVE_PATH,
  FACTS_SCHEMA_VERSION,
  parseMemoryFactsJson,
  serializeMemoryFacts,
  type FactsServiceApi,
  type FactsStorage,
  type MemoryFacts,
} from '@/platform/rag/FactsService';

/** Minimal in-memory storage mock with ordering tracking. */
function makeStorageMock() {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const removes: string[] = [];
  const storage: FactsStorage = {
    read: vi.fn(async (path: string) => {
      const data = files.get(path);
      if (data === undefined) throw new Error('ENOENT: ' + path);
      return data;
    }),
    write: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      writes.push(path);
    }),
    exists: vi.fn(async (path: string) => files.has(path)),
    remove: vi.fn(async (path: string) => {
      files.delete(path);
      removes.push(path);
    }),
  };
  return { storage, files, writes, removes };
}

function makeService(): { service: FactsServiceApi; mock: ReturnType<typeof makeStorageMock> } {
  const mock = makeStorageMock();
  const service = createFactsService({
    storage: mock.storage,
    generateId: (() => {
      let n = 0;
      return () => `fact-${++n}`;
    })(),
    now: () => new Date('2026-04-16T12:00:00.000Z'),
  });
  return { service, mock };
}

describe('FactsService — loadFacts', () => {
  it('returns an empty envelope when the file does not exist', async () => {
    const { service, mock } = makeService();
    const loaded = await service.loadFacts();
    expect(loaded.version).toBe(FACTS_SCHEMA_VERSION);
    expect(loaded.facts).toEqual([]);
    // Load alone MUST NOT write anything to disk.
    expect(mock.writes).toEqual([]);
  });

  it('parses existing file contents', async () => {
    const { service, mock } = makeService();
    const seed: MemoryFacts = {
      version: 1,
      facts: [
        {
          id: 'a1',
          text: 'The user is based in Austin.',
          created: '2026-04-01T10:00:00.000Z',
          approved_by: 'user',
        },
      ],
    };
    mock.files.set(FACTS_FILE_RELATIVE_PATH, serializeMemoryFacts(seed));
    const loaded = await service.loadFacts();
    expect(loaded.facts).toHaveLength(1);
    expect(loaded.facts[0]?.text).toBe('The user is based in Austin.');
  });
});

describe('FactsService — addFact / updateFact / deleteFact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a fact and stamps id + created', async () => {
    const { service } = makeService();
    const added = await service.addFact({
      text: 'The user ships products using Lantern.',
      approved_by: 'user',
    });
    expect(added.id).toBe('fact-1');
    expect(added.text).toBe('The user ships products using Lantern.');
    expect(added.created).toBe('2026-04-16T12:00:00.000Z');
    expect(added.approved_by).toBe('user');
    const facts = await service.listFacts();
    expect(facts).toHaveLength(1);
  });

  it('preserves source provenance fields when provided', async () => {
    const { service } = makeService();
    const added = await service.addFact({
      text: 'Wife is Allison.',
      approved_by: 'auto',
      source_chat_id: 'chat-42',
      source_message_index: 7,
    });
    expect(added.source_chat_id).toBe('chat-42');
    expect(added.source_message_index).toBe(7);
  });

  it('updateFact replaces the text only when the id exists', async () => {
    const { service } = makeService();
    const added = await service.addFact({
      text: 'Works remote.',
      approved_by: 'user',
    });
    const updated = await service.updateFact(added.id, 'Works remote from Austin.');
    expect(updated?.text).toBe('Works remote from Austin.');
    expect(updated?.id).toBe(added.id);
    const miss = await service.updateFact('nope', 'x');
    expect(miss).toBeNull();
  });

  it('updateFact rejects empty / whitespace text', async () => {
    const { service } = makeService();
    const added = await service.addFact({
      text: 'Works remote.',
      approved_by: 'user',
    });
    const result = await service.updateFact(added.id, '   ');
    expect(result).toBeNull();
    // Original fact unchanged
    const facts = await service.listFacts();
    expect(facts[0]?.text).toBe('Works remote.');
  });

  it('deleteFact returns true on hit, false on miss', async () => {
    const { service } = makeService();
    const added = await service.addFact({
      text: 'Has a dog.',
      approved_by: 'user',
    });
    expect(await service.deleteFact('nope')).toBe(false);
    expect(await service.deleteFact(added.id)).toBe(true);
    expect(await service.listFacts()).toHaveLength(0);
  });
});

describe('FactsService — atomic write', () => {
  it('writes to .tmp before the final path, then removes the .tmp', async () => {
    const { service, mock } = makeService();
    await service.addFact({ text: 'X', approved_by: 'user' });
    // Order must be: .tmp first, then final, then remove(.tmp)
    expect(mock.writes[0]).toBe(`${FACTS_FILE_RELATIVE_PATH}.tmp`);
    expect(mock.writes[1]).toBe(FACTS_FILE_RELATIVE_PATH);
    expect(mock.removes).toEqual([`${FACTS_FILE_RELATIVE_PATH}.tmp`]);
  });

  it('survives a missing remove() adapter method (optional)', async () => {
    // Construct a storage without `remove` — atomic writes should still
    // complete without throwing. Stale tmp files are tolerated.
    const files = new Map<string, string>();
    const storage: FactsStorage = {
      read: async (p) => files.get(p) ?? (() => { throw new Error('n'); })(),
      write: async (p, c) => { files.set(p, c); },
      exists: async (p) => files.has(p),
      // no remove
    };
    const service = createFactsService({
      storage,
      generateId: () => 'stable-id',
      now: () => new Date('2026-04-16T12:00:00.000Z'),
    });
    await expect(
      service.addFact({ text: 'Y', approved_by: 'user' }),
    ).resolves.toBeTruthy();
  });
});

describe('FactsService — schema version + corruption handling', () => {
  it('coerces invalid JSON to an empty facts list', () => {
    const parsed = parseMemoryFactsJson('{ not valid json }');
    expect(parsed.version).toBe(FACTS_SCHEMA_VERSION);
    expect(parsed.facts).toEqual([]);
  });

  it('drops unknown schema versions to empty (migration placeholder)', () => {
    const parsed = parseMemoryFactsJson(JSON.stringify({ version: 99, facts: [] }));
    expect(parsed.facts).toEqual([]);
  });

  it('drops rows missing required fields', () => {
    const raw = JSON.stringify({
      version: 1,
      facts: [
        { id: 'ok', text: 'good', created: '2026-01-01', approved_by: 'user' },
        { id: '', text: 'no id', created: '2026-01-01', approved_by: 'user' },
        { id: 'noText', text: '   ', created: '2026-01-01', approved_by: 'user' },
        { id: 'noCreated', text: 'hi', approved_by: 'user' },
      ],
    });
    const parsed = parseMemoryFactsJson(raw);
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.facts[0]?.id).toBe('ok');
  });

  it('normalizes unrecognized approved_by to "user"', () => {
    const raw = JSON.stringify({
      version: 1,
      facts: [{ id: 'a', text: 't', created: 'c', approved_by: 'alien' }],
    });
    const parsed = parseMemoryFactsJson(raw);
    expect(parsed.facts[0]?.approved_by).toBe('user');
  });

  it('round-trips add -> serialize -> parse', async () => {
    const { service } = makeService();
    await service.addFact({ text: 'A', approved_by: 'user' });
    const loaded = await service.loadFacts();
    const raw = serializeMemoryFacts(loaded);
    const parsed = parseMemoryFactsJson(raw);
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.facts[0]?.text).toBe('A');
  });

  it('ignores stale .keepance data-dir names after the approved dev-data reset', async () => {
    const mock = makeStorageMock();
    mock.files.set(
      '.keepance/memory.json',
      JSON.stringify({ version: FACTS_SCHEMA_VERSION, facts: [{ id: 'a', text: 'legacy', created: 'c', approved_by: 'user' }] }),
    );
    const service = createFactsService({ storage: mock.storage, dataDirName: '.keepance' });

    const loaded = await service.loadFacts();
    expect(loaded.facts).toEqual([]);
  });

  it('first-ever facts write uses .lantern even if a stale data-dir name is supplied', async () => {
    const mock = makeStorageMock();
    const service = createFactsService({ storage: mock.storage, dataDirName: '.keepance' });

    await service.addFact({ text: 'first', approved_by: 'user' });

    expect(mock.files.has(FACTS_FILE_RELATIVE_PATH)).toBe(true);
    expect(mock.files.has('.keepance/memory.json')).toBe(false);
    expect(mock.writes.some((p) => p.startsWith('.keepance/'))).toBe(false);
  });

  it('defaults new facts to the current .lantern path when no dataDirName is given', async () => {
    const mock = makeStorageMock();
    const service = createFactsService({ storage: mock.storage });
    await service.addFact({ text: 'fresh', approved_by: 'user' });
    expect(mock.files.has(FACTS_FILE_RELATIVE_PATH)).toBe(true);
    expect(mock.files.has('.keepance/memory.json')).toBe(false);
  });
});
