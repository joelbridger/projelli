import { describe, expect, it } from 'vitest';
import {
  openContactRef,
  readAskContactSources,
} from '@/features/crm-contacts';
import {
  openDocumentCitation,
  readAskDocumentSources,
} from '@/features/crm-documents';
import { readApprovedMeetingArtifacts } from '@/features/meetings';
import { readAskEmailDescriptors } from '@/features/crm-connectors';
import type { ContactRecord, ContactRef } from '@/features/crm-contacts';
import type {
  ClientBoundary,
  MeetingArtifact,
  MeetingArtifactRequirement,
  MeetingArtifactStore,
  MeetingStore,
} from '@/features/meetings';
import { compileAskContactProducerImport } from './contactProducer.import';
import { compileAskDocumentProducerImport } from './documentProducer.import';
import { compileAskEmailProducerImport } from './emailProducer.import';
import { compileAskMeetingProducerImport } from './meetingProducer.import';

const clientRef: ContactRef = {
  kind: 'household',
  id: 'client-1',
  matterId: 'matter-1',
  label: 'Avery Client',
};

const client = {
  contactRef: clientRef,
  matterId: 'matter-1',
  revision: 'client-1:1',
};

const contact: ContactRecord = {
  id: 'client-1',
  kind: 'household',
  matterId: 'matter-1',
  displayName: 'Avery Client',
  lifecycle: 'active',
  tagIds: [],
  contextRefs: [
    {
      kind: 'document',
      id: 'Clients/Avery/plan.pdf',
      label: 'Plan',
      matterId: 'matter-1',
    },
  ],
  source: {},
  channels: [],
  contactLinks: [],
  name: 'Avery Client',
};

function artifact(state: MeetingArtifact['state']): MeetingArtifact {
  return {
    id: `${state}-artifact`,
    meetingId: 'meeting-1',
    kind: 'summary',
    schemaVersion: 1,
    producedAt: '2026-07-17T10:00:00.000Z',
    sourceRefs: [],
    provenance: 'local-entry',
    payload: {},
    householdRef: 'client-1',
    matterId: 'matter-1',
    state,
    createdAt: '2026-07-17T10:00:00.000Z',
  };
}

function meetingReaderFixture(): {
  meetings: MeetingStore;
  artifacts: MeetingArtifactStore;
  boundary: ClientBoundary;
  requirements: readonly MeetingArtifactRequirement[];
} {
  const boundary = { householdRef: 'client-1', matterId: 'matter-1' };
  const meetings: MeetingStore = {
    list: [],
    error: null,
    get: () => Promise.resolve(undefined),
    createDraft: () =>
      Promise.reject(new Error('read fixture must not write meetings')),
    update: () =>
      Promise.reject(new Error('read fixture must not write meetings')),
    transition: () =>
      Promise.reject(new Error('read fixture must not write meetings')),
  };
  const artifacts: MeetingArtifactStore = {
    readerFor: (_meetings, receivedBoundary, requirements) => {
      const allowed = new Set(requirements.map((requirement) => requirement.kind));
      const exactClient =
        receivedBoundary.householdRef === boundary.householdRef &&
        receivedBoundary.matterId === boundary.matterId;
      return {
        listForMeeting: (_meeting, kinds = [...allowed]) =>
          exactClient && kinds.includes('summary') && allowed.has('summary')
            ? [artifact('approved'), artifact('produced')]
            : [],
        get: (id) =>
          exactClient && id === 'approved-artifact'
            ? artifact('approved')
            : exactClient && id === 'produced-artifact'
              ? artifact('produced')
              : null,
      };
    },
    append: () =>
      Promise.reject(new Error('read fixture must not append artifacts')),
    approve: () =>
      Promise.reject(new Error('read fixture must not approve artifacts')),
  };
  return {
    meetings,
    artifacts,
    boundary,
    requirements: [{ kind: 'summary', minimumSchemaVersion: 1 }],
  };
}

describe('Ask source producer doorways', () => {
  it('publishes public-index import fixtures for all four producers', () => {
    compileAskContactProducerImport();
    compileAskDocumentProducerImport();
    compileAskEmailProducerImport();
    const { meetings, artifacts } = meetingReaderFixture();
    compileAskMeetingProducerImport(meetings, artifacts);
  });

  it('reads only the exact client contact and seals its opener', () => {
    const sources = readAskContactSources({
      workspaceId: 'workspace-1',
      client,
      contacts: [contact],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: 'crm-contact',
      label: 'Avery Client',
      client,
    });
    expect(sources[0]?.citationOpenPath).not.toHaveProperty('token');
    expect(openContactRef(clientRef)).not.toHaveProperty('token');
    expect(
      readAskContactSources({
        workspaceId: 'workspace-1',
        client: { ...client, matterId: 'wrong-matter' },
        contacts: [contact],
      })
    ).toEqual([]);
    expect(readAskContactSources(null)).toEqual([]);
  });

  it('reads only explicit same-matter document pointers and seals their paths', () => {
    const sources = readAskDocumentSources({
      workspaceId: 'workspace-1',
      client,
      contact,
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: 'document', label: 'Plan', client });
    expect(sources[0]?.citationOpenPath).not.toHaveProperty('token');
    expect(
      openDocumentCitation({
        kind: 'document',
        id: 'Clients/Avery/plan.pdf',
        label: 'Plan',
        matterId: 'matter-1',
      })
    ).not.toHaveProperty('token');
    expect(
      readAskDocumentSources({
        workspaceId: 'workspace-1',
        client: { ...client, matterId: 'wrong-matter' },
        contact,
      })
    ).toEqual([]);
    expect(readAskDocumentSources(null)).toEqual([]);
  });

  it('keeps email at the descriptor boundary and refuses another client', () => {
    const sources = readAskEmailDescriptors({
      workspaceId: 'workspace-1',
      client,
      emails: [
        {
          id: 'mail-1',
          clientRef,
          matterId: 'matter-1',
          label: 'Annual review follow-up',
          date: '2026-07-17',
        },
      ],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: 'email-descriptor',
      label: 'Annual review follow-up',
      date: '2026-07-17',
      client,
    });
    expect(sources[0]?.citationOpenPath).not.toHaveProperty('token');
    expect(
      readAskEmailDescriptors({
        workspaceId: 'workspace-1',
        client,
        emails: [
          {
            id: 'mail-2',
            clientRef: { ...clientRef, id: 'another-client' },
            matterId: 'matter-1',
            label: 'Wrong client',
            date: '2026-07-17',
          },
        ],
      })
    ).toEqual([]);
    expect(readAskEmailDescriptors(null)).toEqual([]);
  });

  it('forwards through the existing approved-only, allowed-kinds meeting reader', () => {
    const { meetings, artifacts, boundary, requirements } = meetingReaderFixture();
    const reader = readApprovedMeetingArtifacts(
      meetings,
      artifacts,
      boundary,
      requirements
    );
    expect(reader?.listApproved('meeting-1')).toEqual([artifact('approved')]);
    expect(reader?.listApproved('meeting-1', ['transcript'])).toEqual([]);
    expect(reader?.get('produced-artifact')).toBeNull();
    expect(reader?.get('approved-artifact')).toEqual(artifact('approved'));
    expect(
      readApprovedMeetingArtifacts(
        meetings,
        artifacts,
        { householdRef: 'another-client', matterId: 'matter-1' },
        requirements
      )?.listApproved('meeting-1')
    ).toEqual([]);
    expect(readApprovedMeetingArtifacts(meetings, artifacts, null, requirements)).toBeNull();
  });
});
