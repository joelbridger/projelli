import { create } from 'zustand';

/**
 * The intentionally small selection doorway for future, separately-owned
 * directory actions. This state is in memory only: it is never persisted and
 * therefore has no reload guarantee.
 */
export interface BulkSelectionContract {
  /** Household ids currently selected from the accessible CRM directory. */
  readonly selectedHouseholdIds: readonly string[];
  /** Read-only derived number of selected household ids. */
  readonly selectedCount: number;
  /** Adds or removes one accessible household id. */
  toggleHousehold(id: string): void;
  /** Adds every id that is visible in the current directory result. */
  selectVisibleHouseholds(ids: readonly string[]): void;
  /** Adds every id currently available in the loaded directory. */
  selectAllHouseholds(ids: readonly string[]): void;
  /** Removes every selected household id. */
  clearSelection(): void;
  /** Drops ids which are no longer available from the loaded directory. */
  reconcileSelection(availableIds: readonly string[]): void;
}

function uniqueIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

function withSelectedIds(ids: readonly string[]) {
  return {
    selectedHouseholdIds: ids,
    selectedCount: ids.length,
  };
}

const useBulkSelectionStore = create<BulkSelectionContract>((set) => ({
  ...withSelectedIds([]),
  toggleHousehold: (id) => {
    if (!id) return;
    set((state) => {
      const selected = new Set(state.selectedHouseholdIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return withSelectedIds([...selected]);
    });
  },
  selectVisibleHouseholds: (ids) => {
    set((state) =>
      withSelectedIds(uniqueIds([...state.selectedHouseholdIds, ...ids]))
    );
  },
  selectAllHouseholds: (ids) => {
    set((state) =>
      withSelectedIds(uniqueIds([...state.selectedHouseholdIds, ...ids]))
    );
  },
  clearSelection: () => {
    set((state) => (state.selectedCount === 0 ? state : withSelectedIds([])));
  },
  reconcileSelection: (availableIds) => {
    const available = new Set(availableIds);
    set((state) => {
      const next = state.selectedHouseholdIds.filter((id) => available.has(id));
      return next.length === state.selectedHouseholdIds.length
        ? state
        : withSelectedIds(next);
    });
  },
}));

/**
 * Subscribe to the CRM directory selection contract. Import only from this
 * package's public index; the Zustand store and its implementation stay private.
 */
export function useBulkSelection(): BulkSelectionContract {
  return useBulkSelectionStore();
}
