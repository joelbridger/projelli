# Client Map (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `01-design-spec.md` (the approved design, 12 locked decisions) before starting.

**Goal:** Ship v1 of the Client Map: a saved, living, source-linked profile of one matter that the app builds from that matter's own files and emails, with approve-first updates, custom categories, Context Completeness, and a Guided Client Interview, working privately on-device by default.

**Architecture:** All logic lives in a new platform capability `src/platform/clientMap/` (types, store, generator, completeness, updater, templates, guided interview), mirroring how `src/platform/matter/matterAtAGlance.ts` lives in `platform`. All UI lives inside the existing `src/features/matters/` surface (the Client Map is the matter's "home" detail view, entered from `MattersHome`/`MatterHub`), which avoids any cross-feature import edge. New persisted stores use Zustand's standard single-key `persist` (`createJSONStorage(() => localStorage)`), not the matter store's legacy multi-key adapter.

**Tech Stack:** React 18 + TypeScript 5 (strict), Zustand (+ persist middleware), Vitest + React Testing Library. Reuses existing platform services: `MemoryService.retrieve` (matter-scoped RAG), `buildWorkspaceContextBlock`, the provider adapters (`ClaudeProvider`/`OpenAIProvider`/`GeminiProvider`/`OllamaProvider`), `KeychainService`, and the privacy guard (`isLocalOnlyMode`, `assertCloudGenerationAllowed`).

## Global Constraints

Every task's requirements implicitly include all of these. Copied from the spec's hard rules (§6).

- **Matter isolation:** every Client Map retrieval uses `{ kind: 'matter', matterId }`. NEVER `allMatters`. A map's sources may only reference content indexed under that one matter.
- **No silent cloud egress:** generation respects `isLocalOnlyMode()` (force on-device Ollama) and calls `assertCloudGenerationAllowed()` ONLY on a cloud branch AFTER confirming a cloud key exists — exactly as `buildProviderForGlance` does. Personal installs never auto-egress.
- **AI proposes, the professional decides:** all AI changes to an existing map flow through the approve-first tray (`pendingUpdates`); they never mutate the map directly.
- **User edits are sovereign:** any item with `origin: 'user'` is NEVER overwritten by an AI pass.
- **Everything is sourced:** every AI-origin item carries `sources: SourceRef[]`, or is explicitly marked `isAssumption: true`.
- **Firm installs unchanged:** v1 adds no firm behavior; where firm state is read, branch on `isFirm`/`useFirm` and leave the firm path untouched.
- **Never claim "compliant"/"guaranteed":** there are tests asserting this. No user-facing string may imply Keepance makes a user compliant.
- **Voice:** NO em dashes in any user-facing string (there is a repo-wide test). No AI tells ("leverage/seamless/transform/empower/elevate/unlock"). First-person, concrete nouns. Keep microcopy minimal; the marketing session owns final wording.
- **Single-matter only:** a Client Map is always scoped to exactly one matter; no cross-matter map.
- **No build/deploy** without Jameson's explicit go.
- **Gates green per task:** `npm run typecheck` (expect 0) · `npx vitest run` (the new tests + no regressions) · `node scripts/eslint-gate.mjs` · `npm run gate`. Commit per task; messages end with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Phase A — Data model + saved store (`src/platform/clientMap/`)

### Task A1: Client Map types

**Files:**
- Create: `src/platform/clientMap/types.ts`
- Test: `tests/unit/clientMap/types.test.ts`

**Interfaces:**
- Produces: the canonical types used by every later task — `CompletenessLevel`, `ItemOrigin`, `SectionScope`, `CoreSectionKey`, `SourceRef`, `ClientMapItem`, `ClientMapSection`, `ProposedUpdate`, `ContextCompleteness`, `ClientMap`, `CustomCategoryTemplate`, `ClientQuestion`, plus `sourceRefFromRagHit(hit)` and `emptyClientMap(matterId)` helpers. ALL later tasks import these names verbatim.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clientMap/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  sourceRefFromRagHit,
  emptyClientMap,
  CORE_SECTION_ORDER,
} from '@/platform/clientMap/types';
import type { RagHit } from '@/platform/utils/tauri-commands';

