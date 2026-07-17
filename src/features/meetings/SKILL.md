# Meetings foundation paved path

Import only from `@/features/meetings`. This foundation supplies durable local
records, reactive catalogues/settings, client-bound readers, and the cited Ask
adapter. It does not claim a UI mount where the approved base has no real host.

## Build a client-isolated store (the ONLY supported construction)

**Always use the reactive hooks in a mounted consumer.** They wire the LIVE
active-client resolver for you, so every store is client-isolated automatically —
you cannot get the isolation-less shape:

```ts
import { useMeetingFoundationStore } from '@/features/meetings';

const meetings = useMeetingFoundationStore(); // already client-scoped
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

Outside a React render (a service, a test) construct the store directly — but
`createMeetingStore` / `createMeetingArtifactStore` **require** a live
`getActiveMatterId` resolver, so a store with no client isolation **is a compile
error, not a silent leak**. The resolver MUST read the LIVE active client at call
time; a captured snapshot reintroduces the stale-client leak, and a resolver
returning `null`/`undefined` (no active client) fails closed.

```ts
import {
  approvedMeetingArtifactsForClient,
  createMeetingArtifactStore,
  createMeetingStore,
  type ClientScopedLivePort,
} from '@/features/meetings';
import { useMatterStore } from '@/platform/matter/matterStore';

// livePort supplies records / workspaceRoot / error / save / reloadRecords.
const scopedPort: ClientScopedLivePort = {
  ...livePort,
  getActiveMatterId: () => useMatterStore.getState().activeMatterId, // LIVE
};
const meetings = createMeetingStore(scopedPort);
const artifacts = createMeetingArtifactStore(scopedPort);
// createMeetingStore({ ...livePort }) // ← compile error: getActiveMatterId is required

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

## Contribute a panel, header action, or insight to the real Meetings host

`MeetingEntry` — the real Meetings page — renders the LIVE host composition:
`getMeetingPanelComposition()`, `getMeetingHeaderActionComposition()`, and
`getMeetingInsightComposition()`. Register through the public weave path and the
contribution reaches the host (it is not a private returned array). Each
contribution carries a unique `id`, a stable `order`, and an optional flag-aware
`isAvailable()`; a dark (`false`) contribution is excluded, and duplicate ids or
malformed descriptors are rejected at registration time.

```ts
import {
  registerMeetingPanel,
  registerMeetingHeaderAction,
  registerMeetingInsight,
} from '@/features/meetings';

// A dependent's flag-on setup registers its panel beside the compatibility
// Recording/Transcript/Summary tabs. Registering returns an unregister handle;
// a flag-off dependent simply does not register.
const unregisterPanel = registerMeetingPanel({
  id: 'meeting-signals-panel',
  order: 40,
  labelKey: 'meetings.signals.tab',
  isAvailable: () => featureFlag('meeting-signals'),
  mount: (context) => renderSignals(context),
});

registerMeetingHeaderAction({
  id: 'meeting-visibility-action',
  order: 40,
  labelKey: 'meetings.visibility.action',
  placement: 'secondary',
  mount: (context) => renderVisibilityToggle(context),
});

registerMeetingInsight(meetingKeywordsInsight); // full insight plug-in contract
```

The pure builders `createMeeting*Composition(...contributions)` and
`defaultMeeting*Composition` remain available for tests and for composing a
snapshot without touching the host. The host, however, reads the live
`getMeeting*Composition()` result, so `register*` is what makes a contribution
render in the product.

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
- `meetingComposition.import.ts` proves the panel/header-action/insight append
  path — a genuine outside contribution composes and type-checks.

`meetingFoundationDependentManifest` lists the complete consumer map. A ready
entry names its fixture. Every missing owner doorway has `fixture: null` and a
`COORDINATOR:` reason.

## Honest structural stops

The meeting **panel, header-action, and insight** composition registries are
wired into the real `MeetingEntry` host (above) and are ready.

The remaining composition points have **no host at the approved base**, so this
package exports no empty lookalike registry for them; each is coordinator-blocked
with the named absent host:

- **Meeting lists, list tools, artifact-contribution panels, and notice-evidence
  providers** are owned by `meetings-shell-v1` (the Upcoming/Past/Actions frame,
  My Meetings bar, and processed-meeting panel slot). That surface is itself
  blocked because `src/app/shell/registry` exports no public `appSurfaceRegistry`
  / `AppSurfaceRouter` doorway at base. The artifact writer and the client-bound
  reader remain usable directly today.
- **Settings modules, CRM household sections, and CRM client record tabs** are
  not exported from their owners' public indexes (`@/features/settings`,
  `@/features/crm-clients`). The dependent that needs each one stays blocked
  until the owner lands the real contract.

See `meetingFoundationDependentManifest` for the exact per-consumer status and
the named absent doorway.

## Part B stays out

This foundation does not record audio, call a model/provider, transcribe,
diarize, send email, export externally, run automation, delete for retention,
or write audit history. Those actions require separately approved Part B
contracts and verified receipts.
