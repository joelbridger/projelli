/* eslint-disable lantern-i18n/no-hardcoded-string -- feature-owned locale shard is staged with this dark launch surface. */
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { Button, Card, SlidePanel } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { HouseholdRecordShellContext } from '../../recordRegistry';
import type { HouseholdRecord } from '../../adapters';
import { approveHouseholdMerge } from './mergeClient';
import { assessMergeEligibility, buildMergeReview } from './mergeReview';
import type { MergeChoice, RedactedMergeReceipt } from './contract';

function householdFromLive(record: Record<string, unknown>): HouseholdRecord | null {
  if (record.kind !== 'household' || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : 'Untitled household',
    lifecycle: typeof record.lifecycle === 'string' ? record.lifecycle : 'Active',
    primaryAdvisor: typeof record.primaryAdvisor === 'string' ? record.primaryAdvisor : 'Unassigned',
    ownership: record.ownership === 'shared' || record.ownership === 'other' ? record.ownership : 'mine',
    serviceTier: typeof record.serviceTier === 'string' ? record.serviceTier : 'Standard',
    syncState: 'live',
    facts: Array.isArray(record.facts) ? record.facts as HouseholdRecord['facts'] : [],
    accounts: Array.isArray(record.accounts) ? record.accounts as HouseholdRecord['accounts'] : [],
    members: Array.isArray(record.members) ? record.members as HouseholdRecord['members'] : [],
    externalParties: Array.isArray(record.externalParties) ? record.externalParties as HouseholdRecord['externalParties'] : [],
    notes: Array.isArray(record.notes) ? record.notes as HouseholdRecord['notes'] : [],
    customFields: Array.isArray(record.customFields) ? record.customFields as HouseholdRecord['customFields'] : [],
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    contextRefs: Array.isArray(record.contextRefs) ? record.contextRefs as HouseholdRecord['contextRefs'] : [],
  };
}

/** Flag guard intentionally owns no data hook, effect, selector, or command setup. */
export function MergeHeaderAction(context: HouseholdRecordShellContext) {
  const enabled = useFlag('crm-merge-clients');
  if (!enabled) return null;
  return <EnabledMergeHeaderAction {...context} />;
}

function EnabledMergeHeaderAction({ household }: HouseholdRecordShellContext) {
  const live = useLiveCrmRecords();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [choices, setChoices] = useState<Readonly<Record<string, MergeChoice>>>({});
  const [receipt, setReceipt] = useState<RedactedMergeReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceMatterId = live.records.find((record) => record.id === household.id)?.matterId;
  const candidates = useMemo(() => live.records
    .filter((record) => typeof sourceMatterId === 'string' && record.matterId === sourceMatterId)
    .map((record) => householdFromLive(record))
    .filter((record): record is HouseholdRecord => record !== null)
    .filter((record) => assessMergeEligibility(household, record).eligible), [household, live.records, sourceMatterId]);
  const target = candidates.find((candidate) => candidate.id === targetId);
  const review = target ? buildMergeReview(household, target) : null;
  const approve = async () => {
    if (!target || !review || typeof sourceMatterId !== 'string' || review.conflictingFields.some((field) => !choices[field])) return;
    setError(null);
    try {
      const result = await approveHouseholdMerge(live.workspaceRoot, {
        sourceId: household.id, targetId: target.id, matterId: sourceMatterId, actorId: 'local-advisor',
        idempotencyKey: `household-merge:${sourceMatterId}:${household.id}:${target.id}`,
        fieldChoices: choices,
      });
      setReceipt(result.receipt);
      await live.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The merge did not complete. Nothing was changed.'); }
  };
  return <>
    <Button size="sm" variant="secondary" iconLeft={ArrowRightLeft} data-testid="crm-household-merge" onClick={() => { setOpen(true); setReceipt(null); setError(null); }}>
      Merge duplicate
    </Button>
    <SlidePanel open={open} onClose={() => { setOpen(false); }} title="Review duplicate merge">
      <section data-testid="crm-household-merge-review" style={{ display: 'grid', gap: 14 }}>
        {receipt ? <Card variant="raised" data-testid="crm-household-merge-receipt"><strong>Merge complete</strong><p>Receipt {receipt.receiptId}. {receipt.movedReferenceCount} references were kept with the surviving household.</p><Button size="sm" onClick={() => { setOpen(false); }}>Done</Button></Card> : <>
          <p style={{ margin: 0 }}>Choose the household to keep. You will review every conflicting field before anything changes.</p>
          <label>Surviving household<select data-testid="crm-household-merge-target" value={targetId} onChange={(event) => { setTargetId(event.target.value); setChoices({}); }}><option value="">Choose a household</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
          {target && review ? <Card variant="raised"><strong>Review before merge</strong><p>{review.movedReferenceCount} references will be retained. The duplicate stays unchanged until you approve.</p>{review.conflictingFields.length ? review.conflictingFields.map((field) => <fieldset key={field} data-testid={`crm-household-merge-conflict-${field}`}><legend>Keep a value for {field}</legend><label><input type="radio" name={field} checked={choices[field] === 'target'} onChange={() => { setChoices({ ...choices, [field]: 'target' }); }} /> {target.name}</label><label><input type="radio" name={field} checked={choices[field] === 'source'} onChange={() => { setChoices({ ...choices, [field]: 'source' }); }} /> {household.name}</label></fieldset>) : <p>No conflicting fields need a choice.</p>}<Button data-testid="crm-household-merge-approve" disabled={review.conflictingFields.some((field) => !choices[field])} iconLeft={AlertTriangle} onClick={() => { void approve().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'The merge did not complete. Nothing was changed.'); }); }}>Approve merge</Button></Card> : null}
          {!candidates.length ? <p data-testid="crm-household-merge-empty">No accessible household is available to merge with this one.</p> : null}
        </>}
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </SlidePanel>
  </>;
}
