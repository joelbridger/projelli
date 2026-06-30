/**
 * useOpenEmailListener (WS-B/C) — open the read-only email viewer when an email
 * citation is clicked in chat.
 *
 * `AIChatViewer` dispatches a `lantern:open-email` window CustomEvent (with
 * `{ detail: { sourceId } }`) for any citation whose source is a `mail:<id>`
 * (email sources resolve to a message id, not a file on disk, so they can't go
 * through the editor's file-open pipeline). This hook listens for that event and
 * opens (or focuses) an `email` tab for the message.
 *
 * The tab is keyed by the `mail:<id>` source id so clicking the same citation
 * twice focuses the existing tab instead of opening a duplicate. The message id
 * rides in `metadata.mailSourceId`; the viewer fetches + decrypts it via the
 * `mail_get_message` command.
 *
 * Extracted from App.tsx so the open-email wiring is unit-testable in isolation.
 */

import { useEffect } from 'react';
import { EV_OPEN_EMAIL } from '@/config/identity';

/** Shape of the `openTab` action from the editor store (kept structural so this
 *  hook does not depend on the store's full type). */
export type OpenEmailTabFn = (
  path: string,
  name: string,
  content: string,
  type: 'email',
  metadata: { mailSourceId: string },
) => void;

/** Strip a leading `mail:` prefix from a citation source id. */
export function mailIdFromSource(sourceId: string): string {
  return sourceId.startsWith('mail:') ? sourceId.slice('mail:'.length) : sourceId;
}

/** A short, human label for an email tab before its subject decrypts. */
export function emailTabLabel(sourceId: string): string {
  return `Email ${mailIdFromSource(sourceId).slice(0, 8)}`;
}

export function useOpenEmailListener(openTab: OpenEmailTabFn): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sourceId?: string }>).detail;
      const sourceId = detail?.sourceId;
      if (!sourceId) return;
      openTab(sourceId, emailTabLabel(sourceId), '', 'email', { mailSourceId: sourceId });
    };
    window.addEventListener(EV_OPEN_EMAIL, handler);
    return () => window.removeEventListener(EV_OPEN_EMAIL, handler);
  }, [openTab]);
}

export default useOpenEmailListener;
