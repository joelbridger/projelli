# Meetings foundation paved path

Import only from `@/features/meetings`. This foundation supplies durable local
records, reactive catalogues/settings, client-bound readers, and the cited Ask
adapter. It does not claim a UI mount where the approved base has no real host.

## Save a meeting and preserve references

```ts
import { createMeetingStore } from '@/features/meetings';

const meetings = createMeetingStore(livePort);
const meeting = await meetings.createDraft({
  workspaceId: 'workspace-1',
  householdRef: 'household-1',
  matterId: 'matter-1',
  typeId: 'review',
  ownerRef: 'member-1',
  scheduledStartUtc: '2026-07-20T09:00:00.000Z',
  scheduledEndUtc: '2026-07-20T10:00:00.000Z',
  timezone: 'America/Chicago',
  references: ['contact-1'],
});

await meetings.update(meeting.id, { references: ['document-1'] });
// The canonical record now retains both contact-1 and document-1.
```

## Append, approve, and read an artifact safely

```ts
import {
  approvedMeetingArtifactsForClient,
  createMeetingArtifactStore,
  createMeetingStore,
} from '@/features/meetings';

const meetings = createMeetingStore(livePort);
const artifacts = createMeetingArtifactStore(livePort);
const notes = await artifacts.append({
  meetingId: 'meeting-1',
  kind: 'structured-notes',
  schemaVersion: 2,
  producedAt: '2026-07-20T10:00:00.000Z',
  sourceRefs: ['document-1'],
  provenance: 'local-entry',
  payload: { summary: 'Client-safe notes' },
});
await artifacts.approve(notes.id, {
  from: 'produced',
  to: 'approved',
  at: '2026-07-20T10:01:00.000Z',
});

const approvedNotes = approvedMeetingArtifactsForClient(
  meetings,
  artifacts,
  { householdRef: 'household-1', matterId: 'matter-1' },
  [{ kind: 'structured-notes', minimumSchemaVersion: 2 }],
);
const safeNotes = approvedNotes.listApproved('meeting-1');
```

The store exposes writes, not an unbounded raw reader. A caller must bind reads
to the exact household, matter, allowed kinds, and minimum schema versions.
Wrong-client, wrong-matter, wrong-kind, old-version, and unapproved records all
fail closed by returning no data.

Approval is an append-only transition record. It never rewrites the produced
artifact. Only the legal `produced -> approved` transition is accepted.

## Reactive catalogues and preferences

Use `useMeetingTypeStore`, `useMeetingTemplateStore`,
`useMeetingIntelligenceSettingsStore`, and
`useMeetingFoundationPreferencesStore` in mounted React consumers. Their public
snapshots update after save and after the live-record relay refreshes.

## Public consumer proof

The ready outside-module fixtures are under `src/features/meetings/fixtures/`:

- `meetingsShell.import.ts` proves the core record contracts.
- `noticeEvidence.import.ts` proves the local notice read model.
- `askAcrossMeetings.import.ts` proves the client-bound cited source adapter.

`meetingFoundationDependentManifest` lists the complete consumer map. A ready
entry names its fixture. Every missing owner doorway has `fixture: null` and a
`COORDINATOR:` reason.

## Honest structural stops

The approved base has no real composition host for meeting panels, header
actions, insights, lists, list tools, artifact contributions, or notice
providers. It also lacks the required public owner contracts for the shell
surface, Settings modules, CRM household sections, and CRM client tabs. This
package therefore exports no local lookalikes for them. All affected consumers
remain coordinator-blocked until their owners land the real contracts.

## Part B stays out

This foundation does not record audio, call a model/provider, transcribe,
diarize, send email, export externally, run automation, delete for retention,
or write audit history. Those actions require separately approved Part B
contracts and verified receipts.
