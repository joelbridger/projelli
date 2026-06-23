// src/platform/clientMap/clientMapStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ClientMap, ClientMapSection, ClientQuestion, ProposedUpdate, GapQuestion } from './types';

interface ClientMapState {
  maps: Record<string, ClientMap>;
  clientQuestions: Record<string, ClientQuestion[]>;
  getMap: (matterId: string) => ClientMap | undefined;
  setMap: (matterId: string, map: ClientMap) => void;
  editItem: (matterId: string, sectionKey: string, itemId: string, text: string) => void;
  removeItem: (matterId: string, sectionKey: string, itemId: string) => void;
  addUserItem: (matterId: string, sectionKey: string, text: string) => void;
  addCustomSection: (matterId: string, section: ClientMapSection) => void;
  removeSection: (matterId: string, sectionId: string) => void;
  setPendingUpdates: (matterId: string, updates: ProposedUpdate[]) => void;
  acceptUpdate: (matterId: string, updateId: string, override?: string) => void;
  dismissUpdate: (matterId: string, updateId: string) => void;
  addClientQuestion: (matterId: string, text: string) => void;
  removeClientQuestion: (matterId: string, id: string) => void;
  getClientQuestions: (matterId: string) => ClientQuestion[];
  invalidate: (matterId: string) => void;
  clearAll: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Persisted (partialized) shape of this store. */
interface PersistedClientMapState {
  maps?: Record<string, ClientMap>;
  clientQuestions?: Record<string, ClientQuestion[]>;
}

/**
 * v1 -> v2 migration: `completeness.ask` was a plain string[]; tag each gap
 * question with a target section so the Guided Interview can file answers
 * correctly. Maps saved before this change would otherwise render blank gap text
 * and silently drop answers (no sectionKey). Pure + exported so it is unit-tested.
 */
/** Coerce one untrusted persisted gap-question entry into a GapQuestion, or null
 *  if it carries no usable text. A plain string keeps its text; an object keeps a
 *  string text and a string sectionKey, defaulting the section to 'standing'. */
function coerceGapQuestion(q: unknown): GapQuestion | null {
  if (typeof q === 'string') {
    const text = q.trim();
    return text ? { text, sectionKey: 'standing' } : null;
  }
  if (q && typeof q === 'object') {
    const rawText = (q as { text?: unknown }).text;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) return null;
    const rawKey = (q as { sectionKey?: unknown }).sectionKey;
    const sectionKey = typeof rawKey === 'string' && rawKey ? rawKey : 'standing';
    return { text, sectionKey };
  }
  return null;
}

export function migratePersistedClientMaps(persisted: unknown, version: number): PersistedClientMapState {
  const state = (persisted ?? {}) as PersistedClientMapState;
  if (version < 2 && state.maps) {
    // Persisted JSON is untrusted: guard each map and each question shape, and
    // fail soft (drop) anything malformed rather than throw or pass it through.
    for (const map of Object.values(state.maps) as Array<{ completeness?: { ask?: unknown } } | null | undefined>) {
      const completeness = map?.completeness;
      if (!completeness || !Array.isArray(completeness.ask)) continue;
      completeness.ask = (completeness.ask as unknown[])
        .map(coerceGapQuestion)
        .filter((q): q is GapQuestion => q !== null);
    }
  }
  return state;
}

export const useClientMapStore = create<ClientMapState>()(
  persist(
    (set, get) => ({
      maps: {},
      clientQuestions: {},
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
      addUserItem: (matterId, sectionKey, text) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          const newItem = {
            id: `user-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
            text,
            origin: 'user' as const,
            isAssumption: false,
            sources: [],
            updatedAt: nowIso(),
          };
          const sections = map.sections.map((sec) =>
            sec.key !== sectionKey ? sec : { ...sec, items: [...sec.items, newItem] },
          );
          return { maps: { ...s.maps, [matterId]: { ...map, sections } } };
        }),
      addCustomSection: (matterId, section) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          return { maps: { ...s.maps, [matterId]: { ...map, sections: [...map.sections, section] } } };
        }),
      removeSection: (matterId, sectionId) =>
        set((s) => {
          const map = s.maps[matterId];
          if (!map) return {};
          return { maps: { ...s.maps, [matterId]: { ...map, sections: map.sections.filter((sec) => sec.id !== sectionId) } } };
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
            if (upd.op === 'change' && override === undefined) {
              // AI-driven change (no user override) targeting a user-origin item is blocked.
              const targetItem = map.sections
                .find((sec) => sec.key === upd.sectionKey)
                ?.items.find((it) => it.id === upd.itemId);
              if (targetItem?.origin === 'user') {
                // Refuse the AI change but still clear the pending proposal.
                return {
                  maps: {
                    ...s.maps,
                    [matterId]: { ...map, pendingUpdates: map.pendingUpdates.filter((u) => u.id !== updateId) },
                  },
                };
              }
            }
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
            // AI-driven remove targeting a user-origin item is blocked.
            const targetItem = map.sections
              .find((sec) => sec.key === upd.sectionKey)
              ?.items.find((it) => it.id === upd.itemId);
            if (targetItem?.origin === 'user') {
              return {
                maps: {
                  ...s.maps,
                  [matterId]: { ...map, pendingUpdates: map.pendingUpdates.filter((u) => u.id !== updateId) },
                },
              };
            }
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
      addClientQuestion: (matterId, text) =>
        set((s) => {
          const existing = s.clientQuestions[matterId] ?? [];
          const newQ = {
            id: `cq-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
            text,
          };
          return { clientQuestions: { ...s.clientQuestions, [matterId]: [...existing, newQ] } };
        }),
      removeClientQuestion: (matterId, id) =>
        set((s) => {
          const existing = s.clientQuestions[matterId] ?? [];
          return { clientQuestions: { ...s.clientQuestions, [matterId]: existing.filter((q) => q.id !== id) } };
        }),
      getClientQuestions: (matterId) => get().clientQuestions[matterId] ?? [],
      invalidate: (matterId) =>
        set((s) => {
          const { [matterId]: _drop, ...rest } = s.maps;
          return { maps: rest };
        }),
      clearAll: () => set({ maps: {}, clientQuestions: {} }),
    }),
    {
      name: 'keepance:client-maps',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ maps: state.maps, clientQuestions: state.clientQuestions }),
      migrate: (persisted, version) =>
        migratePersistedClientMaps(persisted, version) as unknown as ClientMapState,
    },
  ),
);

/** Non-reactive accessor for use outside React renders (mirrors getMatters()). */
export function getClientMap(matterId: string): ClientMap | undefined {
  return useClientMapStore.getState().maps[matterId];
}
