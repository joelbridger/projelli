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
