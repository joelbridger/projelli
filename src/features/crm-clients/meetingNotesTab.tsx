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
  const pendingMeetingOpen = useMatterStore((s) => s.pendingMeetingOpen);
  const setPendingMeetingOpen = useMatterStore((s) => s.setPendingMeetingOpen);
  const [initialSelectedMeeting, setInitialSelectedMeeting] = useState<
    { dir: string; folderName: string; startMs?: number } | null
  >(null);
  useEffect(() => {
    if (pendingMeetingOpen) {
      const req = pendingMeetingOpen;
      queueMicrotask(() => {
        setInitialSelectedMeeting({
          dir: req.meetingDir,
          folderName: req.meetingDir.split('/').pop() ?? req.meetingDir,
          startMs: req.startMs,
        });
        setPendingMeetingOpen(null);
      });
    }
  }, [pendingMeetingOpen, setPendingMeetingOpen]);

  return (
    <ClientMeetingsTab
      matterId={matterId}
      matterFolder={matter?.folderPaths[0] ?? ''}
      workspaceService={getActiveWorkspaceService()}
      {...(initialSelectedMeeting ? { initialSelectedMeeting } : {})}
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