describe('clientMap/types', () => {
  it('maps a document RagHit to a SourceRef', () => {
    const hit: RagHit = {
      path: '/Clients/Acme/complaint.docx',
      chunkText: 'Acme alleges breach of contract.',
      score: 0.91,
      paragraphIndex: 3,
      id: 'chunk-abc',
      sourceId: '/Clients/Acme/complaint.docx',
      sourceType: 'docx',
      matterId: 'm1',
    };
    const ref = sourceRefFromRagHit(hit);
    expect(ref.kind).toBe('document');
    expect(ref.ref).toBe('/Clients/Acme/complaint.docx');
    expect(ref.snippet).toBe('Acme alleges breach of contract.');
    expect(ref.citationId).toBe('chunk-abc');
  });

  it('maps a mail RagHit to an email SourceRef', () => {
    const hit: RagHit = {
      path: 'Inbox/RE: settlement',
      chunkText: 'They offered 50k.',
      score: 0.8,
      paragraphIndex: 0,
      sourceId: 'mail:msg-123',
      sourceType: 'mail',
    };
    const ref = sourceRefFromRagHit(hit);
    expect(ref.kind).toBe('email');
    expect(ref.ref).toBe('mail:msg-123');
  });

  it('builds an empty-but-valid ClientMap with the six section order', () => {
    const map = emptyClientMap('m1');
    expect(map.matterId).toBe('m1');
    expect(map.sections.map((s) => s.key)).toEqual(CORE_SECTION_ORDER);
    expect(map.completeness.level).toBe('thin');
    expect(map.pendingUpdates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clientMap/types.test.ts`
Expected: FAIL — `Cannot find module '@/platform/clientMap/types'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/clientMap/types.ts
import type { RagHit } from '@/platform/utils/tauri-commands';

export type CompletenessLevel = 'thin' | 'getting-there' | 'solid';
export type ItemOrigin = 'ai' | 'user';
export type SectionScope = 'matter' | 'personal-template'; // 'firm' added in v2

/** The five core CONTENT sections, in display order. "What I'm missing"
 *  (Context Completeness) is rendered from ClientMap.completeness, not from a
 *  section in this list. */
export type CoreSectionKey = 'story' | 'people' | 'standing' | 'upcoming' | 'next';
export const CORE_SECTION_ORDER: CoreSectionKey[] = [
  'story',
  'people',
  'standing',
  'upcoming',
  'next',
];
export const CORE_SECTION_TITLE: Record<CoreSectionKey, string> = {
  story: 'The story so far',
  people: 'Key people',
  standing: 'Where things stand',
  upcoming: "What's coming",
  next: 'Next actions',
};

export interface SourceRef {
  kind: 'document' | 'email';
  /** Resolvable origin: a workspace path or `mail:<id>` (from RagHit.sourceId). */
  ref: string;
  /** The supporting quote (from RagHit.chunkText). */
  snippet: string;
  /** Content-addressed chunk id (RagHit.id) for ragVerifyCitation. */
  citationId?: string;
  /** Display locator label (page/paragraph), if known. */
  locator?: string;
}

export interface ClientMapItem {
  id: string;
  text: string;
  origin: ItemOrigin;
  /** true => no strong supporting source; feeds the "what I'm assuming" list. */
  isAssumption: boolean;
  sources: SourceRef[];
  updatedAt: string; // ISO 8601
}

export interface ClientMapSection {
  id: string;
  kind: 'core' | 'custom';
  /** A CoreSectionKey for core sections; a uuid for custom sections. */
  key: string;
  title: string;
  /** Custom sections only: the user's plain-language description of what to track. */
  prompt?: string;
  /** Custom sections only. */
  scope?: SectionScope;
  items: ClientMapItem[];
}

export interface ProposedUpdate {
  id: string;
  sectionKey: string;
  op: 'add' | 'change' | 'remove';
  itemId?: string; // for change/remove
  draft?: ClientMapItem; // for add/change
  reason: string;
  createdAt: string;
}

export interface ContextCompleteness {
  level: CompletenessLevel;
  know: ClientMapItem[]; // sourced facts (aggregated view)
  assuming: ClientMapItem[]; // isAssumption items
  ask: string[]; // gap questions -> feed the Guided Interview
}

export interface ClientMap {
  matterId: string; // isolation key — always exactly one matter
  sections: ClientMapSection[];
  completeness: ContextCompleteness;
  pendingUpdates: ProposedUpdate[];
  lastBuiltAt: string; // ISO 8601, '' when never built
  lastSourceFingerprint: string;
}

export interface CustomCategoryTemplate {
  id: string;
  title: string;
  prompt: string;
  scope: SectionScope; // 'personal-template' in v1
}

export interface ClientQuestion {
  id: string;
  text: string;
  askedSection?: string;
}

export function sourceRefFromRagHit(hit: RagHit): SourceRef {
  const ref = hit.sourceId ?? hit.path;
  const kind: SourceRef['kind'] = hit.sourceType === 'mail' ? 'email' : 'document';
  const locator =
    hit.locator ??
    (hit.pageNumber !== undefined ? `p. ${hit.pageNumber}` : undefined);
  const out: SourceRef = { kind, ref, snippet: hit.chunkText };
  if (hit.id !== undefined) out.citationId = hit.id;
  if (locator !== undefined) out.locator = locator;
  return out;
}

export function emptyClientMap(matterId: string): ClientMap {
  return {
    matterId,
    sections: CORE_SECTION_ORDER.map((key) => ({
      id: key,
      kind: 'core' as const,
      key,
      title: CORE_SECTION_TITLE[key],
      items: [],
    })),
    completeness: { level: 'thin', know: [], assuming: [], ask: [] },
    pendingUpdates: [],
    lastBuiltAt: '',
    lastSourceFingerprint: '',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/clientMap/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/types.ts tests/unit/clientMap/types.test.ts
git commit -m "feat(clientMap): canonical types + RagHit->SourceRef mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: Saved Client Map store

**Files:**
- Create: `src/platform/clientMap/clientMapStore.ts`
- Test: `tests/unit/clientMap/clientMapStore.test.ts`

**Interfaces:**
- Consumes: all types from `@/platform/clientMap/types` (Task A1).
- Produces:
  - `useClientMapStore` (Zustand store) with state `maps: Record<string, ClientMap>` and actions:
    - `getMap(matterId: string): ClientMap | undefined`
    - `setMap(matterId: string, map: ClientMap): void`
    - `editItem(matterId: string, sectionKey: string, itemId: string, text: string): void` — sets the item `origin: 'user'`, `isAssumption: false`, refreshes `updatedAt`. (Sovereign edit.)
    - `removeItem(matterId: string, sectionKey: string, itemId: string): void`
    - `setPendingUpdates(matterId: string, updates: ProposedUpdate[]): void`
    - `acceptUpdate(matterId: string, updateId: string, override?: string): void` — applies the update (add/change/remove); on `change` with `override`, applies the override text as `origin: 'user'`; removes the update from `pendingUpdates`.
    - `dismissUpdate(matterId: string, updateId: string): void`
    - `invalidate(matterId: string): void` — deletes the cached map
    - `clearAll(): void`
  - Non-reactive accessor: `getClientMap(matterId: string): ClientMap | undefined`.
- Persistence: single-key `persist`, `name: 'keepance:client-maps'`, `createJSONStorage(() => localStorage)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clientMap/clientMapStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useClientMapStore, getClientMap } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ProposedUpdate, ClientMapItem } from '@/platform/clientMap/types';

const item = (id: string, text: string): ClientMapItem => ({
  id, text, origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-06-22T00:00:00Z',
});

beforeEach(() => { useClientMapStore.setState({ maps: {} }); });

describe('clientMapStore', () => {
  it('sets and gets a map by matter id', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    expect(useClientMapStore.getState().getMap('m1')?.matterId).toBe('m1');
    expect(getClientMap('m1')?.matterId).toBe('m1'); // non-reactive accessor
  });

  it('editItem marks the item as user-origin and not an assumption', () => {
    const m = emptyClientMap('m1');
    m.sections[0].items.push(item('i1', 'AI text'));
    m.sections[0].items[0].isAssumption = true;
    useClientMapStore.getState().setMap('m1', m);
    useClientMapStore.getState().editItem('m1', 'story', 'i1', 'My corrected text');
    const edited = useClientMapStore.getState().getMap('m1')!.sections[0].items[0];
    expect(edited.text).toBe('My corrected text');
    expect(edited.origin).toBe('user');
    expect(edited.isAssumption).toBe(false);
  });

  it('acceptUpdate(add) appends the drafted item and clears the update', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = {
      id: 'u1', sectionKey: 'standing', op: 'add',
      draft: item('n1', 'New open issue'), reason: 'new email', createdAt: '2026-06-22T00:00:00Z',
    };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);
    useClientMapStore.getState().acceptUpdate('m1', 'u1');
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.sections.find((s) => s.key === 'standing')!.items.map((i) => i.text)).toContain('New open issue');
    expect(map.pendingUpdates).toEqual([]);
  });

  it('dismissUpdate drops the update without changing items', () => {
    const m = emptyClientMap('m1');
    useClientMapStore.getState().setMap('m1', m);
    const upd: ProposedUpdate = { id: 'u2', sectionKey: 'next', op: 'add', draft: item('x', 'X'), reason: 'r', createdAt: 't' };
    useClientMapStore.getState().setPendingUpdates('m1', [upd]);
    useClientMapStore.getState().dismissUpdate('m1', 'u2');
    expect(useClientMapStore.getState().getMap('m1')!.pendingUpdates).toEqual([]);
    expect(useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'next')!.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clientMap/clientMapStore.test.ts`
Expected: FAIL — `Cannot find module '@/platform/clientMap/clientMapStore'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/clientMap/clientMapStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ClientMap, ProposedUpdate } from './types';

interface ClientMapState {
  maps: Record<string, ClientMap>;
  getMap: (matterId: string) => ClientMap | undefined;
  setMap: (matterId: string, map: ClientMap) => void;
  editItem: (matterId: string, sectionKey: string, itemId: string, text: string) => void;
  removeItem: (matterId: string, sectionKey: string, itemId: string) => void;
  setPendingUpdates: (matterId: string, updates: ProposedUpdate[]) => void;
  acceptUpdate: (matterId: string, updateId: string, override?: string) => void;
  dismissUpdate: (matterId: string, updateId: string) => void;
  invalidate: (matterId: string) => void;
  clearAll: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useClientMapStore = create<ClientMapState>()(
  persist(
    (set, get) => ({
      maps: {},
      getMap: (matterId) => get().maps[matterId],
      setMap: (matterId, map) =>
        set((s) => ({ maps: { ...s.maps, [matterId]: map } })),
      editItem: (matterId, sectionKey, itemId, text) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          const sections = map.sections.map((sec) =>
            sec.key !== sectionKey
              ? sec
              : {
                  ...sec,
                  items: sec.items.map((it) =>
                    it.id !== itemId
                      ? it
                      : { ...it, text, origin: 'user' as const, isAssumption: false, updatedAt: nowIso() },
                  ),
                },
          );
          return { maps: { ...s.maps, [matterId]: { ...map, sections } } };
        }),
      removeItem: (matterId, sectionKey, itemId) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          const sections = map.sections.map((sec) =>
            sec.key !== sectionKey ? sec : { ...sec, items: sec.items.filter((it) => it.id !== itemId) },
          );
          return { maps: { ...s.maps, [matterId]: { ...map, sections } } };
        }),
      setPendingUpdates: (matterId, updates) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          return { maps: { ...s.maps, [matterId]: { ...map, pendingUpdates: updates } } };
        }),
      acceptUpdate: (matterId, updateId, override) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          const upd = map.pendingUpdates.find((u) => u.id === updateId);
          if (!upd) return {};
          let sections = map.sections;
          if ((upd.op === 'add' || upd.op === 'change') && upd.draft) {
            const draft =
              override !== undefined
                ? { ...upd.draft, text: override, origin: 'user' as const, isAssumption: false, updatedAt: nowIso() }
                : upd.draft;
            sections = map.sections.map((sec) => {
              if (sec.key !== upd.sectionKey) return sec;
              if (upd.op === 'add') return { ...sec, items: [...sec.items, draft] };
              return { ...sec, items: sec.items.map((it) => (it.id === upd.itemId ? draft : it)) };
            });
          } else if (upd.op === 'remove') {
            sections = map.sections.map((sec) =>
              sec.key !== upd.sectionKey ? sec : { ...sec, items: sec.items.filter((it) => it.id !== upd.itemId) },
            );
          }
          return {
            maps: {
              ...s.maps,
              [matterId]: { ...map, sections, pendingUpdates: map.pendingUpdates.filter((u) => u.id !== updateId) },
            },
          };
        }),
      dismissUpdate: (matterId, updateId) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          return {
            maps: { ...s.maps, [matterId]: { ...map, pendingUpdates: map.pendingUpdates.filter((u) => u.id !== updateId) } },
          };
        }),
      invalidate: (matterId) =>
        set((s) => {
          const { [matterId]: _drop, ...rest } = s.maps;
          return { maps: rest };
        }),
      clearAll: () => set({ maps: {} }),
    }),
    {
      name: 'keepance:client-maps',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ maps: state.maps }),
    },
  ),
);

/** Non-reactive accessor for use outside React renders (mirrors getMatters()). */
export function getClientMap(matterId: string): ClientMap | undefined {
  return useClientMapStore.getState().maps[matterId];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/clientMap/clientMapStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/clientMapStore.ts tests/unit/clientMap/clientMapStore.test.ts
git commit -m "feat(clientMap): saved per-matter store with approve-first update actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Generation (`src/platform/clientMap/`)

### Task B1: Privacy-aware provider selection

**Files:**
- Create: `src/platform/clientMap/provider.ts`
- Test: `tests/unit/clientMap/provider.test.ts`

**Interfaces:**
- Produces:
  - `buildProviderForClientMap(): Promise<Provider>` — Local-only → `OllamaProvider`; else Anthropic → OpenAI → Google, each calling `assertCloudGenerationAllowed()` AFTER confirming its key, else `OllamaProvider`.
  - `hasCloudKeyForClientMap(): Promise<boolean>`.
- This is a verbatim mirror of `buildProviderForGlance`/`hasCloudKeyForGlance` in `src/platform/matter/matterAtAGlance.ts` (do NOT import from there; keep a local copy, per that file's own convention).

- [ ] **Step 1: Write the failing test** — mirror `tests/unit/matter/matterAtAGlance.test.ts`'s provider suite.

```ts
// tests/unit/clientMap/provider.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

const cmode = vi.hoisted(() => ({ mode: 'direct' as string }));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => cmode.mode,
}));
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...real, assertCloudGenerationAllowed: vi.fn() };
});
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: class {
    async getKey(provider: string) { return provider === 'anthropic' ? 'test-key' : null; }
  },
}));
vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class { getMetadata() { return { model: 'claude-3-haiku-20240307' }; } },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class { getMetadata() { return { model: 'gpt-4o' }; } } }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class { getMetadata() { return { model: 'gemini' }; } } }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class { getMetadata() { return { model: 'llama3' }; } } }));

