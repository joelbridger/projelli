import type { AnswerCitation, AskTurn } from '@/features/ask/askHelpers';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { isCrmCitationPath, parseCrmCitationPath } from './retrieval';
import { BRAND } from '@/config/brand';

export type CrmAskProposalKind = 'fact_add' | 'task_create';

export interface CrmAskProposalInput {
  kind: CrmAskProposalKind;
  text: string;
  householdId: string | null;
  answer: AskTurn;
  now?: string;
}

function citedRecordRefs(citations: readonly AnswerCitation[]) {
  return citations.flatMap((citation) => {
    if (!isCrmCitationPath(citation.path)) return [];
    const parsed = parseCrmCitationPath(citation.path ?? '');
    return parsed
      ? [{ kind: parsed.entityKind, id: parsed.entityId, matterId: citation.matterId }]
      : [];
  });
}

/** Builds a durable approval record. It never writes the proposed fact or task. */
export function createCrmAskProposal(input: CrmAskProposalInput): LiveCrmRecord {
  const text = input.text.trim();
  if (!text) throw new Error('Describe the fact or task before creating a proposal.');
  if (!input.householdId) throw new Error('Open a household before proposing a CRM change.');

  const now = input.now ?? new Date().toISOString();
  const householdRef = {
    kind: 'household',
    id: input.householdId,
    matterId: input.householdId,
  };
  const contextRefs = citedRecordRefs(input.answer.citations);
  const id = 'ask-proposal-' + crypto.randomUUID();

  return input.kind === 'task_create'
    ? {
        id,
        kind: 'proposalRecord',
        matterId: input.householdId,
        createdAt: now,
        updatedAt: now,
        householdRef,
        proposalKind: 'task_create',
        proposedMutation: {
          kind: 'task_create',
          task: {
            householdRef,
            title: text,
            assigneeUserId: null,
            priority: 'normal',
            contextRefs,
          },
        },
        proposedBy: { userId: 'lantern-ai', display: BRAND.name, kind: 'ai' },
        rationale: 'Prepared from this cited Ask answer. It is waiting for your approval.',
        contextRefs,
        state: 'pending',
      }
    : {
        id,
        kind: 'proposalRecord',
        matterId: input.householdId,
        createdAt: now,
        updatedAt: now,
        householdRef,
        proposalKind: 'fact_add',
        proposedMutation: {
          kind: 'fact_add',
          fact: {
            householdId: input.householdId,
            factType: 'note_fact',
            label: 'Fact proposed from Ask',
            value: { t: 'text', v: text },
            text,
            asOf: now.slice(0, 10),
            observedAt: now,
          },
        },
        proposedBy: { userId: 'lantern-ai', display: BRAND.name, kind: 'ai' },
        rationale: 'Prepared from this cited Ask answer. It is waiting for your approval.',
        contextRefs,
        state: 'pending',
      };
}
