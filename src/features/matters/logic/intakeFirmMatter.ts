/**
 * Intake key grants are addressed to the relay's firm matter id, never the
 * local Zustand id. A local-only matter can still create an intake safely; its
 * key is published once it is promoted.
 */
export function firmMatterIdForIntakeSharing(
  matter: { shared?: boolean; firmMatterId?: string } | undefined,
): string | null {
  return matter?.shared && matter.firmMatterId ? matter.firmMatterId : null;
}
