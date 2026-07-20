/* -------------------------------------------------------------------------- *
 * CONTAINMENT (WB-085) — the viewer identity the file-backed meeting gate
 * judges against.
 *
 * Kept in its own module, injected rather than imported, for two reasons:
 *   1. `WorkspaceService` (platform/fs) must not pull the firm session store
 *      — and everything it transitively imports, including the firm API client
 *      — into every file read.
 *   2. Tests must be able to drive a specific viewer without standing up a
 *      real firm session.
 *
 * FAIL-CLOSED DEFAULT: until the app wires a resolver, the viewer is
 * UNRESOLVED, and unresolved refuses every piece of stamped meeting material
 * (see `classifyMeetingMaterialForViewer`). A missed wiring therefore shows up
 * as material that will not open — loud and safe — never as material that
 * silently opens for the wrong advisor.
 *
 * The viewer id is renderer session metadata and is deliberately
 * NON-AUTHORITATIVE, exactly as the pool-side containment notes: a renderer can
 * only ever tell us who it BELIEVES is signed in. The native permissions engine
 * (N3/N4/N5) replaces it with the real firm session. This gate raises the cost
 * of a shared-folder leak from "zero, by opening a synced folder" to "forge a
 * renderer session"; it is containment, not a cryptographic boundary.
 * -------------------------------------------------------------------------- */

export type MeetingMaterialViewerResolver = () => string | null;

let resolveViewer: MeetingMaterialViewerResolver | null = null;

/**
 * Wire the viewer resolver. Called by the app layer alongside the other
 * workspace-lifecycle wiring. Passing null restores the fail-closed default.
 */
export function setMeetingMaterialViewerResolver(
  resolver: MeetingMaterialViewerResolver | null
): void {
  resolveViewer = resolver;
}

/**
 * The current viewer's firm member id, or null when it cannot be resolved.
 * A resolver that throws is treated as UNRESOLVED — an exception must never
 * become an allow.
 */
export function currentMeetingMaterialViewer(): string | null {
  if (!resolveViewer) return null;
  try {
    const value = resolveViewer();
    return typeof value === 'string' && value.trim() !== ''
      ? value.trim()
      : null;
  } catch {
    return null;
  }
}
