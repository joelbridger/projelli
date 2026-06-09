// Privilege / work-product model (WS-PRIV)
//
// Privilege is the LITIGATION-SAFETY boundary in Keepance 3.0, parallel to the
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
 */
export function privilegeLabel(privilege: Privilege): string {
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
export function privilegeShortLabel(privilege: Privilege): string {
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