import { buildProviderForClientMap, hasCloudKeyForClientMap } from '@/platform/clientMap/provider';

beforeEach(() => { cmode.mode = 'direct'; });

describe('clientMap/provider', () => {
  it('uses the cloud provider when a key exists and a choice was made', async () => {
    const p = await buildProviderForClientMap();
    expect(p.getMetadata().model).toBe('claude-3-haiku-20240307');
  });
  it('forces the on-device model in Local-only mode (never egresses)', async () => {
    cmode.mode = 'local-only';
    const p = await buildProviderForClientMap();
    expect(p.getMetadata().model).toBe('llama3');
  });
  it('reports a cloud key is present', async () => {
    expect(await hasCloudKeyForClientMap()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clientMap/provider.test.ts`
Expected: FAIL — `Cannot find module '@/platform/clientMap/provider'`.

- [ ] **Step 3: Write minimal implementation** — copy the body of `buildProviderForGlance`/`hasCloudKeyForGlance` from `src/platform/matter/matterAtAGlance.ts` verbatim, renaming to `...ForClientMap`. Keep the same imports (`isLocalOnlyMode`, `assertCloudGenerationAllowed`, `KeychainService`, the four providers, `Provider` type) and the same gate placement (gate only on each cloud branch, after the key check).

```ts
// src/platform/clientMap/provider.ts
import { KeychainService } from '@/platform/providers/KeychainService';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import type { Provider } from '@/platform/providers/Provider';
import { isLocalOnlyMode, assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';

export async function hasCloudKeyForClientMap(): Promise<boolean> {
  const kc = new KeychainService();
  if ((await kc.getKey('anthropic'))?.trim()) return true;
  if ((await kc.getKey('openai'))?.trim()) return true;
  if ((await kc.getKey('google'))?.trim()) return true;
  return false;
}

export async function buildProviderForClientMap(): Promise<Provider> {
  if (isLocalOnlyMode()) return new OllamaProvider({});
  const kc = new KeychainService();
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) { assertCloudGenerationAllowed(); return new ClaudeProvider({ apiKey: anthropicKey.trim() }); }
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) { assertCloudGenerationAllowed(); return new OpenAIProvider({ apiKey: openaiKey.trim() }); }
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) { assertCloudGenerationAllowed(); return new GeminiProvider({ apiKey: googleKey.trim() }); }
  return new OllamaProvider({});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/clientMap/provider.test.ts`
Expected: PASS (3 tests). The Local-only test is the privacy-critical assertion.

- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/provider.ts tests/unit/clientMap/provider.test.ts
git commit -m "feat(clientMap): privacy-aware provider selection (local-only forces on-device)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B2: Context Completeness derivation (pure function)

**Files:**
- Create: `src/platform/clientMap/completeness.ts`
- Test: `tests/unit/clientMap/completeness.test.ts`

**Interfaces:**
- Consumes: `ClientMapSection`, `ContextCompleteness`, `CompletenessLevel` from `./types`.
- Produces: `deriveCompleteness(sections: ClientMapSection[], ask: string[]): ContextCompleteness`.
  - `know` = all items across sections with `!isAssumption && sources.length > 0`.
  - `assuming` = all items with `isAssumption`.
  - `level`: `'thin'` if `know.length < 3` OR `assuming.length > know.length`; `'solid'` if `know.length >= 8 && assuming.length <= 2 && ask.length <= 2`; else `'getting-there'`. NO percentage.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clientMap/completeness.test.ts
import { describe, it, expect } from 'vitest';
import { deriveCompleteness } from '@/platform/clientMap/completeness';
import type { ClientMapSection, ClientMapItem } from '@/platform/clientMap/types';

const known = (id: string): ClientMapItem => ({ id, text: id, origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
const assumed = (id: string): ClientMapItem => ({ id, text: id, origin: 'ai', isAssumption: true, sources: [], updatedAt: 't' });
const sec = (items: ClientMapItem[]): ClientMapSection => ({ id: 's', kind: 'core', key: 'standing', title: 'T', items });

describe('deriveCompleteness', () => {
  it('is thin with fewer than three known facts', () => {
    expect(deriveCompleteness([sec([known('a'), known('b')])], []).level).toBe('thin');
  });
  it('is thin when assumptions outnumber known facts', () => {
    expect(deriveCompleteness([sec([known('a'), known('b'), known('c'), assumed('x'), assumed('y'), assumed('z'), assumed('w')])], []).level).toBe('thin');
  });
  it('is getting-there with a moderate base', () => {
    expect(deriveCompleteness([sec([known('a'), known('b'), known('c'), known('d'), known('e')])], ['ask one']).level).toBe('getting-there');
  });
  it('is solid with a strong, low-assumption, low-gap base', () => {
    const items = Array.from({ length: 9 }, (_, i) => known(`k${i}`));
    expect(deriveCompleteness([sec(items)], []).level).toBe('solid');
  });
  it('routes items into know vs assuming and passes ask through', () => {
    const r = deriveCompleteness([sec([known('a'), assumed('b')])], ['what is the deadline?']);
    expect(r.know.map((i) => i.id)).toEqual(['a']);
    expect(r.assuming.map((i) => i.id)).toEqual(['b']);
    expect(r.ask).toEqual(['what is the deadline?']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clientMap/completeness.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/clientMap/completeness.ts
import type { ClientMapSection, ClientMapItem, ContextCompleteness, CompletenessLevel } from './types';

export function deriveCompleteness(sections: ClientMapSection[], ask: string[]): ContextCompleteness {
  const all: ClientMapItem[] = sections.flatMap((s) => s.items);
  const know = all.filter((i) => !i.isAssumption && i.sources.length > 0);
  const assuming = all.filter((i) => i.isAssumption);
  let level: CompletenessLevel;
  if (know.length < 3 || assuming.length > know.length) level = 'thin';
  else if (know.length >= 8 && assuming.length <= 2 && ask.length <= 2) level = 'solid';
  else level = 'getting-there';
  return { level, know, assuming, ask };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/clientMap/completeness.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/completeness.ts tests/unit/clientMap/completeness.test.ts
git commit -m "feat(clientMap): Context Completeness derivation (coarse level, no percentage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B3: The generator — build a map from a matter's own content

**Files:**
- Create: `src/platform/clientMap/generator.ts`
- Test: `tests/unit/clientMap/generator.test.ts`

**Interfaces:**
- Consumes: `MemoryService.retrieve`, `buildWorkspaceContextBlock`, `buildProviderForClientMap` (B1), `deriveCompleteness` (B2), and types from `./types`.
- Produces: `buildClientMap(matterId: string, options?: { signal?: AbortSignal }): Promise<ClientMap>`.
  - For each of the five `CoreSectionKey`s, retrieve matter-scoped hits with a section-targeted query, build the numbered context block, ask the provider for `{ items: [{ text, sourceNumbers: number[], assumption: boolean }] }`, and map `sourceNumbers` back to the hits to build `SourceRef[]`. An item with no source numbers is forced `isAssumption: true`.
  - Run one extra retrieval+prompt to produce the `ask` gap questions (`string[]`).
  - Compose via `deriveCompleteness(sections, ask)`; set `lastBuiltAt`. When `isMemoryEnabled()` is false or every retrieval is empty, return `emptyClientMap(matterId)` with `lastBuiltAt` stamped (mirror `matterAtAGlance`'s empty path).
  - EVERY retrieval uses `{ kind: 'matter', matterId }` and `includePrivileged = false`.

- [ ] **Step 1: Write the failing test** — mirror the mocking in `tests/unit/matter/matterAtAGlance.test.ts`.

```ts
// tests/unit/clientMap/generator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';

const retrieveMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: retrieveMock },
  isMemoryEnabled: vi.fn(() => true),
}));
vi.mock('@/platform/rag/workspaceCommand', () => ({
  buildWorkspaceContextBlock: (hits: RagHit[]) => (hits.length === 0 ? '' : '<workspace_context>ctx</workspace_context>'),
}));
vi.mock('@/platform/clientMap/provider', () => ({
  buildProviderForClientMap: async () => ({
    sendMessage: sendMock,
    getMetadata: () => ({ model: 'test' }),
  }),
}));

