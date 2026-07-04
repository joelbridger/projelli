// src/platform/browserGuard/randomId.ts
//
// Shared by both TabWriteGuard (heartbeat) and WebLocksTabGuard: a random
// per-instance identifier, preferring crypto.randomUUID() and falling back
// to Math.random() for environments without it (very old browsers).

export function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}
