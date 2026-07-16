import { describe, expect, it } from 'vitest';
import { addDocumentRef, isPlausibleClientDocument, linkedDocumentsForHousehold, linkWorkspaceDocumentToContact, removeDocumentRef } from './documentLinks';

const household = {
  id: 'household-1', name: 'Henderson household', lifecycle: 'Active', primaryAdvisor: 'Maya', ownership: 'mine' as const, serviceTier: 'Standard', syncState: 'live' as const,
  facts: [], accounts: [], members: [{ id: 'person-1', name: 'Dana Henderson', personType: 'person' as const, roles: [], relatedHouseholds: 1, contextRefs: [{ kind: 'document' as const, id: 'Clients/Henderson/tax-return.pdf', label: 'Tax return' }] }], externalParties: [], customFields: [], tags: [],
  notes: [{ id: 'note-1', body: 'Review note', audience: 'internal' as const, links: [{ kind: 'document' as const, id: 'Clients/Henderson/review.docx', label: 'Review packet' }] }],
  contextRefs: [{ kind: 'document' as const, id: 'Clients/Henderson/plan.pdf', label: 'Plan' }],
};

describe('CRM document links', () => {
  it('offers client documents and hides build files and raw data dumps', () => {
    for (const name of [
      'quarterly-statement.pdf',
      'plan.docx',
      'holdings.xlsx',
      'signed-form.png',
      'client-message.eml',
      'meeting.json',
      'transcript.json',
    ]) {
      expect(isPlausibleClientDocument(name), name).toBe(true);
    }

    for (const name of [
      'build_roster.py',
      'cache.pyc',
      'sync.log',
      'MANIFEST.json',
      'wealthbox-contacts-raw.json',
      'PLAN.md',
      'installer.exe',
      'archive.zip',
    ]) {
      expect(isPlausibleClientDocument(name), name).toBe(false);
    }
  });

  it('reads document pointers from the household, people, notes, and linked tasks without creating a file record', () => {
    const linked = linkedDocumentsForHousehold(household, [{ id: 'task-1', kind: 'task', householdRef: { kind: 'household', id: household.id }, title: 'Send plan', contextRefs: [{ kind: 'document', id: 'Clients/Henderson/plan.pdf', label: 'Plan' }] }]);
    expect(linked).toEqual([
      {
        ref: { kind: 'document', id: 'Clients/Henderson/plan.pdf', label: 'Plan' },
        target: 'household',
        contactRef: { kind: 'household', id: 'household-1', matterId: 'household-1', label: 'Henderson household' },
        targetId: 'household-1',
        targetLabel: 'Henderson household',
      },
      {
        ref: { kind: 'document', id: 'Clients/Henderson/tax-return.pdf', label: 'Tax return' },
        target: 'person',
        contactRef: { kind: 'person', id: 'person-1', matterId: 'household-1', label: 'Dana Henderson' },
        targetId: 'person-1',
        targetLabel: 'Dana Henderson',
      },
      {
        ref: { kind: 'document', id: 'Clients/Henderson/review.docx', label: 'Review packet' },
        target: 'note',
        targetId: 'note-1',
        targetLabel: 'Review note',
      },
      {
        ref: { kind: 'document', id: 'Clients/Henderson/plan.pdf', label: 'Plan' },
        target: 'task',
        targetId: 'task-1',
        targetLabel: 'Send plan',
      },
    ]);
  });

  it('adds one pointer once and removes only that document pointer', () => {
    const first = addDocumentRef([], { kind: 'document', id: 'Clients/Henderson/plan.pdf', label: 'Plan' });
    expect(addDocumentRef(first, { kind: 'document', id: 'Clients/Henderson/plan.pdf', label: 'Plan' })).toHaveLength(1);
    expect(removeDocumentRef([...first, { kind: 'household', id: 'household-1' }], 'Clients/Henderson/plan.pdf')).toEqual([{ kind: 'household', id: 'household-1' }]);
  });

  it('links an existing workspace file to any durable contact kind through ContactRef', () => {
    expect(linkWorkspaceDocumentToContact(
      { kind: 'organization', id: 'organization:legal', matterId: 'matter-1', label: 'Lee Legal' },
      { kind: 'document', id: 'Clients/Lee/engagement.pdf', matterId: 'matter-1', label: 'Engagement' },
    )).toEqual({
      contactRef: { kind: 'organization', id: 'organization:legal', matterId: 'matter-1', label: 'Lee Legal' },
      documentRef: { kind: 'document', id: 'Clients/Lee/engagement.pdf', matterId: 'matter-1', label: 'Engagement' },
    });
  });
});
