import type { FlagDescriptor } from './registry';

/** Returns every registry entry whose UTC expiry day has already ended. */
export function getExpiredFlags(
  flags: readonly FlagDescriptor[],
  now: Date = new Date()
): readonly FlagDescriptor[] {
  const today = now.toISOString().slice(0, 10);
  return flags.filter((flag) => flag.expiresAt < today);
}

export function expiredFlagMessage(flags: readonly FlagDescriptor[]): string {
  return [
    'Feature flags past their expiry date:',
    ...flags.map(
      (flag) =>
        `- ${flag.id} (owner: ${flag.ownerLane}, expired: ${flag.expiresAt})`
    ),
    'Extend deliberately with a documented reason, or remove the flag and its guarded code.',
  ].join('\n');
}
