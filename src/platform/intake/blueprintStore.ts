import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { getBuiltInRequestBlueprint, listBuiltInRequestBlueprints } from './defaultBlueprints';
import {
  BlueprintValidationError,
  copyRequestBlueprintForPersistence,
} from './blueprintValidation';
import type {
  CreateFirmBlueprintInput,
  RequestBlueprint,
  UpdateFirmBlueprintInput,
} from './blueprintTypes';

/** Same workspace-local persistence tier as the rest of the advisor intake UI. */
export const INTAKE_BLUEPRINTS_STORAGE_KEY = 'lantern:intake-blueprints';

interface BlueprintStoreState {
  firmBlueprintsById: Record<string, RequestBlueprint>;
  createFirmBlueprint: (input: CreateFirmBlueprintInput) => RequestBlueprint;
  updateFirmBlueprint: (blueprintId: string, patch: UpdateFirmBlueprintInput) => RequestBlueprint;
  archiveFirmBlueprint: (blueprintId: string) => RequestBlueprint;
  getBlueprint: (blueprintId: string) => RequestBlueprint | undefined;
  listBlueprints: (includeArchived?: boolean) => RequestBlueprint[];
  resetForTests: () => void;
}

export interface PersistedBlueprintState {
  firmBlueprintsById: Record<string, RequestBlueprint>;
}

function isBuiltIn(blueprintId: string): boolean {
  return getBuiltInRequestBlueprint(blueprintId) !== undefined;
}

function requireMutableFirmBlueprint(
  state: Pick<BlueprintStoreState, 'firmBlueprintsById'>,
  blueprintId: string,
): RequestBlueprint {
  if (isBuiltIn(blueprintId)) {
    throw new BlueprintValidationError('Built-in blueprints cannot be changed or archived.');
  }
  const blueprint = state.firmBlueprintsById[blueprintId];
  if (!blueprint) throw new BlueprintValidationError('Firm blueprint was not found.');
  return blueprint;
}

export function partializeBlueprintStateForPersistence(
  state: Pick<BlueprintStoreState, 'firmBlueprintsById'>,
): PersistedBlueprintState {
  return {
    firmBlueprintsById: Object.fromEntries(
      Object.entries(state.firmBlueprintsById).map(([blueprintId, blueprint]) => [
        blueprintId,
        copyRequestBlueprintForPersistence({ ...blueprint, source: 'firm_saved' }),
      ]),
    ),
  };
}

export function sanitizePersistedBlueprintState(value: unknown): PersistedBlueprintState {
  const candidate = value as { firmBlueprintsById?: unknown } | null | undefined;
  if (!candidate?.firmBlueprintsById || typeof candidate.firmBlueprintsById !== 'object') {
    return { firmBlueprintsById: {} };
  }
  const entries = Object.entries(candidate.firmBlueprintsById as Record<string, unknown>)
    .flatMap(([blueprintId, raw]) => {
      try {
        const blueprint = raw as RequestBlueprint;
        if (blueprint.blueprintId !== blueprintId || isBuiltIn(blueprintId)) return [];
        return [[blueprintId, copyRequestBlueprintForPersistence({ ...blueprint, source: 'firm_saved' })] as const];
      } catch {
        return [];
      }
    });
  return { firmBlueprintsById: Object.fromEntries(entries) };
}

export const useBlueprintStore = create<BlueprintStoreState>()(
  persist<BlueprintStoreState, [], [], PersistedBlueprintState>(
    (set, get) => ({
      firmBlueprintsById: {},
      createFirmBlueprint: (input) => {
        if (isBuiltIn(input.blueprintId) || get().firmBlueprintsById[input.blueprintId]) {
          throw new BlueprintValidationError('Blueprint id is already in use.');
        }
        const blueprint = copyRequestBlueprintForPersistence({
          blueprintId: input.blueprintId,
          schemaVersion: input.schemaVersion ?? 1,
          label: input.label,
          source: 'firm_saved',
          defaultKind: input.defaultKind ?? 'standing',
          items: input.items,
        });
        set((state) => ({
          firmBlueprintsById: { ...state.firmBlueprintsById, [blueprint.blueprintId]: blueprint },
        }));
        return copyRequestBlueprintForPersistence(blueprint);
      },
      updateFirmBlueprint: (blueprintId, patch) => {
        const current = requireMutableFirmBlueprint(get(), blueprintId);
        const next = copyRequestBlueprintForPersistence({
          ...current,
          ...patch,
          blueprintId,
          source: 'firm_saved',
          ...(current.archived ? { archived: true } : {}),
        });
        set((state) => ({
          firmBlueprintsById: { ...state.firmBlueprintsById, [blueprintId]: next },
        }));
        return copyRequestBlueprintForPersistence(next);
      },
      archiveFirmBlueprint: (blueprintId) => {
        const current = requireMutableFirmBlueprint(get(), blueprintId);
        const archived = copyRequestBlueprintForPersistence({ ...current, archived: true, source: 'firm_saved' });
        set((state) => ({
          firmBlueprintsById: { ...state.firmBlueprintsById, [blueprintId]: archived },
        }));
        return copyRequestBlueprintForPersistence(archived);
      },
      getBlueprint: (blueprintId) => {
        const builtIn = getBuiltInRequestBlueprint(blueprintId);
        if (builtIn) return builtIn;
        const blueprint = get().firmBlueprintsById[blueprintId];
        return blueprint ? copyRequestBlueprintForPersistence(blueprint) : undefined;
      },
      listBlueprints: (includeArchived = false) => [
        ...listBuiltInRequestBlueprints(),
        ...Object.values(get().firmBlueprintsById)
          .filter((blueprint) => includeArchived || !blueprint.archived)
          .map(copyRequestBlueprintForPersistence),
      ],
      resetForTests: () => set({ firmBlueprintsById: {} }),
    }),
    {
      name: INTAKE_BLUEPRINTS_STORAGE_KEY,
      version: 1,
      partialize: partializeBlueprintStateForPersistence,
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedBlueprintState(persisted),
      }),
    },
  ),
);
