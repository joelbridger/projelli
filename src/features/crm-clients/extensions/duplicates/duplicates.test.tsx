import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DirectorySurface,
  defaultDirectoryComposition,
} from '@/features/crm-clients';
import type { ContactDirectoryProjection } from '@/features/crm-contacts';
import { setDevFlagOverride } from '@/platform/flags/router';
import { findLikelyDuplicateContacts } from '@/features/crm-clients/extensions/duplicates';
import { duplicateReviewPreferences } from './reviewState';

const fosterContacts: readonly ContactDirectoryProjection[] = [
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
            ref: fosterContacts[1].ref,
          },
          {
            id: 'contact-robert',
            name: 'Robert Foster',
            ref: fosterContacts[0].ref,
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
  });

  it('detects, reviews, persists, and opens person contacts through the real default DirectorySurface', () => {
    setDevFlagOverride('crm-duplicates', true);
    const openContact = vi.fn(() => Promise.resolve());
    const firstMount = render(
      <DirectorySurface
        people={[]}
        contacts={fosterContacts}
        directoryRepository={{
          openContact,
          resolveContact: vi.fn(() => Promise.resolve(null)),
        }}
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
    fireEvent.click(screen.getByTestId('crm-duplicates-open-contact-bob'));
    expect(openContact).toHaveBeenCalledWith(fosterContacts[1].ref);

    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    firstMount.unmount();

    const secondMount = render(
      <DirectorySurface
        people={[]}
        contacts={fosterContacts}
        directoryRepository={{
          openContact,
          resolveContact: vi.fn(() => Promise.resolve(null)),
        }}
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
        contacts={fosterContacts}
        directoryRepository={{
          openContact,
          resolveContact: vi.fn(() => Promise.resolve(null)),
        }}
        composition={defaultDirectoryComposition}
      />
    );
    fireEvent.click(screen.getByTestId('crm-directory-duplicates-toggle'));
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });
});
