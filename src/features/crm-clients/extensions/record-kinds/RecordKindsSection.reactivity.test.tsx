import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { HouseholdSectionContext } from '../../recordRegistry';

const fixture = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  decision: null as unknown,
  save: vi.fn(),
  reloadRecords: vi.fn(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: fixture.records,
    save: fixture.save,
    reloadRecords: fixture.reloadRecords,
    reload: fixture.reloadRecords,
    error: null,
    workspaceRoot: '/practice',
    freshness: { kind: 'idle' },
    sharedMatterId: null,
  }),
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => fixture.decision,
  readSelectionOperationDecision: () => fixture.decision,
  readSharedClientContext: () => null,
  useClientContextStore: Object.assign(
    <T,>(selector: (state: { client: null }) => T) =>
      selector({ client: null }),
    { getState: () => ({ client: null }) }
  ),
}));

import { setDevFlagOverride } from '@/platform/flags';
import { RecordKindsSection } from './RecordKindsSection';
import { useRecordKindsPort } from './recordKindsPort';
import { sealRecordKindsClientScope } from './recordKindsStore';

function context(
  householdId: string,
  matterId: string,
  name: string
): HouseholdSectionContext {
  return {
    householdRef: { kind: 'household', id: householdId, matterId, label: name },
    matterId,
  };
}

function contactRecords(
  householdId: string,
  matterId: string,
  householdName: string,
  personId: string,
  firstName: string,
  lastName: string
): LiveCrmRecord[] {
  return [
    {
      id: householdId,
      kind: 'household',
      matterId,
      name: householdName,
      lifecycle: 'Active',
      primaryAdvisor: 'Sarah Morgan',
      channels: [],
      contactLinks: [],
      contextRefs: [],
      tagIds: [],
    },
    {
      id: personId,
      kind: 'person',
      matterId,
      firstName,
      lastName,
      lifecycle: 'Active',
      primaryAdvisor: 'Sarah Morgan',
      channels: [],
      contactLinks: [],
      contextRefs: [],
      tagIds: [],
    },
  ];
}

function selectedDecision(householdId: string, matterId: string, name: string) {
  return {
    kind: 'matter',
    sourceKind: 'matter',
    matter: {
      id: matterId,
      name,
      client: name,
      folderPaths: [`/practice/${name}`],
      createdAt: '2026-07-19T00:00:00.000Z',
    },
    client: { provider: 'wealthbox', householdId, displayName: name },
  };
}

function twoClientFirm(): LiveCrmRecord[] {
  return [
    ...contactRecords(
      'household:a',
      'matter-a',
      'Foster household',
      'person:a',
      'Robert',
      'Foster'
    ),
    ...contactRecords(
      'household:b',
      'matter-b',
      'Diaz household',
      'person:b',
      'Camila',
      'Diaz'
    ),
  ];
}

const scopeA = () =>
  sealRecordKindsClientScope({
    householdRef: {
      kind: 'household',
      id: 'household:a',
      matterId: 'matter-a',
      label: 'Foster household',
    },
    matterId: 'matter-a',
  });

