// src/platform/clientMap/clientMapStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ClientMap, ClientMapSection, ClientQuestion, DismissedSignature, ProposedUpdate, GapQuestion, CoreSectionKey } from './types';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from './types';
import { proposalSignature } from './updater';

/** v2 -> v3: the 5 core section keys were renamed to 4 sharper buckets (and the
 *  dated-events "Coming up" bucket was folded into Follow-ups). Remap any legacy
 *  key so persisted maps keep their content after the rename. */
const LEGACY_SECTION_KEY_MAP: Record<string, string> = {
  people: 'household',
  story: 'goals',
  standing: 'money',
  upcoming: 'followups',
  next: 'followups',
};
function remapSectionKey(k: string): string {
  return LEGACY_SECTION_KEY_MAP[k] ?? k;
}

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
  markGapResolved: (matterId: string, gapText: string) => void;
  invalidate: (matterId: string) => void;
  clearAll: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Normalize a question/gap text for dedup + resolved tracking (BUG-106). */
function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
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
    return text ? { text, sectionKey: 'money' } : null;
  }
  if (q && typeof q === 'object') {
    const rawText = (q as { text?: unknown }).text;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) return null;
    const rawKey = (q as { sectionKey?: unknown }).sectionKey;
    const sectionKey = remapSectionKey(typeof rawKey === 'string' && rawKey ? rawKey : 'money');
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
  if (version < 3 && state.maps) {
    // The 5 core section keys were renamed to 4. Remap legacy keys so persisted
    // maps keep their content, MERGING the two buckets that fold into Follow-ups
    // (upcoming + next) by concatenating their items.
    for (const map of Object.values(state.maps) as Array<ClientMap | null | undefined>) {
      if (!map) continue;
      if (Array.isArray(map.sections)) {
        const mergedCore = new Map<string, ClientMapSection>();
        const customs: ClientMapSection[] = [];
        for (const sec of map.sections) {
          if (sec.kind === 'core') {
            const newKey = remapSectionKey(sec.key);
            const existing = mergedCore.get(newKey);
            if (existing) {
              existing.items = [...existing.items, ...sec.items];
            } else {
              mergedCore.set(newKey, {
                ...sec,
                key: newKey,
                id: newKey,
                title: CORE_SECTION_TITLE[newKey as CoreSectionKey] ?? sec.title,
              });
            }
          } else {
            customs.push(sec);
          }
        }
        map.sections = [
          ...CORE_SECTION_ORDER.map((k) => mergedCore.get(k)).filter((s): s is ClientMapSection => s !== undefined),
          ...customs,
        ];
      }
      // Remap gap + pending-update section keys onto the new bucket names.
      const ask = map.completeness?.ask;
      if (Array.isArray(ask)) {
        for (const g of ask as Array<{ sectionKey?: unknown }>) {
          if (g && typeof g.sectionKey === 'string') g.sectionKey = remapSectionKey(g.sectionKey);
        }
      }
      if (Array.isArray(map.pendingUpdates)) {
        for (const p of map.pendingUpdates as Array<{ sectionKey?: unknown }>) {
          if (p && typeof p.sectionKey === 'string') p.sectionKey = remapSectionKey(p.sectionKey);
        }
      }
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
      // B5 (approve-first): do NOT auto-apply any AI updates — even "safe adds".
      // Every proposed change stays in pendingUpdates until the user approves it,
      // honoring the approve-first promise (AI proposes, user decides).
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
          // B5 (approve-first): updates are queued for approval, never auto-applied.
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
          const upd = map.pendingUpdates.find((u) => u.id === updateId);
          if (!upd) return {};
          // BUG-100: record the dismissal so the same proposal is not re-issued
          // on the next pass unless its backing source changes. Keyed by the
          // stable signature + the source fingerprint at dismissal time. De-dup
          // only the EXACT (signature, sourceSignature) pair, so dismissing the
          // same text from a different source does not erase an earlier dismissal.
          const signature = upd.signature ?? proposalSignature(upd.sectionKey, upd.op, upd.draft?.text ?? '');
          const sourceSignature = upd.sourceSignature ?? '';
          const existing = (map.dismissedSignatures ?? []).filter(
            (d) => !(d.signature === signature && d.sourceSignature === sourceSignature),
          );
          const dismissedSignatures: DismissedSignature[] = [
            ...existing,
            { signature, sourceSignature, dismissedAt: nowIso() },
          ];
          return {
            maps: {
              ...s.maps,
              [matterId]: {
                ...map,
                pendingUpdates: map.pendingUpdates.filter((u) => u.id !== updateId),
                dismissedSignatures,
              },
            },
          };
        }),
      addClientQuestion: (matterId, text) =>
        set((s) => {
          const existing = s.clientQuestions[matterId] ?? [];
          // BUG-106: dedup by normalized text so flagging the same gap twice does
          // not create duplicate "Questions for the client" rows.
          const norm = normalizeQuestion(text);
          if (existing.some((q) => normalizeQuestion(q.text) === norm)) return {};
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
      markGapResolved: (matterId, gapText) =>
        set((s) => {
          // BUG-106: record that the user answered/flagged this gap so the Guided
          // Interview does not replay it. Stored normalized on the matter's map.
          const map = s.maps[matterId];
          if (!map) return {};
          const norm = normalizeQuestion(gapText);
          if (!norm) return {};
          const resolved = map.resolvedGaps ?? [];
          if (resolved.includes(norm)) return {};
          return { maps: { ...s.maps, [matterId]: { ...map, resolvedGaps: [...resolved, norm] } } };
        }),
      invalidate: (matterId) =>
        set((s) => {
          const { [matterId]: _drop, ...rest } = s.maps;
          return { maps: rest };
        }),
      clearAll: () => set({ maps: {}, clientQuestions: {} }),
    }),
    {
      name: 'keepance:client-maps',
      version: 3,
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
