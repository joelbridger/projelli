/* eslint-disable react-refresh/only-export-components -- descriptor + component share a file, same as the sibling tab adapters (reviewsTab.tsx, crm-connectors/tabSurface.tsx). */
import { useEffect, useMemo, useState } from 'react';
import { Mic } from 'lucide-react';
import type { HouseholdTabDescriptor, HouseholdTabSurfaceProps } from './tabRegistry';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useMatters, useMatterStore } from '@/platform/matter/matterStore';
import { getActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import { ClientMeetingsTab } from '@/features/meetings/ClientMeetingsTab';

/**
 * The household Meeting Notes tab: recording, transcript, and notes-review
 * (restores the MatterHub meeting flow, orphaned by the CRM merge — see
 * fix/matterhub-entry-point). `household.id` is usually the matter id
 * directly (same convention `ClientReviewsTab`/`HouseholdDocumentsTab` use);
 * this falls back to the live CRM record's own `matterId` when they differ.
 */
function HouseholdMeetingNotesTab({ household }: HouseholdTabSurfaceProps) {
  const live = useLiveCrmRecords();
  const matters = useMatters();
  const matterId = useMemo(() => {
    const recordedMatterId = live.records.find(
      (record) => record.kind === 'household' && record.id === household.id,
    )?.matterId;
    if (typeof recordedMatterId === 'string' && matters.some((matter) => matter.id === recordedMatterId)) {
      return recordedMatterId;
    }
    return household.id;
  }, [household.id, live.records, matters]);
  const matter = matters.find((candidate) => candidate.id === matterId) ?? null;

  // A meeting-sourced Client Map/Ask citation or Activity entry names an exact
  // meeting to open (`pendingMeetingOpen`) — the same one-shot MatterHub used
  // to consume before its mount was dropped. Consumed once, then cleared.
  //
  // `HouseholdMeetingNotesTab` itself is NOT remounted on a household switch
  // (ClientsSurface keeps HouseholdRecordSurface mounted and only swaps its
  // `household` prop), so a captured request would otherwise survive into a
  // later, unrelated household — `ClientMeetingsTab` then renders that stale
  // meeting under the NEW matter id (codex-review P1, confirmed: it
  // deliberately shows a `directOpenMeeting` even when the current matter's
  // scanned meeting list doesn't contain it, so a switch away doesn't self-
  // heal). `meetingRequestMatterId` records which matter a captured request
  // belongs to; `effectiveInitialSelectedMeeting` below drops it the instant
  // the active matter no longer matches, and `key={matterId}` on
  // `ClientMeetingsTab` forces a full remount on a real matter change so its
  // OWN internal selection state (which the fix above can't reach) resets too.
  const pendingMeetingOpen = useMatterStore((s) => s.pendingMeetingOpen);
  const setPendingMeetingOpen = useMatterStore((s) => s.setPendingMeetingOpen);
  const [initialSelectedMeeting, setInitialSelectedMeeting] = useState<
    { dir: string; folderName: string; startMs?: number } | null
  >(null);
  const [meetingRequestMatterId, setMeetingRequestMatterId] = useState<string | null>(null);
  useEffect(() => {
    if (pendingMeetingOpen) {
      const req = pendingMeetingOpen;
      const requestMatterId = matterId;
      queueMicrotask(() => {
        setInitialSelectedMeeting({
          dir: req.meetingDir,
          folderName: req.meetingDir.split('/').pop() ?? req.meetingDir,
          startMs: req.startMs,
        });
        setMeetingRequestMatterId(requestMatterId);
        setPendingMeetingOpen(null);
      });
    }
  }, [pendingMeetingOpen, setPendingMeetingOpen, matterId]);
  const effectiveInitialSelectedMeeting =
    meetingRequestMatterId === matterId ? initialSelectedMeeting : null;

  return (
    <ClientMeetingsTab
      key={matterId}
      matterId={matterId}
      matterFolder={matter?.folderPaths[0] ?? ''}
      workspaceService={getActiveWorkspaceService()}
      {...(effectiveInitialSelectedMeeting ? { initialSelectedMeeting: effectiveInitialSelectedMeeting } : {})}
    />
  );
}

export const meetingNotesTab: HouseholdTabDescriptor = {
  id: 'meeting_notes',
  label: 'Meeting Notes',
  icon: Mic,
  route: 'meeting_notes',
  Component: HouseholdMeetingNotesTab,
};
