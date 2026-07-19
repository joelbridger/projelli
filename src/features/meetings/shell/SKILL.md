# Meetings shell public contribution path

Import every contribution through `@/features/meetings`. The shell owns the
real mounted list and list-tool hosts and the `meetings-shell-v1` flag boundary.
Artifact and notice-provider registration contracts are reserved for their
producer lanes; no production producer exists yet, so the shell deliberately
does not mount those hosts.

```tsx
import { createElement } from 'react';
import {
  registerMeetingListDescriptor,
  registerMeetingListToolDescriptor,
  type MeetingListDescriptor,
  type MeetingListToolDescriptor,
} from '@/features/meetings';

const removeList = registerMeetingListDescriptor({
  id: 'follow-ups',
  kind: 'primary',
  order: 35,
  labelKey: 'follow-ups.meetings',
  render: ({ meetings, openMeeting }) => createElement('button', {
    type: 'button',
    disabled: !meetings[0],
    onClick: () => meetings[0] && void openMeeting(meetings[0].id),
  }, 'Open first meeting'),
} satisfies MeetingListDescriptor);

const removeTool = registerMeetingListToolDescriptor({
  id: 'owner-filter',
  order: 20,
  labelKey: 'follow-ups.owner-filter',
  render: ({ currentMemberId, setOwnerFilter }) => createElement('button', {
    type: 'button',
    disabled: !currentMemberId,
    onClick: () => setOwnerFilter(currentMemberId),
  }, 'My meetings'),
} satisfies MeetingListToolDescriptor);

// Cleanup is live: the same mounted hosts remove these contributions at once.
removeList();
removeTool();
```

Each mounted descriptor needs a unique stable id, a finite order, a namespaced
label key, and a real renderer. Registration validates the base plus all
current contributions before changing the live store. An unavailable
contribution is not read or rendered. Do not register artifact or notice
providers until their production producer lane also lands and mounts the host.

Do not import `meetings/shell/**` directly, create another registry, infer a
client from a path, or open a meeting with a caller-made target. Meeting opens
must enter through the public surface resolver. It resolves a canonical
`MeetingRef`, awaits the sanctioned sealed client selection, and only then
lets the mounted host create the client-scoped store. When the shell flag is
off, do not register or mount a contribution.
