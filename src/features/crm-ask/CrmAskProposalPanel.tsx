/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy is catalogued separately. */
import { useState } from 'react';
import { Button, Card } from '@/ui/kp';
import type { AskTurn } from '@/features/ask/askHelpers';
import { createCrmAskProposal, type CrmAskProposalKind } from './proposals';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import {
  readSelectionOperationDecision,
  useSelectionOperationDecision,
} from '@/platform/client-context';
import { BRAND } from '@/config/brand';

const CRM_PROPOSAL_SELECTION_REQUEST = {
  operationClass: 'client-scoped',
  allowAllMatters: false,
  requireFollowerAgreement: true,
} as const;

export function CrmAskProposalPanel({ answer }: { answer: AskTurn | null }) {
  const live = useLiveCrmRecords();
  const selection = useSelectionOperationDecision(CRM_PROPOSAL_SELECTION_REQUEST);
  const activeMatter = selection.kind === 'matter' ? selection.matter : null;
  const [kind, setKind] = useState<CrmAskProposalKind>('task_create');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!answer || answer.citations.every((citation) => citation.sourceType !== 'crm')) return null;

  const submit = async () => {
    setError(null);
    setSaved(false);
    try {
      const current = readSelectionOperationDecision({
        ...CRM_PROPOSAL_SELECTION_REQUEST,
        ...(activeMatter
          ? { expectedScope: { kind: 'matter' as const, matterId: activeMatter.id } }
          : {}),
      });
      if (current.kind !== 'matter' || !current.client) {
        throw new Error(
          current.kind === 'refused'
            ? current.message
            : 'Choose a confirmed client and try again.',
        );
      }
      await live.save(createCrmAskProposal({
        kind,
        text,
        householdId: current.client.householdId,
        answer,
      }));
      setText('');
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not prepare this proposal.');
    }
  };

  return <Card variant="raised" data-testid="crm-ask-proposal" style={{ margin: '0 var(--kp-gutter) var(--kp-space-md)' }}>
    <strong>Turn this into a proposal</strong>
    <p style={{ margin: '4px 0 10px', color: 'var(--kp-text-dim)' }}>{`${BRAND.name} will not change a client record. It will place this in your approval list first.`}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select aria-label="Proposal type" data-testid="crm-ask-proposal-kind" value={kind} onChange={(event) => { setKind(event.target.value as CrmAskProposalKind); }}>
        <option value="task_create">Propose a task</option>
        <option value="fact_add">Propose a fact</option>
      </select>
      <input data-testid="crm-ask-proposal-text" value={text} onChange={(event) => { setText(event.target.value); }} placeholder={kind === 'task_create' ? 'Task to propose' : 'Fact to propose'} style={{ flex: '1 1 260px' }} />
      <Button data-testid="crm-ask-proposal-submit" disabled={!text.trim() || !activeMatter} onClick={() => { void submit(); }}>Prepare for approval</Button>
    </div>
    {!activeMatter ? <p role="alert" style={{ margin: '8px 0 0', color: 'var(--kp-text-dim)' }}>{selection.kind === 'refused' ? selection.message : 'Open a household first so this proposal has the right client.'}</p> : null}
    {saved ? <p data-testid="crm-ask-proposal-saved" style={{ margin: '8px 0 0', color: 'var(--kp-success)' }}>Proposal saved. Nothing changed until you approve it.</p> : null}
    {error ? <p role="alert" style={{ margin: '8px 0 0', color: 'var(--kp-danger)' }}>{error}</p> : null}
  </Card>;
}
