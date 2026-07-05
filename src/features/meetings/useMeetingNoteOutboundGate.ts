// E3 (Tier B trust guard) — resolve, for an open document tab, whether it is a
// meeting note that hasn't cleared review yet, and if so the honest reason its
// outbound actions are disabled. The pure decision lives in
// outboundNoteGate.ts (renamed from meetingNoteOutboundGate.ts under QA-60 —
// that name differed only by first-letter case from the MeetingNoteOutboundGate
// component, which collided on Windows' case-insensitive filesystem); this
// gathers the async inputs (meeting.json + the notice ledger) and localizes
// the reason.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useNoticeSettings } from './noticeSettings';
import { makeConsentLedger } from './consentLedger';
import { deriveNoticeState, type NoticeEntry } from './noticeLedger';
import { meetingNoteOutboundGate, meetingNotesDirForPath, type OutboundGateReason } from './outboundNoteGate';
import type { MeetingMeta } from './meetingStore';

/** Literal t() calls per reason — a dynamic key would trip the i18n parser's
 *  no-non-literal-key rule (and leave the keys looking unused). */
function outboundBlockedText(t: TFunction, reason: OutboundGateReason): string {
  switch (reason) {
    case 'errored':
      return t('media.docx-editor.outbound-blocked-errored');
    case 'notice-quarantined':
      return t('media.docx-editor.outbound-blocked-notice-quarantined');
    case 'needs-review':
      return t('media.docx-editor.outbound-blocked-needs-review');
  }
}

export function useMeetingNoteOutboundGate(
  tabPath: string,
  workspaceService: WorkspaceService | null,
): string | undefined {
  const { t } = useTranslation();
  const { policy } = useNoticeSettings();
  // Fail CLOSED (Codex review): a recognized meeting note starts BLOCKED with a
  // "checking" reason and only becomes sendable once the async review/notice
  // read proves it clear. Otherwise the load window (reason=undefined) would
  // briefly enable the outbound actions on an unreviewed note. Ordinary
  // documents are never gated, so they start (and stay) undefined.
  const initialReason = (path: string): string | undefined =>
    meetingNotesDirForPath(path) ? t('media.docx-editor.outbound-blocked-checking') : undefined;
  const [reason, setReason] = useState<string | undefined>(() => initialReason(tabPath));
  // Reset the instant the tab changes (render-time), so a prior note's cleared
  // state can't leave the next meeting note momentarily sendable.
  const [prevPath, setPrevPath] = useState(tabPath);
  if (tabPath !== prevPath) {
    setPrevPath(tabPath);
    setReason(initialReason(tabPath));
  }

  useEffect(() => {
    const ws = workspaceService;
    // Object-property flag (not a bare boolean) so a slow read for a prior tab
    // can't set state for the tab now on screen.
    const alive = { current: true };
    // All setState happens inside this async callback (never synchronously in
    // the effect body), so a normal document open doesn't cascade renders.
    void (async () => {
      const meetingDir = meetingNotesDirForPath(tabPath);
      // Ordinary documents aren't gated — clear the block. (No await has run
      // yet, so no cancellation check is needed here.)
      if (!meetingDir) {
        setReason(undefined);
        return;
      }
      // A meeting note with no workspace service can't be proven clear, so it
      // stays fail-closed (Codex review) — actively re-assert the block rather
      // than leaving whatever prior state, so a note that was cleared and then
      // lost its service (e.g. workspace closing) doesn't stay sendable.
      if (!ws) {
        setReason(t('media.docx-editor.outbound-blocked-checking'));
        return;
      }
      let meta: MeetingMeta | null = null;
      try {
        meta = JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta;
      } catch {
        // No meeting.json yet — treat as unreviewed (the safe, blocking default).
      }
      const matterFolder = meetingDir.replace(/\/Meetings\/[^/]+$/, '');
      let notices: NoticeEntry[] = [];
      try {
        notices = await makeConsentLedger(ws, () => matterFolder).noticesForMeeting(meetingDir);
      } catch {
        // No ledger read — deriveNoticeState([]) => 'unchecked', which never
        // quarantines, so a missing ledger can't wrongly block on notice.
      }
      if (!alive.current) return;
      const noticeStatus = deriveNoticeState(notices).status;
      const gate = meetingNoteOutboundGate({
        reviewedAt: meta?.reviewedAt ?? null,
        notesError: meta?.notesError,
        noticeStatus,
        policy,
      });
      setReason(gate ? outboundBlockedText(t, gate) : undefined);
    })();
    return () => {
      alive.current = false;
    };
  }, [tabPath, workspaceService, policy, t]);

  return reason;
}