import { buildClientMap } from '@/platform/clientMap/generator';

const hit = (path: string, text: string): RagHit => ({ path, chunkText: text, score: 0.9, paragraphIndex: 0, id: `${path}#0`, sourceId: path, matterId: 'm1' });

beforeEach(() => {
  retrieveMock.mockReset();
  sendMock.mockReset();
});

describe('buildClientMap', () => {
  it('retrieves with matter scope only (never allMatters)', async () => {
    retrieveMock.mockResolvedValue([hit('/a.docx', 'fact')]);
    sendMock.mockResolvedValue({ content: JSON.stringify({ items: [{ text: 'Acme case', sourceNumbers: [1], assumption: false }] }) });
    await buildClientMap('m1');
    for (const call of retrieveMock.mock.calls) {
      const scope = call[2] as RetrievalScope;
      expect(scope).toEqual({ kind: 'matter', matterId: 'm1' });
    }
  });

  it('maps source numbers back to RagHit sources and flags unsourced items as assumptions', async () => {
    retrieveMock.mockResolvedValue([hit('/a.docx', 'fact one')]);
    sendMock.mockResolvedValue({
      content: JSON.stringify({ items: [
        { text: 'Sourced fact', sourceNumbers: [1], assumption: false },
        { text: 'Guessed fact', sourceNumbers: [], assumption: false },
      ] }),
    });
    const map = await buildClientMap('m1');
    const items = map.sections.flatMap((s) => s.items);
    const sourced = items.find((i) => i.text === 'Sourced fact')!;
    expect(sourced.sources[0].ref).toBe('/a.docx');
    expect(sourced.isAssumption).toBe(false);
    const guessed = items.find((i) => i.text === 'Guessed fact')!;
    expect(guessed.isAssumption).toBe(true); // no source numbers => assumption
  });

  it('returns an empty-but-valid map when nothing is indexed', async () => {
    retrieveMock.mockResolvedValue([]);
    const map = await buildClientMap('m1');
    expect(map.matterId).toBe('m1');
    expect(map.sections.flatMap((s) => s.items)).toEqual([]);
    expect(map.lastBuiltAt).not.toBe('');
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clientMap/generator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/clientMap/generator.ts
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { buildProviderForClientMap } from './provider';
import { deriveCompleteness } from './completeness';
import {
  CORE_SECTION_ORDER, CORE_SECTION_TITLE, sourceRefFromRagHit, emptyClientMap,
} from './types';
import type { ClientMap, ClientMapItem, ClientMapSection, CoreSectionKey } from './types';

const SECTION_QUERIES: Record<CoreSectionKey, string> = {
  story: 'overview background what this matter is about who the client is',
  people: 'people involved parties opposing counsel judge witnesses key contacts',
  standing: 'open issues current status disputes problems loose ends',
  upcoming: 'deadlines key dates hearings filing dates court dates',
  next: 'next steps action items follow up tasks to do',
};
const ASK_QUERY = 'what key facts are still unknown or unclear about this client';
const TOP_K = 8;

interface RawItem { text: string; sourceNumbers: number[]; assumption: boolean }

function parseItems(content: string): RawItem[] {
  let raw = content.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items
      .filter((i): i is RawItem => typeof i === 'object' && i !== null && typeof (i as RawItem).text === 'string')
      .map((i) => ({
        text: i.text,
        sourceNumbers: Array.isArray(i.sourceNumbers) ? i.sourceNumbers.filter((n) => typeof n === 'number') : [],
        assumption: i.assumption === true,
      }));
  } catch {
    return [];
  }
}

function itemsFromRaw(raw: RawItem[], hits: RagHit[]): ClientMapItem[] {
  const now = new Date().toISOString();
  return raw.map((r, idx) => {
    const sources = r.sourceNumbers
      .map((n) => hits[n - 1])
      .filter((h): h is RagHit => h !== undefined)
      .map(sourceRefFromRagHit);
    return {
      id: `${now}-${idx}-${Math.round(r.text.length)}`,
      text: r.text,
      origin: 'ai' as const,
      isAssumption: sources.length === 0 ? true : r.assumption,
      sources,
      updatedAt: now,
    };
  });
}

const sectionPrompt = (title: string, ctx: string) =>
  `You are a private legal assistant building a client profile section: "${title}".
${ctx}
Return ONLY JSON (no fences): {"items":[{"text":"one short factual sentence","sourceNumbers":[1],"assumption":false}]}.
Rules: base every item ONLY on the context; cite the [N] numbers that support it in sourceNumbers; if you must infer without a source, set assumption true and sourceNumbers []; under 20 words each; no em dashes; empty items array if nothing applies.`;

export async function buildClientMap(
  matterId: string,
  options?: { signal?: AbortSignal },
): Promise<ClientMap> {
  if (!isMemoryEnabled()) return { ...emptyClientMap(matterId), lastBuiltAt: new Date().toISOString() };
  const scope = { kind: 'matter' as const, matterId };

  // Retrieve per section first; if everything is empty, short-circuit.
  const perSection = await Promise.all(
    CORE_SECTION_ORDER.map(async (key) => ({ key, hits: await MemoryService.retrieve(SECTION_QUERIES[key], TOP_K, scope, false) })),
  );
  const askHits = await MemoryService.retrieve(ASK_QUERY, TOP_K, scope, false);
  const anyContent = perSection.some((p) => p.hits.length > 0) || askHits.length > 0;
  if (!anyContent || options?.signal?.aborted) {
    return { ...emptyClientMap(matterId), lastBuiltAt: new Date().toISOString() };
  }

  const provider = await buildProviderForClientMap();
  const sections: ClientMapSection[] = [];
  for (const { key, hits } of perSection) {
    if (hits.length === 0) { sections.push({ id: key, kind: 'core', key, title: CORE_SECTION_TITLE[key], items: [] }); continue; }
    const ctx = buildWorkspaceContextBlock(hits);
    const res = await provider.sendMessage('Build this section.', { systemPrompt: sectionPrompt(CORE_SECTION_TITLE[key], ctx), maxTokens: 500 });
    sections.push({ id: key, kind: 'core', key, title: CORE_SECTION_TITLE[key], items: itemsFromRaw(parseItems(res.content), hits) });
  }

  // Gap questions for Context Completeness.
  let ask: string[] = [];
  if (askHits.length > 0) {
    const ctx = buildWorkspaceContextBlock(askHits);
    const res = await provider.sendMessage('List the gaps.', {
      systemPrompt: `Given this client context, list up to 5 short questions whose answers are missing and that you would need to ask the client. ${ctx} Return ONLY JSON (no fences): {"questions":["..."]}. No em dashes.`,
      maxTokens: 300,
    });
    try {
      const parsed = JSON.parse(res.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) as { questions?: unknown };
      if (Array.isArray(parsed.questions)) ask = parsed.questions.filter((q): q is string => typeof q === 'string').slice(0, 5);
    } catch { ask = []; }
  }

  return {
    matterId,
    sections,
    completeness: deriveCompleteness(sections, ask),
    pendingUpdates: [],
    lastBuiltAt: new Date().toISOString(),
    lastSourceFingerprint: '',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/clientMap/generator.test.ts`
Expected: PASS (3 tests). The matter-scope test is the isolation guarantee.

- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/generator.ts tests/unit/clientMap/generator.test.ts
git commit -m "feat(clientMap): generator builds a matter-scoped, sourced map from RAG

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — The Client Map page (read view) (`src/features/matters/`)

> UI convention: mirror `MatterHub.tsx` — `@/ui/kp` primitives (`Card`, `Eyebrow`, `IconButton`, `Chip`, `Badge`), inline styles + CSS vars, light theme, `data-testid` on every testable node. NO em dashes in any string. All Client Map UI lives in `src/features/matters/` (no new feature folder, no cross-feature edge).

### Task C1: `ClientMapView` — render a map (presentational)

**Files:**
- Create: `src/features/matters/ClientMapView.tsx`
- Test: `tests/unit/matters/ClientMapView.test.tsx`

**Interfaces:**
- Consumes: `ClientMap`, `ClientMapItem`, `SourceRef` from `@/platform/clientMap/types`.
- Produces: `ClientMapView({ map, onOpenSource, onEditItem })` where `onOpenSource(ref: SourceRef): void` and `onEditItem(sectionKey: string, itemId: string): void`. Pure render of a given map.

**Render contract (data-testids):**
- One `data-testid="clientmap-section-<key>"` block per core section, in `CORE_SECTION_ORDER`, each titled from `CORE_SECTION_TITLE`.
- Each item: `data-testid="clientmap-item"` with its text; an assumption item also shows a `data-testid="clientmap-item-assumption"` tag reading "assuming". Each source renders as `data-testid="clientmap-source-link"` (button) calling `onOpenSource`.
- A "What I'm missing" block `data-testid="clientmap-completeness"` with a level chip `data-testid="clientmap-completeness-level"` reading "Thin" | "Getting there" | "Solid", and three lists (know / assuming / ask) each with their items/questions.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/matters/ClientMapView.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';

function mapWithItem(): ClientMap {
  const m = emptyClientMap('m1');
  m.sections[0].items.push({
    id: 'i1', text: 'Acme sued Beta for breach', origin: 'ai', isAssumption: false,
    sources: [{ kind: 'document', ref: '/Acme/complaint.docx', snippet: 'breach' }], updatedAt: 't',
  });
  m.completeness = { level: 'getting-there', know: [m.sections[0].items[0]], assuming: [], ask: ['What is the damages figure?'] };
  return m;
}

describe('ClientMapView', () => {
  it('renders the five core sections in order', () => {
    render(<ClientMapView map={emptyClientMap('m1')} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    ['story', 'people', 'standing', 'upcoming', 'next'].forEach((k) =>
      expect(screen.getByTestId(`clientmap-section-${k}`)).toBeInTheDocument(),
    );
  });

  it('renders an item with a clickable source and the completeness level', () => {
    const onOpenSource = vi.fn();
    render(<ClientMapView map={mapWithItem()} onOpenSource={onOpenSource} onEditItem={vi.fn()} />);
    expect(screen.getByText('Acme sued Beta for breach')).toBeInTheDocument();
    expect(screen.getByTestId('clientmap-completeness-level')).toHaveTextContent('Getting there');
    expect(screen.getByText('What is the damages figure?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('clientmap-source-link')[0]);
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ ref: '/Acme/complaint.docx' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/matters/ClientMapView.test.tsx` — Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation** — a presentational component. Skeleton (follow MatterHub styling; fill the obvious markup):

```tsx
// src/features/matters/ClientMapView.tsx
import { Card, Eyebrow, Chip } from '@/ui/kp';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';
import type { ClientMap, ClientMapItem, SourceRef, CompletenessLevel } from '@/platform/clientMap/types';

const LEVEL_LABEL: Record<CompletenessLevel, string> = { thin: 'Thin', 'getting-there': 'Getting there', solid: 'Solid' };

function Item({ item, onOpenSource, onEdit }: { item: ClientMapItem; onOpenSource: (r: SourceRef) => void; onEdit?: () => void }) {
  return (
    <li data-testid="clientmap-item">
      <span>{item.text}</span>
      {item.isAssumption && <span data-testid="clientmap-item-assumption"> (assuming)</span>}
      {item.sources.map((s, i) => (
        <button key={i} data-testid="clientmap-source-link" onClick={() => { onOpenSource(s); }}>
          {s.kind === 'email' ? 'email' : 'source'}{s.locator ? ` ${s.locator}` : ''}
        </button>
      ))}
      {onEdit && <button data-testid="clientmap-item-edit" onClick={onEdit}>edit</button>}
    </li>
  );
}

export function ClientMapView({
  map, onOpenSource, onEditItem,
}: {
  map: ClientMap;
  onOpenSource: (r: SourceRef) => void;
  onEditItem: (sectionKey: string, itemId: string) => void;
}) {
  const c = map.completeness;
  return (
    <div data-testid="clientmap-view">
      {CORE_SECTION_ORDER.map((key) => {
        const sec = map.sections.find((s) => s.key === key);
        return (
          <Card key={key} variant="raised" data-testid={`clientmap-section-${key}`}>
            <Eyebrow>{CORE_SECTION_TITLE[key]}</Eyebrow>
            <ul>{(sec?.items ?? []).map((it) => <Item key={it.id} item={it} onOpenSource={onOpenSource} onEdit={() => { onEditItem(key, it.id); }} />)}</ul>
          </Card>
        );
      })}
      {map.sections.filter((s) => s.kind === 'custom').map((sec) => (
        <Card key={sec.id} variant="raised" data-testid={`clientmap-section-custom-${sec.id}`}>
          <Eyebrow>{sec.title}</Eyebrow>
          <ul>{sec.items.map((it) => <Item key={it.id} item={it} onOpenSource={onOpenSource} onEdit={() => { onEditItem(sec.key, it.id); }} />)}</ul>
        </Card>
      ))}
      <Card variant="raised" data-testid="clientmap-completeness">
        <Eyebrow>What I'm missing</Eyebrow>
        <Chip data-testid="clientmap-completeness-level">{LEVEL_LABEL[c.level]}</Chip>
        <Eyebrow>What I know</Eyebrow>
        <ul>{c.know.map((it) => <Item key={it.id} item={it} onOpenSource={onOpenSource} />)}</ul>
        <Eyebrow>What I'm assuming</Eyebrow>
        <ul>{c.assuming.map((it) => <Item key={it.id} item={it} onOpenSource={onOpenSource} />)}</ul>
        <Eyebrow>What to ask</Eyebrow>
        <ul>{c.ask.map((q, i) => <li key={i} data-testid="clientmap-ask">{q}</li>)}</ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/matters/ClientMapView.test.tsx` — Expected: PASS (2 tests).
- [ ] **Step 5: Commit**

```bash
git add src/features/matters/ClientMapView.tsx tests/unit/matters/ClientMapView.test.tsx
git commit -m "feat(clientMap): ClientMapView renders sections, sources, completeness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: `useClientMap` hook + entry wiring (load / generate / states)

**Files:**
- Create: `src/features/matters/useClientMap.ts`
- Modify: `src/features/matters/MatterHub.tsx` (add a Client Map entry/section that opens the map for the matter)
- Test: `tests/unit/matters/useClientMap.test.ts`

**Interfaces:**
- Consumes: `useClientMapStore` (A2), `buildClientMap` (B3), `hasCloudKeyForClientMap` (B1), `isLocalOnlyMode`.
- Produces: `useClientMap(matterId)` returning `{ status, map, generate }` where `status: 'idle' | 'generating' | 'ready' | 'empty' | 'error'`. On mount, if a cached map exists, status `'ready'`; else status `'idle'` until `generate()` is called (or auto-trigger per the design). `generate()` calls `buildClientMap`, stores via `setMap`, sets status. Mirror the `GlanceStatus` machine in MatterHub.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/matters/useClientMap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const buildMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/generator', () => ({ buildClientMap: buildMock }));

import { useClientMap } from '@/features/matters/useClientMap';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => { useClientMapStore.setState({ maps: {} }); buildMock.mockReset(); });

describe('useClientMap', () => {
  it('serves a cached map immediately as ready', () => {
    useClientMapStore.getState().setMap('m1', { ...emptyClientMap('m1'), lastBuiltAt: 't' });
    const { result } = renderHook(() => useClientMap('m1'));
    expect(result.current.status).toBe('ready');
  });

  it('generate() builds, stores, and becomes ready', async () => {
    const built = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    built.sections[0].items.push({ id: 'i', text: 'x', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
    buildMock.mockResolvedValue(built);
    const { result } = renderHook(() => useClientMap('m1'));
    await act(async () => { await result.current.generate(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(useClientMapStore.getState().getMap('m1')?.sections[0].items.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/matters/useClientMap.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Write minimal implementation** — the hook (states + generate); then in `MatterHub.tsx` add a `data-testid="hub-panel-clientmap"` card whose action opens the Client Map view for `matterId` (render `<ClientMapView>` inside the matter view, gated by the hook's status; show a one-line empty state when `status === 'empty'`, an on-device note when `isLocalOnlyMode()`). Pass `onOpenSource` (resolve and open the cited file/email) and `onEditItem` (an inline edit that calls `useClientMapStore`'s `editItem`) into `ClientMapView`. Keep the existing four panels and at-a-glance unchanged.

```ts
// src/features/matters/useClientMap.ts
import { useCallback, useState } from 'react';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildClientMap } from '@/platform/clientMap/generator';
import type { ClientMap } from '@/platform/clientMap/types';

export type ClientMapStatus = 'idle' | 'generating' | 'ready' | 'empty' | 'error';

export function useClientMap(matterId: string): {
  status: ClientMapStatus; map: ClientMap | undefined; generate: () => Promise<void>;
} {
  const map = useClientMapStore((s) => s.maps[matterId]);
  const setMap = useClientMapStore((s) => s.setMap);
  const [status, setStatus] = useState<ClientMapStatus>(map ? 'ready' : 'idle');
  const generate = useCallback(async () => {
    setStatus('generating');
    try {
      const built = await buildClientMap(matterId);
      setMap(matterId, built);
      const hasContent = built.sections.some((s) => s.items.length > 0);
      setStatus(hasContent ? 'ready' : 'empty');
    } catch {
      setStatus('error');
    }
  }, [matterId, setMap]);
  return { status: map ? 'ready' : status, map, generate };
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/matters/useClientMap.test.ts` — Expected: PASS (2 tests). Then `npm run typecheck` (expect 0) for the MatterHub edit.
- [ ] **Step 5: Commit**

```bash
git add src/features/matters/useClientMap.ts src/features/matters/MatterHub.tsx tests/unit/matters/useClientMap.test.ts
git commit -m "feat(clientMap): useClientMap hook + Client Map entry in the matter hub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Approve-first updates (`src/platform/clientMap/` + `src/features/matters/`)

### Task D1: The updater — fingerprint + propose (no mutation)

**Files:**
- Create: `src/platform/clientMap/updater.ts`
- Test: `tests/unit/clientMap/updater.test.ts`

**Interfaces:**
- Consumes: `MemoryService.retrieve`, types from `./types`.
- Produces:
  - `computeSourceFingerprint(matterId: string): Promise<string>` — a cheap, stable hash over the matter's current indexed set. v1: run one broad matter-scoped retrieval (`'*'`-style broad query, `topK` large), collect the unique `sourceId ?? path` values, sort, and hash `count + joined ids`. (Deterministic for the same indexed set; changes when files are added/removed.)
  - `proposeUpdates(matterId: string, current: ClientMap, built: ClientMap): ProposedUpdate[]` — diff a freshly-built map against the current one and return `add` proposals for items whose text is not already present in the corresponding section. NEVER propose `change`/`remove` against an item with `origin: 'user'` (sovereign). Each proposal carries the built item as `draft` (so its sources ride along) and a short `reason`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clientMap/updater.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const retrieveMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({ MemoryService: { retrieve: retrieveMock }, isMemoryEnabled: () => true }));
import { computeSourceFingerprint, proposeUpdates } from '@/platform/clientMap/updater';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap, ClientMapItem } from '@/platform/clientMap/types';

const it1 = (text: string, origin: 'ai' | 'user' = 'ai'): ClientMapItem => ({ id: text, text, origin, isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
beforeEach(() => retrieveMock.mockReset());

describe('updater', () => {
  it('fingerprint changes when the indexed source set changes', async () => {
    retrieveMock.mockResolvedValueOnce([{ path: '/a', sourceId: '/a', chunkText: 'x', score: 1, paragraphIndex: 0 }]);
    const f1 = await computeSourceFingerprint('m1');
    retrieveMock.mockResolvedValueOnce([
      { path: '/a', sourceId: '/a', chunkText: 'x', score: 1, paragraphIndex: 0 },
      { path: '/b', sourceId: '/b', chunkText: 'y', score: 1, paragraphIndex: 0 },
    ]);
    const f2 = await computeSourceFingerprint('m1');
    expect(f1).not.toBe(f2);
  });

  it('proposes adds for new facts only and never touches user-origin items', () => {
    const current: ClientMap = { ...emptyClientMap('m1') };
    current.sections[2].items = [it1('Existing issue'), it1('My own note', 'user')];
    const built: ClientMap = { ...emptyClientMap('m1') };
    built.sections[2].items = [it1('Existing issue'), it1('A brand new issue'), it1('My own note')];
    const updates = proposeUpdates('m1', current, built);
    expect(updates.every((u) => u.op === 'add')).toBe(true);
    expect(updates.map((u) => u.draft?.text)).toContain('A brand new issue');
    expect(updates.map((u) => u.draft?.text)).not.toContain('Existing issue'); // already present
    expect(updates.map((u) => u.draft?.text)).not.toContain('My own note'); // user-origin, untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/clientMap/updater.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Write minimal implementation**

```ts
// src/platform/clientMap/updater.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import type { ClientMap, ProposedUpdate } from './types';

const BROAD_QUERY = 'client matter overview documents people dates issues';

export async function computeSourceFingerprint(matterId: string): Promise<string> {
  const hits = await MemoryService.retrieve(BROAD_QUERY, 200, { kind: 'matter', matterId }, false);
  const ids = Array.from(new Set(hits.map((h) => h.sourceId ?? h.path))).sort();
  return `${ids.length}:${ids.join('|')}`;
}

export function proposeUpdates(matterId: string, current: ClientMap, built: ClientMap): ProposedUpdate[] {
  const now = new Date().toISOString();
  const updates: ProposedUpdate[] = [];
  for (const builtSec of built.sections) {
    const curSec = current.sections.find((s) => s.key === builtSec.key);
    const existingText = new Set((curSec?.items ?? []).map((i) => i.text.trim().toLowerCase()));
    for (const item of builtSec.items) {
      if (existingText.has(item.text.trim().toLowerCase())) continue; // already present (incl. user-origin copies)
      updates.push({
        id: `${builtSec.key}-${updates.length}-${now}`,
        sectionKey: builtSec.key,
        op: 'add',
        draft: item,
        reason: 'Found in new or updated files for this client',
        createdAt: now,
      });
    }
  }
  return updates;
}
```

> Note (spec §7 Q1/Q2): v1 detects staleness on matter open and on an index-change event (debounced); no always-on background loop. `proposeUpdates` only adds (never silently rewrites) and never touches `origin: 'user'` items, satisfying the sovereignty rule. A future version can add `change`/`remove` proposals with stricter source-diffing.

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/clientMap/updater.test.ts` — Expected: PASS (2 tests).
- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/updater.ts tests/unit/clientMap/updater.test.ts
git commit -m "feat(clientMap): staleness fingerprint + add-only update proposals (sovereign edits safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task D2: Review-tray UI (marker + accept / edit / dismiss)

**Files:**
- Create: `src/features/matters/ClientMapUpdatesTray.tsx`
- Test: `tests/unit/matters/ClientMapUpdatesTray.test.tsx`

**Interfaces:**
- Consumes: `useClientMapStore` (`acceptUpdate`, `dismissUpdate`), `ProposedUpdate`.
- Produces: `ClientMapUpdatesTray({ matterId })`. Renders nothing when `pendingUpdates` is empty. Otherwise a `data-testid="clientmap-updates-marker"` showing the count, and a list of `data-testid="clientmap-update-row"`, each with the drafted text and three buttons: `clientmap-update-accept`, `clientmap-update-edit`, `clientmap-update-dismiss`. Accept calls `acceptUpdate(matterId, id)`; dismiss calls `dismissUpdate(matterId, id)`; edit reveals an input then calls `acceptUpdate(matterId, id, newText)`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/matters/ClientMapUpdatesTray.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientMapUpdatesTray } from '@/features/matters/ClientMapUpdatesTray';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  useClientMapStore.setState({ maps: { m1: m } });
  useClientMapStore.getState().setPendingUpdates('m1', [
    { id: 'u1', sectionKey: 'standing', op: 'add', draft: { id: 'd1', text: 'New filing due', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' }, reason: 'r', createdAt: 't' },
  ]);
});

describe('ClientMapUpdatesTray', () => {
  it('shows the marker and accepting applies the update', () => {
    render(<ClientMapUpdatesTray matterId="m1" />);
    expect(screen.getByTestId('clientmap-updates-marker')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('clientmap-update-accept'));
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.sections.find((s) => s.key === 'standing')!.items.map((i) => i.text)).toContain('New filing due');
    expect(map.pendingUpdates).toHaveLength(0);
  });

  it('dismiss drops the update without applying it', () => {
    render(<ClientMapUpdatesTray matterId="m1" />);
    fireEvent.click(screen.getByTestId('clientmap-update-dismiss'));
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.pendingUpdates).toHaveLength(0);
    expect(map.sections.find((s) => s.key === 'standing')!.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/matters/ClientMapUpdatesTray.test.tsx` — Expected: FAIL, module not found.
- [ ] **Step 3: Write minimal implementation** — render the marker + rows + buttons wired to the store actions (follow MatterHub styling; an inline edit input toggled by local state). Keep strings em-dash-free ("a few updates to review").
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/matters/ClientMapUpdatesTray.test.tsx` — Expected: PASS (2 tests).
- [ ] **Step 5: Commit**

```bash
git add src/features/matters/ClientMapUpdatesTray.tsx tests/unit/matters/ClientMapUpdatesTray.test.tsx
git commit -m "feat(clientMap): approve-first updates tray (accept/edit/dismiss)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase E — Custom categories + templates, levels 1-2 (`src/platform/clientMap/` + `src/features/matters/`)

### Task E1: Custom sections — generate from a user prompt + add UI

**Files:**
- Create: `src/platform/clientMap/customSection.ts`
- Modify: `src/platform/clientMap/clientMapStore.ts` (add `addCustomSection(matterId, section)` and `removeSection(matterId, sectionId)`)
- Create: `src/features/matters/AddCustomSectionForm.tsx`
- Test: `tests/unit/clientMap/customSection.test.ts`, `tests/unit/matters/AddCustomSectionForm.test.tsx`

**Interfaces:**
- Consumes: `MemoryService.retrieve`, `buildWorkspaceContextBlock`, `buildProviderForClientMap`, `sourceRefFromRagHit`, types.
- Produces:
  - `buildCustomSection(matterId, sectionId, title, prompt, options?): Promise<ClientMapSection>` — matter-scoped retrieval using `prompt` as the query; AI populate exactly like a core section; returns `{ id: sectionId, kind: 'custom', key: sectionId, title, prompt, scope: 'matter', items }`. Empty items when no content.
  - Store: `addCustomSection(matterId, section)` (appends the section), `removeSection(matterId, sectionId)`.

- [ ] **Step 1: Write the failing test** (logic)

```ts
// tests/unit/clientMap/customSection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
const retrieveMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({ MemoryService: { retrieve: retrieveMock }, isMemoryEnabled: () => true }));
vi.mock('@/platform/rag/workspaceCommand', () => ({ buildWorkspaceContextBlock: (h: RagHit[]) => (h.length ? '<workspace_context>c</workspace_context>' : '') }));
vi.mock('@/platform/clientMap/provider', () => ({ buildProviderForClientMap: async () => ({ sendMessage: sendMock, getMetadata: () => ({ model: 't' }) }) }));
import { buildCustomSection } from '@/platform/clientMap/customSection';

beforeEach(() => { retrieveMock.mockReset(); sendMock.mockReset(); });

describe('buildCustomSection', () => {
  it('retrieves matter-scoped using the prompt and returns a sourced custom section', async () => {
    retrieveMock.mockResolvedValue([{ path: '/policy.pdf', sourceId: '/policy.pdf', chunkText: 'limit 1M', score: 1, paragraphIndex: 0, id: 'c1' } as RagHit]);
    sendMock.mockResolvedValue({ content: JSON.stringify({ items: [{ text: 'Coverage limit is 1M', sourceNumbers: [1], assumption: false }] }) });
    const sec = await buildCustomSection('m1', 'sec-uuid', 'Insurance coverage', 'track the insurance coverage limits');
    expect((retrieveMock.mock.calls[0][2] as RetrievalScope)).toEqual({ kind: 'matter', matterId: 'm1' });
    expect(sec.kind).toBe('custom');
    expect(sec.title).toBe('Insurance coverage');
    expect(sec.items[0].sources[0].ref).toBe('/policy.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/clientMap/customSection.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Write minimal implementation** — `buildCustomSection` reuses the same parse + `itemsFromRaw` logic as the generator (extract those two helpers into a shared `src/platform/clientMap/aiSection.ts` and import from both `generator.ts` and `customSection.ts` — DRY; update Task B3's imports accordingly during this task). The store gains `addCustomSection`/`removeSection` mirroring the existing immutable-update style. The form collects a title + a plain-language description and on submit calls `addCustomSection(matterId, { ...empty })` then triggers `buildCustomSection` and stores the result.

```ts
// src/platform/clientMap/aiSection.ts  (extracted shared helpers)
import type { RagHit } from '@/platform/utils/tauri-commands';
import { sourceRefFromRagHit } from './types';
import type { ClientMapItem } from './types';
export interface RawItem { text: string; sourceNumbers: number[]; assumption: boolean }
export function parseItems(content: string): RawItem[] { /* move the generator's parseItems body here verbatim */ return []; }
export function itemsFromRaw(raw: RawItem[], hits: RagHit[]): ClientMapItem[] { /* move generator's itemsFromRaw body here verbatim */ return []; }
export const aiSectionPrompt = (title: string, ctx: string): string =>
  `You are a private legal assistant building a client profile section: "${title}".\n${ctx}\nReturn ONLY JSON (no fences): {"items":[{"text":"one short factual sentence","sourceNumbers":[1],"assumption":false}]}. Cite supporting [N] numbers; if you infer without a source set assumption true and sourceNumbers []; under 20 words each; no em dashes; empty items if nothing applies.`;
```

```ts
// src/platform/clientMap/customSection.ts
import { MemoryService } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { buildProviderForClientMap } from './provider';
import { parseItems, itemsFromRaw, aiSectionPrompt } from './aiSection';
import type { ClientMapSection } from './types';

export async function buildCustomSection(
  matterId: string, sectionId: string, title: string, prompt: string,
): Promise<ClientMapSection> {
  const hits = await MemoryService.retrieve(prompt, 8, { kind: 'matter', matterId }, false);
  const base: ClientMapSection = { id: sectionId, kind: 'custom', key: sectionId, title, prompt, scope: 'matter', items: [] };
  if (hits.length === 0) return base;
  const provider = await buildProviderForClientMap();
  const res = await provider.sendMessage('Build this section.', { systemPrompt: aiSectionPrompt(title, buildWorkspaceContextBlock(hits)), maxTokens: 500 });
  return { ...base, items: itemsFromRaw(parseItems(res.content), hits) };
}
```

- [ ] **Step 4: Run tests to verify they pass** — Run: `npx vitest run tests/unit/clientMap/customSection.test.ts tests/unit/matters/AddCustomSectionForm.test.tsx` and re-run `tests/unit/clientMap/generator.test.ts` (DRY refactor must not regress it). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/customSection.ts src/platform/clientMap/aiSection.ts src/platform/clientMap/generator.ts src/platform/clientMap/clientMapStore.ts src/features/matters/AddCustomSectionForm.tsx tests/unit/clientMap/customSection.test.ts tests/unit/matters/AddCustomSectionForm.test.tsx
git commit -m "feat(clientMap): user-defined custom sections, AI-populated from matter content

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task E2: Templates store + save/apply (personal reuse, level 2)

**Files:**
- Create: `src/platform/clientMap/templatesStore.ts`
- Create: `src/features/matters/ClientMapTemplates.tsx`
- Test: `tests/unit/clientMap/templatesStore.test.ts`

**Interfaces:**
- Produces:
  - `useTemplatesStore` (single-key persist `keepance:client-map-templates`, `templates: Record<string, CustomCategoryTemplate>`), actions: `saveTemplate(title, prompt): CustomCategoryTemplate` (scope `'personal-template'`), `deleteTemplate(id)`, `listTemplates(): CustomCategoryTemplate[]`.
  - `applyTemplateToMatter(templateId, matterId): Promise<void>` — looks up the template, calls `buildCustomSection(matterId, newId, template.title, template.prompt)`, and `addCustomSection`. (Lives in `templatesStore.ts` or a small `applyTemplate.ts`; either is fine.)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clientMap/templatesStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTemplatesStore } from '@/platform/clientMap/templatesStore';

beforeEach(() => { useTemplatesStore.setState({ templates: {} }); });

describe('templatesStore', () => {
  it('saves, lists, and deletes a personal template', () => {
    const t = useTemplatesStore.getState().saveTemplate('Settlement posture', 'track settlement offers and our position');
    expect(t.scope).toBe('personal-template');
    expect(useTemplatesStore.getState().listTemplates().map((x) => x.title)).toContain('Settlement posture');
    useTemplatesStore.getState().deleteTemplate(t.id);
    expect(useTemplatesStore.getState().listTemplates()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/clientMap/templatesStore.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Write minimal implementation** — standard single-key persisted Zustand store (mirror A2's persist config with `name: 'keepance:client-map-templates'`); ids via a simple counter/`crypto.randomUUID()` wrapper used elsewhere in the repo. `ClientMapTemplates.tsx` lists templates with an "apply to this matter" button and a "save this section as a template" affordance (wired from a custom section's menu). data-testids: `clientmap-template-row`, `clientmap-template-apply`, `clientmap-template-save`.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/clientMap/templatesStore.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/templatesStore.ts src/features/matters/ClientMapTemplates.tsx tests/unit/clientMap/templatesStore.test.ts
git commit -m "feat(clientMap): personal reusable custom-category templates (level 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase F — Guided Client Interview (`src/platform/clientMap/` + `src/features/matters/`)

### Task F1: Interview logic — answer fills the map, flag builds the client list

**Files:**
- Create: `src/platform/clientMap/guidedInterview.ts`
- Modify: `src/platform/clientMap/clientMapStore.ts` (add `addUserItem(matterId, sectionKey, text)`, a `clientQuestions: Record<string, ClientQuestion[]>` slice with `addClientQuestion`, `removeClientQuestion`, `getClientQuestions`)
- Test: `tests/unit/clientMap/guidedInterview.test.ts`

**Interfaces:**
- Produces:
  - `interviewQuestions(map: ClientMap): string[]` — the ordered gaps, `map.completeness.ask` first (plus any empty custom sections' prompts).
  - `answerQuestion(matterId, sectionKey, text)` — adds a `ClientMapItem` with `origin: 'user'`, `isAssumption: false`, `sources: []` to that section (default section `'standing'` when the question is not section-specific).
  - `flagForClient(matterId, question)` — adds a `ClientQuestion` to the matter's list.
  - Store: `addUserItem`, `addClientQuestion`, `removeClientQuestion`, `getClientQuestions`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clientMap/guidedInterview.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { interviewQuestions, answerQuestion, flagForClient } from '@/platform/clientMap/guidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  m.completeness = { level: 'thin', know: [], assuming: [], ask: ['What is the trial date?', 'Who is the adjuster?'] };
  useClientMapStore.setState({ maps: { m1: m }, clientQuestions: {} } as never);
});

describe('guidedInterview', () => {
  it('lists the gap questions', () => {
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(interviewQuestions(map)).toEqual(['What is the trial date?', 'Who is the adjuster?']);
  });
  it('answering creates a sovereign (user-origin) item', () => {
    answerQuestion('m1', 'upcoming', 'Trial is set for March 3');
    const item = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'upcoming')!.items[0];
    expect(item.text).toBe('Trial is set for March 3');
    expect(item.origin).toBe('user');
  });
  it('flagging adds a question to the client list', () => {
    flagForClient('m1', 'Who is the adjuster?');
    expect(useClientMapStore.getState().getClientQuestions('m1').map((q) => q.text)).toContain('Who is the adjuster?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/clientMap/guidedInterview.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Write minimal implementation** — `guidedInterview.ts` thin functions over the store actions; add the store actions + `clientQuestions` slice (persist it under the existing `keepance:client-maps` partialize, or keep ephemeral — persist it, since the client-question list is real work product). `addUserItem` appends an item with `origin:'user'`, `isAssumption:false`, `updatedAt: now`.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/clientMap/guidedInterview.test.ts` — Expected: PASS (3 tests).
- [ ] **Step 5: Commit**

```bash
git add src/platform/clientMap/guidedInterview.ts src/platform/clientMap/clientMapStore.ts tests/unit/clientMap/guidedInterview.test.ts
git commit -m "feat(clientMap): guided interview logic (answer fills map, flag builds client list)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F2: Guided Interview UI + in-map quick buttons + client-questions list

**Files:**
- Create: `src/features/matters/GuidedInterview.tsx`, `src/features/matters/ClientQuestionsList.tsx`
- Modify: `src/features/matters/ClientMapView.tsx` (add inline "I know this" / "ask the client" buttons on each `ask` question)
- Test: `tests/unit/matters/GuidedInterview.test.tsx`

**Interfaces:**
- Consumes: `interviewQuestions`, `answerQuestion`, `flagForClient` (F1), `useClientMapStore`.
- Produces: `GuidedInterview({ matterId, onClose })` — a one-question-at-a-time flow; each question shows an answer input (`data-testid="clientmap-interview-answer"`) that calls `answerQuestion` and advances, and a `data-testid="clientmap-interview-flag"` button that calls `flagForClient` and advances. `ClientQuestionsList({ matterId })` renders the flagged questions (`data-testid="clientmap-client-questions"`). The in-map quick buttons reuse the same two actions on the `ask` list.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/matters/GuidedInterview.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  m.completeness = { level: 'thin', know: [], assuming: [], ask: ['What is the trial date?'] };
  useClientMapStore.setState({ maps: { m1: m }, clientQuestions: {} } as never);
});

describe('GuidedInterview', () => {
  it('answering a question fills the map as a user-origin item', () => {
    render(<GuidedInterview matterId="m1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('clientmap-interview-answer'), { target: { value: 'March 3' } });
    fireEvent.click(screen.getByTestId('clientmap-interview-submit'));
    const items = useClientMapStore.getState().getMap('m1')!.sections.flatMap((s) => s.items);
    expect(items.some((i) => i.text === 'March 3' && i.origin === 'user')).toBe(true);
  });

  it('flagging adds it to the client questions list', () => {
    render(<GuidedInterview matterId="m1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('clientmap-interview-flag'));
    expect(useClientMapStore.getState().getClientQuestions('m1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/matters/GuidedInterview.test.tsx` — Expected: FAIL, module not found.
- [ ] **Step 3: Write minimal implementation** — the walk-through component (local index state over `interviewQuestions(map)`, an input + submit + flag, advancing to the next; "all caught up" empty state), the `ClientQuestionsList`, and the in-map quick buttons. All strings em-dash-free.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/matters/GuidedInterview.test.tsx` — Expected: PASS (2 tests).
- [ ] **Step 5: Commit**

```bash
git add src/features/matters/GuidedInterview.tsx src/features/matters/ClientQuestionsList.tsx src/features/matters/ClientMapView.tsx tests/unit/matters/GuidedInterview.test.tsx
git commit -m "feat(clientMap): Guided Client Interview UI + client questions list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done criteria & phase ordering

**Build order:** A1 → A2 → B1 → B2 → B3 → C1 → C2 → D1 → D2 → E1 → E2 → F1 → F2. Phases A and B have no UI and are the foundation; C makes it visible; D/E/F are independent of each other once C lands (D = updates, E = custom/templates, F = interview), so they may be built in any order or in parallel worktrees.

**Per task:** the task's own `vitest` file passes, then `npm run typecheck` = 0. **End of each phase:** `npx vitest run` (no regressions) + `node scripts/eslint-gate.mjs` + the no-em-dash test. **Before any merge/PR:** `npm run gate`.

**Definition of done for v1 (maps to spec §2/§3/§6):**
- A matter shows a saved Client Map with the five core sections, every AI item sourced or flagged as an assumption, plus the "What I'm missing" block with the coarse level (no percentage). [A, B, C]
- The map is matter-scoped only (a test asserts retrieval is always `{ kind: 'matter' }`). [B3, isolation test]
- On a personal install with no cloud key, generation runs on-device (a test asserts Local-only forces Ollama). [B1]
- New content yields proposed updates the user accepts/edits/dismisses; user-origin items are never overwritten. [D1, D2]
- The user can add a custom section the AI populates, and save/apply it as a personal template. [E1, E2]
- The Guided Interview walks the gaps; answering fills the map (user-origin), flagging builds the client-questions list. [F1, F2]

**Explicitly deferred to v2 (do NOT build here):** Firm Philosophy / firm-wide categories (level 3), the advisor "household" unit, timeline / communication-style / prior-advice sections, and any change to firm-tier behavior.
