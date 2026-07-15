/**
 * Append-only egress module registry.
 *
 * The whole-app egress catalogue is carved into per-domain operation slices.
 * This file is the ONE mount point: each slice is listed once, in order, and
 * the flattened result is the exact same operation surface the catalogue
 * exposed before the carve (proven by `egressParity.test.ts`).
 *
 * Rules for editing this file (see SKILL.md):
 *  - A domain owns its slice module beside this registry. Register the slice
 *    with one appended line; never reorder or delete existing entries.
 *  - This lane adds ZERO operations. A new operation is added by a feature lane
 *    inside its own slice, and it must extend the parity snapshot in the same
 *    change so the reviewer sees the intended surface delta explicitly.
 *  - `validateEgressModuleRegistry` rejects duplicate operation ids and any
 *    operation missing a required field; its test must stay green.
 */

import { additionalConnectorOperations } from './additionalConnectors';
import { assuredInferenceOperations } from './assuredInference';
import { calendarOperations } from './calendar';
import { crmOperations } from './crm';
import { externalClientOperations } from './externalClient';
import { fileStorageOperations } from './fileStorage';
import { mailOperations } from './mail';
import { offlineModeSinks } from './offlineModeSinks';
import { productMaintenanceOperations } from './productMaintenance';
import type { EgressOperation } from '../egressFollowups/types';

/** One registered per-domain slice. `domain` is a stable label for diagnostics. */
export interface EgressModule {
  readonly domain: string;
  readonly operations: readonly EgressOperation[];
}

/**
 * Append-only registry. Order is stable: existing entries are never reordered
 * during a feature wave, so the flattened operation order stays deterministic.
 */
export const EGRESS_MODULE_REGISTRY: readonly EgressModule[] = [
  { domain: 'offline-mode', operations: offlineModeSinks },
  { domain: 'mail', operations: mailOperations },
  { domain: 'calendar', operations: calendarOperations },
  { domain: 'crm', operations: crmOperations },
  { domain: 'file-storage', operations: fileStorageOperations },
  { domain: 'additional-connectors', operations: additionalConnectorOperations },
  { domain: 'assured-inference', operations: assuredInferenceOperations },
  { domain: 'product-maintenance', operations: productMaintenanceOperations },
  { domain: 'external-client', operations: externalClientOperations },
];

/** Flatten the registry into the whole-app operation list, in registry order. */
export function collectEgressOperations(
  registry: readonly EgressModule[] = EGRESS_MODULE_REGISTRY
): readonly EgressOperation[] {
  return registry.flatMap((module) => module.operations);
}

const REQUIRED_STRING_FIELDS = [
  'id',
  'category',
  'title',
  'approvalText',
  'dataSummary',
  'recipient',
] as const satisfies readonly (keyof EgressOperation)[];

/**
 * Structural gate for the registry. Returns a stable, human-readable list of
 * problems (empty when the registry is well-formed). It rejects:
 *  - a duplicate operation id anywhere across the slices;
 *  - a missing/empty required string field;
 *  - an empty `dataClasses` or `destination.allowedSchemes`;
 *  - an empty origin allowlist that is not a user-selected host (which would
 *    otherwise silently allow no destination, or hide a widened rule).
 * It never changes what an operation is allowed to do — it only refuses a
 * malformed registration.
 */
export function validateEgressModuleRegistry(
  registry: readonly EgressModule[] = EGRESS_MODULE_REGISTRY
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const module of registry) {
    for (const operation of module.operations) {
      const where = operation.id
        ? `${module.domain}/${operation.id}`
        : `${module.domain}/(missing id)`;

      for (const field of REQUIRED_STRING_FIELDS) {
        const value = operation[field];
        if (typeof value !== 'string' || value.trim().length === 0) {
          problems.push(`${where}: required field "${field}" is empty`);
        }
      }

      if (operation.id) {
        if (seen.has(operation.id)) {
          problems.push(`${where}: duplicate operation id "${operation.id}"`);
        }
        seen.add(operation.id);
      }

      if (operation.dataClasses.length === 0) {
        problems.push(`${where}: dataClasses must not be empty`);
      }

      const { allowedSchemes, allowedOrigins, userSelectedHost } =
        operation.destination;
      if (allowedSchemes.length === 0) {
        problems.push(`${where}: destination.allowedSchemes must not be empty`);
      }
      if (allowedOrigins.length === 0 && !userSelectedHost) {
        problems.push(
          `${where}: fixed-origin operation must list at least one allowed origin`
        );
      }
    }
  }

  return problems;
}
