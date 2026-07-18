import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  ClientsSurface,
  DirectorySurface,
  defaultDirectoryComposition,
} from '@/features/crm-clients';
import type { ContactDirectoryProjection } from '@/features/crm-contacts';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import { findLikelyDuplicateContacts } from '@/features/crm-clients/extensions/duplicates';
import { duplicateReviewPreferences } from './reviewState';

const liveCrm = vi.hoisted(() => ({
  hook: vi.fn(),
  records: [] as Array<Record<string, unknown>>,
  reloadRecords: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => {
    liveCrm.hook();
    return {
      records: liveCrm.records,
      save: liveCrm.save,
      reload: vi.fn(),
      reloadRecords: liveCrm.reloadRecords,
      error: null,
      workspaceRoot: '/practice',
      freshness: { kind: 'idle' as const },
      sharedMatterId: null,
      sharedLocalMatterId: null,
    };
  },
}));

const fosterContacts: readonly [
  ContactDirectoryProjection,
  ContactDirectoryProjection,
] = [
  {
    id: 'contact-robert',
    kind: 'person',
    matterId: 'matter-foster',
    displayName: 'Robert Foster',
    lifecycle: 'Active',
    tagIds: [],
    contextRefs: [],
    ref: {
      id: 'contact-robert',
      kind: 'person',
      matterId: 'matter-foster',
      label: 'Robert Foster',
    },
    status: 'Active',
  },
  {
    id: 'contact-bob',
    kind: 'person',
    matterId: 'matter-foster',
    displayName: 'Bob Foster',
    lifecycle: 'Active',
    tagIds: [],
    contextRefs: [],
    ref: {
      id: 'contact-bob',
      kind: 'person',
      matterId: 'matter-foster',
      label: 'Bob Foster',
    },
    status: 'Active',
  },
] as const;

const [robertContact, bobContact] = fosterContacts;

beforeEach(() => {
  liveCrm.hook.mockClear();
  liveCrm.reloadRecords.mockReset();
  liveCrm.save.mockReset();
  liveCrm.records = [
    {
      id: 'household-foster',
      kind: 'household',
      matterId: 'matter-foster',
      name: 'Foster Household',
      lifecycle: 'Active',
      primaryAdvisor: 'Avery',
      serviceTier: 'Planning',
      ownership: 'mine',
      facts: [],
      accounts: [],
      members: [],
      externalParties: [],
      notes: [],
      customFields: [],
      tagIds: [],
      contextRefs: [],
      channels: [],
      contactLinks: [],
    },
    {
      id: 'contact-robert',
      kind: 'person',
      matterId: 'matter-foster',
      firstName: 'Robert',
      lastName: 'Foster',
      lifecycle: 'Active',
      tagIds: [],
      contextRefs: [],
      channels: [],
      contactLinks: [],
    },
    {
      id: 'contact-bob',
      kind: 'person',
      matterId: 'matter-foster',
      firstName: 'Bob',
      lastName: 'Foster',
      lifecycle: 'Active',
      tagIds: [],
      contextRefs: [],
      channels: [],
      contactLinks: [],
    },
  ];
  liveCrm.reloadRecords.mockResolvedValue(liveCrm.records);
  useMatterStore.setState({
    matters: [
      {
        id: 'matter-foster',
        name: 'Foster Household',
        client: 'Foster Household',
        folderPaths: ['/practice/Foster Household'],
        createdAt: '2026-07-18T00:00:00.000Z',
      },
    ],
    activeMatterId: null,
    clientMapHubId: null,
  });
});

afterEach(() => {
  cleanup();
  duplicateReviewPreferences.clear();
  setDevFlagOverride('crm-duplicates', undefined);
});

describe('CRM duplicate review', () => {
  it('finds deterministic person-contact pairs, including the Robert/Bob alias class', () => {
    expect(findLikelyDuplicateContacts(fosterContacts)).toEqual([
      {
        normalizedName: 'robertfoster',
        explanation: 'same-last-name-and-known-given-name-alias',
        records: [
          {
            id: 'contact-bob',
            name: 'Bob Foster',
            ref: bobContact.ref,
          },
          {
            id: 'contact-robert',
            name: 'Robert Foster',
            ref: robertContact.ref,
          },
        ],
      },
    ]);
  });

  it('stays absent while dark without adding a toolbar gap', () => {
    setDevFlagOverride('crm-duplicates', false);

    render(
      <DirectorySurface
        people={[]}
        contacts={fosterContacts}
        composition={defaultDirectoryComposition}
      />
    );

    expect(
      screen.queryByTestId('crm-directory-duplicates')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-toolbar').children).toHaveLength(
      6
    );
    expect(liveCrm.hook).not.toHaveBeenCalled();
  });

  it('detects, reviews, and persists contacts from the canonical store', () => {
    setDevFlagOverride('crm-duplicates', true);
    const firstMount = render(
      <DirectorySurface
        people={[]}
        composition={defaultDirectoryComposition}
      />
    );

    fireEvent.click(screen.getByTestId('crm-directory-duplicates-toggle'));
    expect(screen.getByTestId('crm-duplicates-count')).toHaveTextContent(
      '1 possible duplicate pair'
    );
    expect(
      screen.getByText(
        'These contacts share a last name and a known first-name alias.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    firstMount.unmount();

    const secondMount = render(
      <DirectorySurface
        people={[]}
        composition={defaultDirectoryComposition}
      />
    );
    fireEvent.click(screen.getByTestId('crm-directory-duplicates-toggle'));
    expect(screen.getByText('Reviewed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
    secondMount.unmount();

    render(
      <DirectorySurface
        people={[]}
        composition={defaultDirectoryComposition}
      />
    );
    fireEvent.click(screen.getByTestId('crm-directory-duplicates-toggle'));
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });

  it('opens a canonical duplicate through the real Clients screen navigation path', async () => {
    setDevFlagOverride('crm-duplicates', true);
    render(<ClientsSurface />);

    fireEvent.click(screen.getByTestId('crm-directory-duplicates-toggle'));
    fireEvent.click(screen.getByTestId('crm-duplicates-open-contact-bob'));

    expect(await screen.findByTestId('crm-household-record')).toBeInTheDocument();
    expect(screen.getByText('Foster Household')).toBeInTheDocument();
  });
});