describe('record-kinds cross-client reactivity boundary (Finding #1)', () => {
  beforeEach(() => {
    setDevFlagOverride('record-kinds-v1', true);
    fixture.records = twoClientFirm();
    fixture.decision = selectedDecision(
      'household:a',
      'matter-a',
      'Foster household'
    );
    fixture.save.mockReset();
    fixture.reloadRecords.mockReset();
    fixture.reloadRecords.mockImplementation(() =>
      Promise.resolve(fixture.records)
    );
  });

  afterEach(() => {
    cleanup();
    setDevFlagOverride('record-kinds-v1', undefined);
  });

  // The section's load effect re-runs when either its scoped reload signature or
  // its reload callback identity changes; the reload callback is derived from
  // `port.repository`. This proves the exact inputs behave correctly:
  //   - a change to ANOTHER client leaves BOTH the port identity (→ repository →
  //     reload callback) AND client A's scoped signature untouched → A's effect
  //     does not re-run (no cross-client reactive/timing signal);
  //   - a change to client A's OWN records leaves the port identity stable (it
  //     reads the current store internally) yet moves A's scoped signature → A's
  //     effect re-runs → A reloads.
  it('freezes the port identity across another client change while still reacting to this client’s own change', () => {
    const { result, rerender } = renderHook(() => useRecordKindsPort());
    const scope = scopeA();

    const port1 = result.current;
    const repo1 = port1.repository;
    const sigA1 = port1.reloadSignatureFor(scope);

    // Change ONLY client B: B adds one of its OWN individuals. This is the exact
    // side-channel the review flagged — under the whole-pool key it replaced
    // `port.repository`. Client A's records are byte-for-byte identical.
    fixture.records = [
      ...twoClientFirm(),
      {
        id: 'person:b2',
        kind: 'person',
        matterId: 'matter-b',
        firstName: 'Diego',
        lastName: 'Diaz',
        lifecycle: 'Active',
        primaryAdvisor: 'Sarah Morgan',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
    ];
    rerender();

    // Port identity, repository identity, and A's scoped signature all unchanged
    // → A's load effect has no reason to re-run for a B-side change.
    expect(result.current).toBe(port1);
    expect(result.current.repository).toBe(repo1);
    expect(result.current.reloadSignatureFor(scope)).toBe(sigA1);

    // Now change client A itself (add one of A's own individuals).
    fixture.records = [
      ...fixture.records.filter((record) => record.matterId === 'matter-a'),
      {
        id: 'person:a2',
        kind: 'person',
        matterId: 'matter-a',
        firstName: 'Alice',
        lastName: 'Foster',
        lifecycle: 'Active',
        primaryAdvisor: 'Sarah Morgan',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
      ...fixture.records.filter((record) => record.matterId === 'matter-b'),
    ];
    rerender();

    // Port identity STILL stable (it reads the live store through a ref), but A's
    // OWN scoped signature moved → A reloads.
    expect(result.current).toBe(port1);
    expect(result.current.reloadSignatureFor(scope)).not.toBe(sigA1);
  });

  // End-to-end proof at the rendered surface, using a non-racy observable: an
  // open editor with a half-typed value. If A were to reload, the section would
  // flip to its loading card, unmounting the editor and destroying the local
  // half-typed value. Surviving the B-side change proves A neither reloaded nor
  // entered loading. Changing A itself then reloads (the editor is torn down and
  // re-seeded from the original snapshot, so the half-typed value is gone).
  it('does not reload client A (keeps its open editor + half-typed value) when only client B changes, but reloads on A’s own change', async () => {
    const contextA = context('household:a', 'matter-a', 'Foster household');
    const view = render(<RecordKindsSection context={contextA} />);

    const sectionA = await screen.findByTestId('record-kinds-section');
    expect(within(sectionA).getByText('Robert Foster')).toBeInTheDocument();

    // Open A's editor and half-type into the first-name field (local editor
    // state that only survives if the editor is never unmounted).
    fireEvent.click(screen.getByTestId('record-kinds-edit-person:a'));
    await screen.findByTestId('record-kinds-editor');
    const firstName = screen.getByDisplayValue('Robert');
    fireEvent.change(firstName, { target: { value: 'RobertHALF' } });
    expect(screen.getByDisplayValue('RobertHALF')).toBeInTheDocument();

    // Change ONLY client B (B adds its own individual — the flagged side-channel
    // trigger), then re-render A with the SAME context/decision.
    fixture.records = [
      ...twoClientFirm(),
      {
        id: 'person:b2',
        kind: 'person',
        matterId: 'matter-b',
        firstName: 'Diego',
        lastName: 'Diaz',
        lifecycle: 'Active',
        primaryAdvisor: 'Sarah Morgan',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
    ];
    view.rerender(<RecordKindsSection context={contextA} />);

    // A never reloaded: no loading card, and the half-typed value survives
    // because the editor was never unmounted.
    await waitFor(() => {
      expect(screen.getByDisplayValue('RobertHALF')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('record-kinds-loading')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('record-kinds-section')).getByText(
        'Robert Foster'
      )
    ).toBeInTheDocument();

    // Now change client A itself → A reloads → the editor is torn down and its
    // half-typed value is gone (re-seeded from the original snapshot).
    fixture.records = [
      ...contactRecords(
        'household:a',
        'matter-a',
        'Foster household',
        'person:a',
        'Robert',
        'Foster'
      ),
      {
        id: 'person:a2',
        kind: 'person',
        matterId: 'matter-a',
        firstName: 'Alice',
        lastName: 'Foster',
        lifecycle: 'Active',
        primaryAdvisor: 'Sarah Morgan',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
      ...contactRecords(
        'household:b',
        'matter-b',
        'Diaz household RENAMED',
        'person:b',
        'Camila',
        'Changed'
      ),
    ];
    view.rerender(<RecordKindsSection context={contextA} />);

    await waitFor(() => {
      expect(
        within(screen.getByTestId('record-kinds-section')).getByText(
          'Alice Foster'
        )
      ).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('RobertHALF')).not.toBeInTheDocument();
  });
});
