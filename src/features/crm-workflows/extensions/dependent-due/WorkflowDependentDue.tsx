import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkflowStepExtensionContext } from '@/features/crm-workflows';
import { liveStepTitle } from '@/features/crm-home/shared/workflowDisplay';
import { useFlag } from '@/platform/flags';
import { Button, Card } from '@/ui/kp';
import {
  getWorkflowStepTiming,
  saveWorkflowStepTiming,
} from './contract';
import type {
  WorkflowDueBase,
  WorkflowDueDirection,
  WorkflowDueUnit,
} from '../../workflowStepPersistence';

function WorkflowDependentDueEnabled({ context }: { context: WorkflowStepExtensionContext }) {
  const { t } = useTranslation();
  const timing = getWorkflowStepTiming(context);
  const order = Object.values(context.instance.snapshot.steps).map((step) => step.stepId);
  const position = order.indexOf(context.stepId);
  const hasPredecessor = position > 0;
  const predecessorStepId = hasPredecessor ? order[position - 1] : undefined;
  const predecessorTitle = predecessorStepId
    ? liveStepTitle(context.instance, predecessorStepId)
    : undefined;
  const [base, setBase] = useState<WorkflowDueBase>(
    timing.rule?.base === 'predecessor_completion' && hasPredecessor
      ? 'predecessor_completion'
      : 'workflow_start',
  );
  const [direction, setDirection] = useState<WorkflowDueDirection>(timing.rule?.direction ?? 'after');
  const [offset, setOffset] = useState(String(timing.rule?.offset ?? 0));
  const [unit, setUnit] = useState<WorkflowDueUnit>(timing.rule?.unit ?? 'days');
  const [sequential, setSequential] = useState(timing.sequential);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const summaryAmount = offset.trim() || '0';
  const numericAmount = Number(summaryAmount);
  const summaryCount = Number.isFinite(numericAmount) ? numericAmount : 0;
  const summaryUnit = unit === 'days'
    ? t('workflowDependentDue.summaryDay', { count: summaryCount })
    : unit === 'weeks'
      ? t('workflowDependentDue.summaryWeek', { count: summaryCount })
      : t('workflowDependentDue.summaryMonth', { count: summaryCount });
  const timingSummary = base === 'predecessor_completion' && predecessorTitle
    ? direction === 'after'
      ? t('workflowDependentDue.summaryPredecessorAfter', { amount: summaryAmount, unit: summaryUnit, title: predecessorTitle })
      : t('workflowDependentDue.summaryPredecessorBefore', { amount: summaryAmount, unit: summaryUnit, title: predecessorTitle })
    : direction === 'after'
      ? t('workflowDependentDue.summaryWorkflowAfter', { amount: summaryAmount, unit: summaryUnit })
      : t('workflowDependentDue.summaryWorkflowBefore', { amount: summaryAmount, unit: summaryUnit });

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveWorkflowStepTiming(context, {
        base,
        direction,
        offset: Number(offset),
        unit,
        sequential,
      });
      setMessage(t('workflowDependentDue.saved'));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : t('workflowDependentDue.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid={`workflow-dependent-due-${context.instance.id}-${context.stepId}`} variant="raised">
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <div>
          <strong>{t('workflowDependentDue.heading')}</strong>
          <p style={{ margin: '4px 0 0' }}>{t('workflowDependentDue.copy')}</p>
        </div>
        <Clock3 aria-hidden="true" size={18} />
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>
        <input
          checked={sequential}
          data-testid="workflow-dependent-due-sequential"
          onChange={(event) => { setSequential(event.target.checked); }}
          type="checkbox"
        />{' '}
        {t('workflowDependentDue.sequential')}
      </label>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 4, maxWidth: 320 }}>
          {t('workflowDependentDue.basedOn')}
          <select
            data-testid="workflow-dependent-due-base"
            onChange={(event) => { setBase(event.target.value as WorkflowDueBase); }}
            value={base}
          >
            <option value="workflow_start">{t('workflowDependentDue.workflowStart')}</option>
            {hasPredecessor ? (
              <option value="predecessor_completion">
                {t('workflowDependentDue.previousStep', { title: predecessorTitle ?? t('workflowDependentDue.untitledStep') })}
              </option>
            ) : null}
          </select>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('workflowDependentDue.direction')}
            <select
              data-testid="workflow-dependent-due-direction"
              onChange={(event) => { setDirection(event.target.value as WorkflowDueDirection); }}
              value={direction}
            >
              <option value="after">{t('workflowDependentDue.after')}</option>
              <option value="before">{t('workflowDependentDue.before')}</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('workflowDependentDue.offset')}
            <input
              data-testid="workflow-dependent-due-offset"
              min="0"
              onChange={(event) => { setOffset(event.target.value); }}
              step="1"
              type="number"
              value={offset}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('workflowDependentDue.unit')}
            <select
              data-testid="workflow-dependent-due-unit"
              onChange={(event) => { setUnit(event.target.value as WorkflowDueUnit); }}
              value={unit}
            >
              <option value="days">{t('workflowDependentDue.days')}</option>
              <option value="weeks">{t('workflowDependentDue.weeks')}</option>
              <option value="months">{t('workflowDependentDue.months')}</option>
            </select>
          </label>
        </div>
      </div>
      <p data-testid="workflow-dependent-due-summary" style={{ fontWeight: 600, margin: '12px 0 0' }}>
        {timingSummary}
      </p>
      {timing.dueAt ? (
        <p data-testid="workflow-dependent-due-current">
          {t('workflowDependentDue.currentDue', { date: new Date(timing.dueAt).toLocaleString() })}
        </p>
      ) : (
        <p data-testid="workflow-dependent-due-waiting">{t('workflowDependentDue.waiting')}</p>
      )}
      {timing.blockedByStepId ? (
        <p data-testid="workflow-dependent-due-blocked">{t('workflowDependentDue.blocked')}</p>
      ) : null}
      <Button
        data-testid="workflow-dependent-due-save"
        disabled={saving}
        onClick={() => {
          void save().catch((reason: unknown) => {
            setMessage(reason instanceof Error ? reason.message : t('workflowDependentDue.saveFailed'));
          });
        }}
        size="sm"
      >
        {saving ? t('workflowDependentDue.saving') : t('workflowDependentDue.save')}
      </Button>
      {message ? <p data-testid="workflow-dependent-due-message" role="status">{message}</p> : null}
    </Card>
  );
}

/** The flag check stays outside every workflow metadata read and save setup. */
export function WorkflowDependentDue({ context }: { context: WorkflowStepExtensionContext }) {
  const enabled = useFlag('workflow-dependent-due');
  if (!enabled) return null;
  return <WorkflowDependentDueEnabled context={context} />;
}
