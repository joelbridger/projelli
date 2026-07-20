import type { ContactRef } from '@/features/crm-contacts';
import type {
  RecordKindsDraft,
  RecordKindsRepository,
} from './recordKindsStore';

/** Compile-negative proof that no new read or write accepts matter-only authority. */
export function proveRecordKindsPairBoundary(
  repository: RecordKindsRepository,
  ref: ContactRef,
  draft: RecordKindsDraft
) {
  const compileNegative = () => [
    // @ts-expect-error reads require the sealed householdRef + matterId pair.
    repository.list({ matterId: 'matter-only' }),
    // @ts-expect-error exact reads require the sealed householdRef + matterId pair.
    repository.read({ matterId: 'matter-only' }, ref),
    repository.create(
      // @ts-expect-error creates require the sealed householdRef + matterId pair.
      { matterId: 'matter-only' },
      { kind: 'person', firstName: 'Maya' },
      draft.details
    ),
    // @ts-expect-error updates require the sealed householdRef + matterId pair.
    repository.update({ matterId: 'matter-only' }, ref, draft),
  ];
  return compileNegative;
}
