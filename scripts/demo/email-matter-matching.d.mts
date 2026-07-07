/** Types for the demo email→client matching helpers (used by the unit test;
 *  the .mjs stays plain JS because the populate script runs it with node). */
export function nameTokens(value: string): string[];
export function matchMatterIdForSender(
  fromName: string,
  matters: ReadonlyArray<{ id: string; name: string; client: string }>,
): string | null;
