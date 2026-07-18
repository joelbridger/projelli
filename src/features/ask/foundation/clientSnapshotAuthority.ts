import type { AskClientSnapshot } from './contracts';

/**
 * This symbol is intentionally private.  The type carries it, but code outside
 * this module cannot name it to construct an authority-shaped snapshot.
 */
const askClientSnapshotBrand: unique symbol = Symbol('askClientSnapshot');
const sealedAskClientSnapshots = new WeakSet();

export type AskClientSnapshotAuthority = {
  readonly [askClientSnapshotBrand]: true;
};

function deepFreezeAuthority<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  // Freeze before descending.  No authority is ever observable as both sealed
  // and mutable, including nested ContactRef data.
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) {
      deepFreezeAuthority(descriptor.value);
    }
  }
  return value;
}

/**
 * Owner-only mint. This module is not re-exported from the Ask public surface;
 * the real shared-client owner is its sole production caller.
 */
export function mintAskClientSnapshot<ClientReference>(input: {
  readonly contactRef: ClientReference;
  readonly matterId: string;
  readonly revision: string;
}): AskClientSnapshot<ClientReference> {
  const snapshot = deepFreezeAuthority({
    contactRef: input.contactRef,
    matterId: input.matterId,
    revision: input.revision,
    [askClientSnapshotBrand]: true as const,
  }) as AskClientSnapshot<ClientReference>;
  sealedAskClientSnapshots.add(snapshot);
  return snapshot;
}

/**
 * Public intake code uses this alongside type checking. A cast can imitate the
 * type but cannot enter this module-private provenance seal.
 */
export function isGenuineAskClientSnapshot<ClientReference>(
  value: unknown
): value is AskClientSnapshot<ClientReference> {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<PropertyKey, unknown>)[askClientSnapshotBrand] === true &&
    sealedAskClientSnapshots.has(value)
  );
}
