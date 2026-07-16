# Meetings foundation paved path

This module is the local-first meetings contract. Import only from
`@/features/meetings`. Do not import its files directly, raw CRM records, a
recording handle, or a provider client.

## Append a panel

```ts
import { composeMeetingPanelRegistry, type MeetingPanelDescriptor } from '@/features/meetings';

const followUpPanel: MeetingPanelDescriptor = {
  id: 'follow-up-draft', order: 410, isAvailable: () => true,
  render: ({ meeting, artifacts }) => ({ meetingId: meeting.id, drafts: artifacts.listForMeeting(meeting.id, ['follow-up-draft']) }),
};
const panels = composeMeetingPanelRegistry([followUpPanel]);
```

The same pattern applies to header actions, insights, lists, list tools,
artifact contributions, and notice-evidence providers: give the descriptor a
stable ID and order, an availability check, and a renderer/provider that uses
only its named context. A caller mounts nothing when `isAvailable` is false.

## Read artifacts safely

```ts
import { approvedMeetingArtifacts, useMeetingArtifactStore } from '@/features/meetings';

const artifacts = useMeetingArtifactStore();
const approved = approvedMeetingArtifacts(artifacts);
const notes = approved.listApproved(meetingId, ['structured-notes']);
```

Client summaries must first limit meetings to the supplied `ClientBoundary`.
Use `createMeetingSourceAdapter` for Ask-style cited inputs. Do not write an
artifact by editing a meeting entry; use `MeetingArtifactStore.append`.

## Local evidence only

Use `appendNoticeEvidence` only for a notice shown, confirmed, or a locally
attached statement. It cannot claim audio playback, capture, sending, export,
or provider generation. Those are Part B and remain parked.

## Public-import fixtures

Each dependent gets a small `fixtures/*.import.ts` file. Keep fixtures outside
the foundation implementation and import the exact public type or registry
from `@/features/meetings`. They are compile-time proof that dependents do not
need a deep import.
