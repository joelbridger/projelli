// src/platform/clientMap/openSource.ts
//
// Opening a Client Map source link at its EXACT location.
//
// A source link cites either a specific document (a workspace path) or a
// specific email (a mail message id). Clicking it should land on that exact
// item, not just the general Documents / Email surface.
//
//   - Email  -> the dedicated `keepance:open-email` action, which opens a
//     self-fetching read-only email tab for the cited message id.
//   - Document -> a `keepance:matter-launch` event carrying the exact path +
//     snippet; the shell event bus (useGlobalEventBus) calls
//     `openSourceDocument` to read and open that file, then scroll to the
//     cited spot. This reuses the same primitives as the app's file-open
//     pipeline (binary-aware read + editor openFile + scroll-to-paragraph).
import type { SourceRef } from './types';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { pathInMatterScope } from '@/platform/matter/matterScopeGuard';
import { isBinaryFile, getMimeType, arrayBufferToDataUrl } from '@/platform/utils/file-utils';
import { requestScrollToParagraph } from '@/platform/utils/scrollToParagraph';

/** The slice of the workspace service this module needs to read a document.
 *  Injected by the app-layer caller so this platform module never imports the
 *  app layer (the active-service singleton lives in src/app/fileOps). */
export interface DocumentReader {
  readFile(path: string): Promise<string>;
  readFileBinary(path: string): Promise<ArrayBuffer>;
}

export const OPEN_EMAIL_EVENT = 'keepance:open-email';
export const OPEN_CRM_EVENT = 'keepance:open-crm';
export const OPEN_ONEDRIVE_EVENT = 'keepance:open-onedrive';
export const OPEN_ESIGN_EVENT = 'keepance:open-esign';
export const OPEN_MEETING_EVENT = 'keepance:open-meeting';
export const OPEN_BOX_EVENT = 'keepance:open-box';
export const OPEN_JOTFORM_EVENT = 'keepance:open-jotform';
export const OPEN_SHAREFILE_EVENT = 'keepance:open-sharefile';
export const OPEN_ZOCKS_EVENT = 'keepance:open-zocks';
export const OPEN_ADDEPAR_EVENT = 'keepance:open-addepar';
export const MATTER_LAUNCH_EVENT = 'keepance:matter-launch';

/** The document-source payload carried on a `keepance:matter-launch` event. */
export interface MatterLaunchSource {
  kind: 'document';
  ref: string;
  snippet?: string;
}

/**
 * Dispatch the right "open the exact source" event for a Client Map source link.
 * Email sources go straight to the dedicated open-email action; document sources
 * ride on matter-launch so the shell can open the exact file in the matter.
 */
export function dispatchOpenSource(matterId: string, ref: SourceRef): void {
  if (typeof window === 'undefined') return;
  if (ref.kind === 'email') {
    window.dispatchEvent(new CustomEvent(OPEN_EMAIL_EVENT, { detail: { sourceId: ref.ref } }));
    return;
  }
  if (ref.kind === 'crm') {
    window.dispatchEvent(new CustomEvent(OPEN_CRM_EVENT, { detail: { sourceId: ref.ref } }));
    return;
  }
  if (ref.kind === 'onedrive') {
    window.dispatchEvent(new CustomEvent(OPEN_ONEDRIVE_EVENT, { detail: { sourceId: ref.ref } }));
    return;
  }
  if (ref.kind === 'esign') {
    window.dispatchEvent(new CustomEvent(OPEN_ESIGN_EVENT, { detail: { sourceId: ref.ref } }));
    return;
  }
  if (ref.kind === 'meeting') {
    window.dispatchEvent(new CustomEvent(OPEN_MEETING_EVENT, { detail: { sourceId: ref.ref } }));
    return;
  }
  // The new connector panels render detail.snippet as the cited passage, so the
  // snippet must ride along on the event (not just the opaque sourceId).
  if (ref.kind === 'box') {
    window.dispatchEvent(
      new CustomEvent(OPEN_BOX_EVENT, { detail: { sourceId: ref.ref, snippet: ref.snippet } }),
    );
    return;
  }
  if (ref.kind === 'jotform') {
    window.dispatchEvent(
      new CustomEvent(OPEN_JOTFORM_EVENT, { detail: { sourceId: ref.ref, snippet: ref.snippet } }),
    );
    return;
  }
  if (ref.kind === 'sharefile') {
    window.dispatchEvent(
      new CustomEvent(OPEN_SHAREFILE_EVENT, {
        detail: { sourceId: ref.ref, snippet: ref.snippet },
      }),
    );
    return;
  }
  if (ref.kind === 'zocks') {
    window.dispatchEvent(
      new CustomEvent(OPEN_ZOCKS_EVENT, { detail: { sourceId: ref.ref, snippet: ref.snippet } }),
    );
    return;
  }
  if (ref.kind === 'addepar') {
    window.dispatchEvent(
      new CustomEvent(OPEN_ADDEPAR_EVENT, { detail: { sourceId: ref.ref, snippet: ref.snippet } }),
    );
    return;
  }
  const source: MatterLaunchSource = { kind: 'document', ref: ref.ref };
  if (ref.snippet) source.snippet = ref.snippet;
  window.dispatchEvent(
    new CustomEvent(MATTER_LAUNCH_EVENT, { detail: { matterId, surface: 'files', source } }),
  );
}

/** Resolve a workspace-relative-or-absolute retrieval path against the active
 *  workspace root, matching the app's file-open pipeline. */
function resolveDocumentPath(rootPath: string | null, ref: string): string {
  if (!rootPath || ref.startsWith(rootPath)) return ref;
  return `${rootPath}/${ref}`.replace(/\/+/g, '/');
}

/**
 * Read the cited document via the active workspace service and open it in the
 * editor at the cited snippet. Binary documents (e.g. .docx) are read as a data
 * URL exactly like the app's file-open pipeline. Returns true when a tab was
 * opened, false when it could not (no active workspace, out-of-matter path, or
 * read failure) so the caller can fall back to the document browser.
 *
 * Matter isolation (hard rule): the resolved path must belong to `matterId`.
 * Client Map sources come from matter-scoped retrieval, but a stale or malformed
 * source could point elsewhere, so we fail closed rather than ever surface
 * another matter's document.
 *
 * `service` is the active workspace service, injected by the app-layer caller
 * (null before a workspace is open).
 */
export async function openSourceDocument(
  ref: string,
  matterId: string,
  service: DocumentReader | null,
  snippet?: string,
): Promise<boolean> {
  if (!service) return false;
  const rootPath = useWorkspaceStore.getState().rootPath;
  const path = resolveDocumentPath(rootPath, ref);
  if (!pathInMatterScope(path, matterId, useMatterStore.getState().matters)) return false;
  const name = path.split('/').pop() ?? path;
  try {
    if (isBinaryFile(name)) {
      const buffer = await service.readFileBinary(path);
      const dataUrl = arrayBufferToDataUrl(buffer, getMimeType(name));
      useEditorStore.getState().openFile(path, name, dataUrl);
    } else {
      const content = await service.readFile(path);
      useEditorStore.getState().openFile(path, name, content);
    }
  } catch {
    return false;
  }
  requestScrollToParagraph({ path, paragraphIndex: 0, ...(snippet ? { snippet } : {}) });
  return true;
}
