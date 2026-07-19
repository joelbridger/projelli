import type {
  FirmMeetingDirectoryGrant,
  MeetingReviewInboxReader,
  SealedMeetingClientBoundary,
} from '@/features/meetings';

/** Public-boundary positive and compile-negative proof for the Actions inbox. */
export function proveMeetingReviewInboxPairBoundary(
  inbox: MeetingReviewInboxReader,
  client: SealedMeetingClientBoundary,
  grant: FirmMeetingDirectoryGrant
) {
  const validSelectedRead = inbox.readForClient(client);
  const compileNegative = () => [
    // @ts-expect-error matter alone is not a selected-client projection key.
    inbox.readForClient({ matterId: 'matter-only' }),
    // @ts-expect-error the explicit firm grant is not selected-client proof.
    inbox.readForClient(grant),
    inbox.transitionArchive(
      'artifact-1',
      {
        kind: 'selected-client',
        // @ts-expect-error selected lifecycle writes require the sealed pair.
        client: { matterId: 'matter-only' },
      },
      {
        from: 'active',
        to: 'archived',
        at: '2026-07-20T00:00:00.000Z',
      }
    ),
  ];
  return { validSelectedRead, compileNegative };
}
