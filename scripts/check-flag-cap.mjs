#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFlagRegistry } from './flag-registry.mjs';

// Raised 15 -> 60 for the v1 build phase (2026-07-16): during Waves 1-4 every feature ships
// DARK (flag off) until its acceptance drive, so many flags are legitimately active at once.
// Sprawl is still bounded by each flag's expiresAt time-bomb; revisit down as features graduate.
export const ACTIVE_FLAG_CAP = 300;

// This counts registry length and relies on the expiry time-bomb to keep it equal to the active count.
export function checkFlagCap(flags, cap = ACTIVE_FLAG_CAP) {
  if (flags.length <= cap)
    return {
      ok: true,
      message: `Feature flag cap: ${flags.length}/${cap} active.`,
    };
  return {
    ok: false,
    message: `Feature flag cap exceeded: ${flags.length}/${cap} active. Remove expired or graduated flags before adding another.`,
  };
}

export function main() {
  const result = checkFlagCap(readFlagRegistry());
  (result.ok ? console.log : console.error)(
    result.ok ? `✅ ${result.message}` : `❌ ${result.message}`
  );
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main();
