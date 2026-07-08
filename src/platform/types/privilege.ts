// Privilege / work-product model (WS-PRIV)
//
// Privilege is the LITIGATION-SAFETY boundary in Lantern 3.0, parallel to the
// matter (confidentiality) boundary. Because every AI chat is saved and every
// file is searchable, a lawyer accumulates discoverable material; privileged
// content (attorney-client communications, attorney work product) must be
// taggable at the SOURCE level and must NEVER leak into AI retrieval by default.
//
// A source is a file (by absolute path), an email (`mail:<id>`), or a saved
// chat (a `.aichat` file path). Each source carries one `Privilege` status. The
// status is stored per-source in the privilege store (keyed by source id) so it
// persists, and it is written onto every indexed chunk for that source so the
// RAG engine can exclude privileged chunks via a prefilter.
//
// Default retrieval EXCLUDES `attorney-client` and `work-product`. The only way
// privileged content surfaces is a deliberate, explicit "include privileged
// sources" opt-in on a query — analogous to the deliberate cross-matter
// ("all matters") capability. There is no silent path that returns privileged
// content.

/**
 * The privilege status of a source. Mirrors the Rust-side constants in
 * `src-tauri/src/commands/rag/store.rs` (`PRIVILEGE_*`). These exact string
 * values are written to the `privilege` column and used in the retrieval
 * prefilter, so frontend and backend MUST agree on them.
 *
 *   - `none`            — no privilege claim. The default; the only value
 *                         default retrieval returns.
 *   - `attorney-client` — attorney-client privileged. Excluded by default.
 *   - `work-product`    — attorney work product. Excluded by default.
 */
import type { Profession } from '@/platform/profile/professionModel';

export type Privilege = 'none' | 'attorney-client' | 'work-product';

/** The default (and safe) privilege for any source that has not been tagged. */
export const DEFAULT_PRIVILEGE: Privilege = 'none';

/** The two privileged statuses, excluded from default retrieval. Useful for
 *  "is this source privileged?" checks and for rendering the tagging UI. */
export const PRIVILEGED_STATUSES: ReadonlyArray<Privilege> = [
  'attorney-client',
  'work-product',
];

/** Every selectable privilege status, in display order. */
export const ALL_PRIVILEGE_STATUSES: ReadonlyArray<Privilege> = [
  'none',
  'attorney-client',
  'work-product',
];

/** True when a privilege value excludes the source from default retrieval. */
export function isPrivileged(privilege: Privilege | null | undefined): boolean {
  return privilege === 'attorney-client' || privilege === 'work-product';
}

/**
 * A short, human-readable label for a privilege status. Hyphen-and-space form,
 * never an em dash (project copy rule). Used by the file-tree indicator, the
 * editor header, and the tagging menu.
 *
 * Profession-aware: attorney-client / work-product are LEGAL doctrines. For a
 * non-legal practice (financial advisor, tax, consulting) the same underlying
 * "keep this source out of AI retrieval" boundary reads as plain confidentiality
 * — a financial advisor has no "attorney-client privilege". So for any
 * non-legal profession both privileged statuses collapse to "Sensitive". The
 * stored string values never change (the Rust retrieval prefilter depends on
 * them); only the visible words adapt. Defaults to the legal labels so existing
 * callers/tests stay correct.
 */
export function privilegeLabel(privilege: Privilege, profession: Profession = 'legal'): string {
  if (profession !== 'legal') {
    switch (privilege) {
      case 'attorney-client':
      case 'work-product':
        return 'Sensitive — kept out of AI';
      case 'none':
      default:
        return 'Available to AI';
    }
  }
  switch (privilege) {
    case 'attorney-client':
      return 'Attorney-Client Privileged';
    case 'work-product':
      return 'Work Product';
    case 'none':
    default:
      return 'Not privileged';
  }
}

/** A compact label for the inline indicator chip (kept short on purpose). */
export function privilegeShortLabel(privilege: Privilege, profession: Profession = 'legal'): string {
  if (profession !== 'legal') {
    return isPrivileged(privilege) ? 'Sensitive' : '';
  }
  switch (privilege) {
    case 'attorney-client':
      return 'Privileged';
    case 'work-product':
      return 'Work Product';
    case 'none':
    default:
      return '';
  }
}

/**
 * The statuses to OFFER in the per-source tagging menu, in display order.
 * Legal practices distinguish attorney-client privilege from attorney work
 * product, so all three show. A non-legal practice only needs the binary
 * "available vs. keep-out-of-AI", so the menu collapses to two options
 * (attorney-client is the canonical "sensitive" value the tagger writes).
 */
export function privilegeMenuStatuses(profession: Profession = 'legal'): ReadonlyArray<Privilege> {
  return profession === 'legal' ? ALL_PRIVILEGE_STATUSES : ['none', 'attorney-client'];
}

/** The verb-noun label for the tagging control itself (button / menu trigger). */
export function privilegeControlLabel(profession: Profession = 'legal'): string {
  return profession === 'legal' ? 'Privilege' : 'Sensitive';
}

/** The one-line explanation shown above the tagging menu. */
export function privilegeMenuHint(profession: Profession = 'legal'): string {
  return profession === 'legal'
    ? 'Privileged sources are kept out of AI retrieval by default.'
    : 'Sensitive sources are kept out of AI retrieval by default.';
}
