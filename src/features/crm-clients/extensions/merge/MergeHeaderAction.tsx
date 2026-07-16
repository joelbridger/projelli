import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { Button, Card, SlidePanel } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { HouseholdRecordShellContext } from '../../recordRegistry';
import type { HouseholdRecord } from '../../adapters';
import { approveHouseholdMerge } from './mergeClient';
import { assessMergeEligibility, buildMergeReview } from './mergeReview';
import type { MergeChoice, RedactedMergeReceipt } from './contract';

function householdFromLive(record: Record<string, unknown>, fallbacks: Readonly<Record<'untitled' | 'active' | 'unassigned' | 'standard', string>>): HouseholdRecord | null {
  if (record['kind'] !== 'household' || typeof record['id'] !== 'string') return null;
  return {
    id: record['id'],
    name: typeof record['name'] === 'string' ? record['name'] : fallbacks.untitled,
    lifecycle: typeof record['lifecycle'] === 'string' ? record['lifecycle'] : fallbacks.active,
    primaryAdvisor: typeof record['primaryAdvisor'] === 'string' ? record['primaryAdvisor'] : fallbacks.unassigned,
    ownership: record['ownership'] === 'shared' || record['ownership'] === 'other' ? record['ownership'] : 'mine',
    serviceTier: typeof record['serviceTier'] === 'string' ? record['serviceTier'] : fallbacks.standard,
    syncState: 'live',
    facts: Array.isArray(record['facts']) ? record['facts'] as HouseholdRecord['facts'] : [],
    accounts: Array.isArray(record['accounts']) ? record['accounts'] as HouseholdRecord['accounts'] : [],
    members: Array.isArray(record['members']) ? record['members'] as HouseholdRecord['members'] : [],
    externalParties: Array.isArray(record['externalParties']) ? record['externalParties'] as HouseholdRecord['externalParties'] : [],
    notes: Array.isArray(record['notes']) ? record['notes'] as HouseholdRecord['notes'] : [],
    customFields: Array.isArray(record['customFields']) ? record['customFields'] as NonNullable<HouseholdRecord['customFields']> : [],
    tags: Array.isArray(record['tags']) ? record['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
    contextRefs: Array.isArray(record['contextRefs']) ? record['contextRefs'] as NonNullable<HouseholdRecord['contextRefs']> : [],
  };
}

/** Flag guard intentionally owns no data hook, effect, selector, or command setup. */
export function MergeHeaderAction(context: HouseholdRecordShellContext) {
  const enabled = useFlag('crm-merge-clients');
  if (!enabled) return null;
  return <EnabledMergeHeaderAction {...context} />;
}

function EnabledMergeHeaderAction({ household }: HouseholdRecordShellContext) {
  const { t } = useTranslation();
  const live = useLiveCrmRecords();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [choices, setChoices] = useState<Readonly<Record<string, MergeChoice>>>({});
  const [receipt, setReceipt] = useState<RedactedMergeReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fallbacks = {
    untitled: t('crmMerge.untitled-household'),
    active: t('crmMerge.active'),
    unassigned: t('crmMerge.unassigned'),
    standard: t('crmMerge.standard'),
  };
  const sourceMatterId = live.records.find((record) => record.id === household.id)?.matterId;
  const candidates = useMemo(() => live.records
    .filter((record) => typeof sourceMatterId === 'string' && record.matterId === sourceMatterId)
    .map((record) => householdFromLive(record, fallbacks))
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('crmMerge.error')); }
  };
  return <>
    <Button size="sm" variant="secondary" iconLeft={ArrowRightLeft} data-testid="crm-household-merge" onClick={() => { setOpen(true); setReceipt(null); setError(null); }}>
      {t('crmMerge.action')}
    </Button>
    <SlidePanel open={open} onClose={() => { setOpen(false); }} title={t('crmMerge.title')}>
      <section data-testid="crm-household-merge-review" style={{ display: 'grid', gap: 14 }}>
        {receipt ? <Card variant="raised" data-testid="crm-household-merge-receipt"><strong>{t('crmMerge.complete')}</strong><p>{t('crmMerge.receipt', { receiptId: receipt.receiptId, count: receipt.movedReferenceCount })}</p><Button size="sm" onClick={() => { setOpen(false); }}>{t('crmMerge.done')}</Button></Card> : <>
          <p style={{ margin: 0 }}>{t('crmMerge.description')}</p>
          <label>{t('crmMerge.surviving-household')}<select data-testid="crm-household-merge-target" value={targetId} onChange={(event) => { setTargetId(event.target.value); setChoices({}); }}><option value="">{t('crmMerge.choose-household')}</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
          {target && review ? <Card variant="raised"><strong>{t('crmMerge.review')}</strong><p>{t('crmMerge.retained-references', { count: review.movedReferenceCount })}</p>{review.conflictingFields.length ? review.conflictingFields.map((field) => <fieldset key={field} data-testid={`crm-household-merge-conflict-${field}`}><legend>{t('crmMerge.keep-field', { field })}</legend><label><input type="radio" name={field} checked={choices[field] === 'target'} onChange={() => { setChoices({ ...choices, [field]: 'target' }); }} /> {target.name}</label><label><input type="radio" name={field} checked={choices[field] === 'source'} onChange={() => { setChoices({ ...choices, [field]: 'source' }); }} /> {household.name}</label></fieldset>) : <p>{t('crmMerge.no-conflicts')}</p>}<Button data-testid="crm-household-merge-approve" disabled={review.conflictingFields.some((field) => !choices[field])} iconLeft={AlertTriangle} onClick={() => { void approve().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('crmMerge.error')); }); }}>{t('crmMerge.approve')}</Button></Card> : null}
          {!candidates.length ? <p data-testid="crm-household-merge-empty">{t('crmMerge.no-accessible-household')}</p> : null}
        </>}
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </SlidePanel>
  </>;
}
