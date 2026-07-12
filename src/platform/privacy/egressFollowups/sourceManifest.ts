import type { EgressSourceManifestEntry } from './types';

/**
 * CI-facing rule for every frontend fetch/WebSocket and native network client:
 * declare the registered operation and prove the durable receipt with a test.
 * The eventual ESLint/Rust scanner can feed this simple, deterministic check.
 */
export function validateSourceManifest(
  entries: readonly EgressSourceManifestEntry[],
  knownOperationIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (!knownOperationIds.has(entry.operationId)) {
      errors.push(`${entry.file}: operation "${entry.operationId}" is not registered`);
    }
    if (!entry.receiptTest) {
      errors.push(`${entry.file}: operation "${entry.operationId}" has no receipt test`);
    }
  }
  return errors;
}
