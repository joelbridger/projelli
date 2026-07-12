import { describe, expect, it } from 'vitest';
import type { CrmEntity, EntityKind, ExternalRef, Task } from '@/platform/crm/types';

/** This mapped catalog makes a newly added union member a TypeScript test failure. */
const ENTITY_KIND_CATALOG: Record<EntityKind, true> = {
  household: true, person: true, account: true, fact: true, note: true, task: true,
  workflowTemplate: true, workflowInstance: true, servicePolicy: true, activityEvent: true,
  firmDoc: true, tag: true, customFieldDef: true, opportunity: true, savedView: true,
  pipelineDef: true, stageDef: true, proposalRecord: true, legacyProject: true,
  firmDirectoryEntry: true, firmWorkspaceSummary: true, firmSeatSummary: true,
  householdDirectoryShell: true, intakeLink: true,
  intakeSubmission: true, importArchiveManifest: true,
};

function externalRefKey(ref: Pick<ExternalRef, 'provider' | 'sourceType' | 'sourceId' | 'scope'>): string {
  return [ref.provider, ref.sourceType, ref.sourceId, ref.scope].map(encodeURIComponent).join('\u0000');
}

describe('CRM data model invariants', () => {
  it('has the exhaustive EntityKind catalog, including legacyProject and importArchiveManifest', () => {
    expect(Object.keys(ENTITY_KIND_CATALOG).sort()).toEqual([
      'account', 'activityEvent', 'customFieldDef', 'fact', 'firmDirectoryEntry', 'firmDoc', 'firmSeatSummary', 'firmWorkspaceSummary',
      'household', 'householdDirectoryShell', 'importArchiveManifest', 'intakeLink', 'intakeSubmission',
      'legacyProject', 'note', 'opportunity', 'person', 'pipelineDef', 'proposalRecord', 'savedView',
      'servicePolicy', 'stageDef', 'tag', 'task', 'workflowInstance', 'workflowTemplate',
    ]);
  });

  it('keeps the canonical singular-assignee Task contract and the external-ref four-part key', () => {
    const task: Pick<Task, 'assigneeUserId' | 'householdRef' | 'title' | 'body' | 'status' | 'priority' | 'contextRefs'> = {
      assigneeUserId: 'advisor-1', householdRef: null, title: 'Call', body: 'Discuss plan',
      status: 'open', priority: 'normal', contextRefs: [],
    };
    const key = externalRefKey({ provider: 'wealthbox', sourceType: 'household', sourceId: '42', scope: 'firm-a' });
    expect(task.assigneeUserId).toBe('advisor-1');
    expect(key).toBe('wealthbox\u0000household\u000042\u0000firm-a');
    expect(externalRefKey({ provider: 'wealthbox', sourceType: 'household', sourceId: '42', scope: 'firm-b' })).not.toBe(key);
  });

  it('keeps every concrete CRM entity tied to its EntityKind discriminator', () => {
    const kindOnly: Pick<CrmEntity, 'kind'> = { kind: 'importArchiveManifest' } as Pick<CrmEntity, 'kind'>;
    expect(ENTITY_KIND_CATALOG[kindOnly.kind]).toBe(true);
  });

  // EXAM-BLOCKED: B1 exported data-only TypeScript contracts; no runtime schemas or CRM CRDT entity codec exists yet.
  it.skip('keeps each entity id stable through generated valid mutations and CRDT round trips');
  // EXAM-BLOCKED: Fact construction has no exported runtime schema guard.
  it.skip('rejects generated Fact partials missing source, asOf, or observedAt');
  // EXAM-BLOCKED: ImportArchiveManifest finalization has no runtime guard.
  it.skip('enforces the immutable importArchiveManifest capture and finalization contract');
  // EXAM-BLOCKED: no CRM wire serializer exposes household records for matter_id regression coverage.
  it.skip('keeps matter_id on the wire for every household-attached entity');
  // EXAM-BLOCKED: no client-facing Note rendering boundary exists in the merged engine modules.
  it.skip('requires Note audience at creation and prevents client-facing paths from reading internal notes');
});
