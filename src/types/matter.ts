// Matter / Client model (WS-B/C app)
//
// A "matter" is the confidentiality boundary in Keepance 3.0. It groups one
// client's work under one or more workspace folders. Every file or email
// indexed under a matter is tagged with that matter's id; retrieval is then
// scoped to a single matter so one client's data can never surface inside a
// chat about another client's matter.
//
// The simplest real-world model: a matter owns one or more top-level (or
// nested) workspace folders. Any file whose path lives under one of those
// folders belongs to the matter. Files outside every mapped folder fall back
// to the `unassigned` sentinel — the same sentinel the Rust indexer uses when
// no matterId is supplied (see `rag_index_*` in src-tauri/src/commands/rag).

/**
 * The sentinel id used for any chunk that hasn't been mapped to a real
 * matter. Mirrors the Rust-side `"unassigned"` default so the frontend and
 * backend agree on the bucket an unmapped file lands in. Never persist a
 * matter with this id; it is reserved.
 */
export const UNASSIGNED_MATTER_ID = 'unassigned';

/**
 * A single client matter. `folderPaths` are ABSOLUTE workspace paths (the
 * same shape the editor and RAG use), each the root of a folder whose files
 * belong to this matter. A matter may map to several folders (e.g. a client
 * with separate "Litigation" and "Corporate" trees).
 */
export interface Matter {
  /** Stable unique id (uuid-ish). The citation/scope key the backend stores. */
  id: string;
  /** Human-readable matter name, e.g. "Acme v. Beta - Patent". */
  name: string;
  /** The client this matter belongs to, e.g. "Acme Corp". */
  client: string;
  /** Absolute folder paths whose files belong to this matter. */
  folderPaths: string[];
  /**
   * Mail-folder keys whose email belongs to this matter. Each key is a mail
   * folder identifier in the form `provider/account/folderId`, or
   * `provider/account` for an account-level mapping (every folder in that
   * account). Email synced from a mapped folder is indexed under this matter;
   * see `mailFolderKey` / `parseMailFolderKey` in `matterResolver`.
   *
   * Optional so matters created before mail mapping landed still parse from
   * persisted storage (a missing value is treated as an empty list).
   */
  mailFolderPaths?: string[];
  /** ISO timestamp the matter was created. */
  createdAt: string;
}

/**
 * The retrieval scope a chat resolves to. Mirrors `RetrievalScope` in
 * `@/utils/tauri-commands`, re-exported here so UI code can talk about
 * matters without importing the Tauri bindings directly. There is no silent
 * "everything" default — a caller must name a matter or explicitly pick
 * `allMatters` (the audited cross-matter capability).
 */
export type MatterScope =
  | { kind: 'matter'; matterId: string }
  | { kind: 'allMatters' };
