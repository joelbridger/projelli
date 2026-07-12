/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { GitPullRequest } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { FreshnessBanner, Screen, mutedStyle, panelStyle } from '@/features/crm-home/shared/ui';
import { displayValue, liveStepTitle } from '@/features/crm-home/shared/workflowDisplay';
import { applyWorkflowOffer, decideOffer, stepValue, undoWorkflowApply, type LiveWorkflowInstance, type LiveWorkflowOffer } from '@/features/crm-home/workflowLive';
import type { CrmFreshnessState, OfferDecision, PropagationApplyOffer, PropagationOffer } from '@/features/crm-home/types';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { LiveWorkflowData } from './Workflows';

export function PropagationSurface() {
  const { adapter, workflowData, saveLiveRecord, reportUndo, undoReport } = useCrmHomeSurfaceContext();
  return workflowData && saveLiveRecord
    ? <LivePropagationReview data={workflowData} onSave={saveLiveRecord} />
    : <PropagationReview offers={adapter.offers} freshness={adapter.freshness} onApply={(selected) => adapter.actions.applyPropagation?.(selected)} onUndo={reportUndo} undoReport={undoReport} />;
}

export function PropagationReview({
  offers,
  freshness,
  onApply,
  onUndo,
  undoReport,
}: {
  offers: readonly PropagationOffer[];
  freshness: CrmFreshnessState;
  onApply: (offers: readonly PropagationApplyOffer[]) => void;
  onUndo: () => void;
  undoReport: string | null;
}) {
  const [draft, setDraft] = useState<readonly PropagationOffer[]>(offers);
  const [outcome, setOutcome] = useState<string | null>(null);
  const decisions = (current: readonly PropagationOffer[]) =>
    current.flatMap((offer) => offer.steps.flatMap((step) => step.decisions));
  const unresolved = decisions(draft).filter(
    (decision) => decision.decision === 'review_required'
  );
  const eligible = draft.filter(
    (offer) =>
      offer.state === 'ready' &&
      !offer.steps.some((step) =>
        step.decisions.some(
          (decision) => decision.decision === 'review_required'
        )
      )
  );
  const setDecision = (
    offerId: string,
    decisionId: string,
    decision: OfferDecision['decision']
  ) => {
    setDraft((current) =>
      current.map((offer) =>
        offer.id !== offerId
          ? offer
          : {
              ...offer,
              steps: offer.steps.map((step) => ({
                ...step,
                decisions: step.decisions.map((item) =>
                  item.id === decisionId ? { ...item, decision } : item
                ),
              })),
            }
      )
    );
  };
  const approveAll = () => {
    setDraft((current) =>
      current.map((offer) =>
        offer.steps.some((step) =>
          step.decisions.some(
            (decision) => decision.decision === 'review_required'
          )
        )
          ? offer
          : {
              ...offer,
              steps: offer.steps.map((step) => ({
                ...step,
                decisions: step.decisions.map((decision) => ({
                  ...decision,
                  decision: 'accepted' as const,
                })),
              })),
            }
      )
    );
  };
  const apply = () => {
    if (unresolved.length) {
      setOutcome(
        'Choose keep or apply for every change before continuing. Nothing was changed.'
      );
      return;
    }
    const payload = draft.map((offer) => ({
      offerId: offer.id,
      instanceId: offer.instanceId,
      acceptedDecisions: offer.steps.flatMap((step) =>
        step.decisions
          .filter((decision) => decision.decision === 'accepted')
          .map(({ id, revisionId, stepId, field, reofferState }) => ({
            id,
            revisionId,
            stepId,
            field,
            reofferState,
          }))
      ),
    }));
    onApply(payload);
    setOutcome(
      `${String(payload.flatMap((offer) => offer.acceptedDecisions).length)} workflow change${payload.flatMap((offer) => offer.acceptedDecisions).length === 1 ? '' : 's'} are ready to apply. Completed work and notes will not change.`
    );
  };
  const reportUndo = () => {
    onUndo();
  };
  return (
    <Screen
      title="Workflow update review"
      description="Choose how a template update should affect open household work"
      Icon={GitPullRequest}
      action={
        <Button
          data-testid="crm-propagation-approve-all"
          disabled={
            freshness.kind === 'offline' ||
            freshness.kind === 'syncing' ||
            freshness.kind === 'last-synced'
          }
          onClick={approveAll}
        >
          Apply all clear changes
        </Button>
      }
    >
      <FreshnessBanner freshness={freshness} />
      {(freshness.kind === 'offline' || freshness.kind === 'last-synced') && (
        <div
          role="alert"
          style={{ ...panelStyle, borderColor: 'var(--kp-direct)' }}
        >
          {freshness.kind === 'offline'
            ? 'Reconnect before changing open household workflows. You can still read this review.'
            : 'Lantern is checking for the latest workflow updates before it can apply all of them.'}
        </div>
      )}
      {unresolved.length > 0 && (
        <div
          data-testid="crm-propagation-review-required"
          role="alert"
          style={{ ...panelStyle, borderColor: 'var(--kp-danger)' }}
        >
          Some changes need your choice. Compare each option, then choose Apply
          or Keep current.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={mutedStyle}>
          {draft.length} household{draft.length === 1 ? '' : 's'} to review
        </span>
        <span style={mutedStyle}>{eligible.length} ready</span>
        <span style={mutedStyle}>{unresolved.length} need your choice</span>
      </div>
      {draft.map((offer) => (
        <PropagationOfferCard
          key={offer.id}
          offer={offer}
          onDecision={setDecision}
        />
      ))}
      <footer
        style={{
          ...panelStyle,
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <span>
          {
            decisions(draft).filter(
              (decision) => decision.decision === 'accepted'
            ).length
          }{' '}
          change
          {decisions(draft).filter(
            (decision) => decision.decision === 'accepted'
          ).length === 1
            ? ''
            : 's'}{' '}
          ready across {draft.length} household{draft.length === 1 ? '' : 's'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            data-testid="crm-propagation-undo"
            onClick={reportUndo}
          >
            Undo last update
          </Button>
          <Button
            data-testid="crm-propagation-apply"
            disabled={freshness.kind !== 'live' || unresolved.length > 0}
            onClick={apply}
          >
            Apply changes
          </Button>
        </div>
      </footer>
      {outcome && (
        <p data-testid="crm-propagation-result" role="status">
          {outcome}
        </p>
      )}
      {undoReport && (
        <p data-testid="crm-propagation-undo-report" role="status">
          {undoReport}
        </p>
      )}
    </Screen>
  );
}

function PropagationOfferCard({
  offer,
  onDecision,
}: {
  offer: PropagationOffer;
  onDecision: (
    offerId: string,
    decisionId: string,
    decision: OfferDecision['decision']
  ) => void;
}) {
  const changeCount = offer.steps.reduce(
    (count, step) => count + step.decisions.length,
    0
  );
  return (
    <section
      data-testid={`crm-propagation-offer-${offer.id}`}
      style={panelStyle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{offer.householdLabel}: Template updated</strong>
        <span style={mutedStyle}>
          {changeCount} change{changeCount === 1 ? '' : 's'} to review
        </span>
      </div>
      <p style={mutedStyle}>
        Choose what should change next. Work already done and its notes stay as
        they are.
      </p>
      {offer.steps.map((step) => (
        <section
          key={step.id}
          data-testid={`crm-propagation-step-${step.id}`}
          style={{
            borderTop: '1px solid var(--kp-border)',
            marginTop: 10,
            paddingTop: 10,
          }}
        >
          <strong>{step.label}</strong>
          {step.decisions.map((decision) => (
            <PropagationFieldRow
              key={decision.id}
              decision={decision}
              onDecision={(choice) => {
                onDecision(offer.id, decision.id, choice);
              }}
            />
          ))}
          {step.newAssignmentOffer && (
            <p style={mutedStyle}>
              New work after this update will go to{' '}
              {step.newAssignmentOffer.assigneeLabel}. This does not change work
              already assigned.
            </p>
          )}
          <p style={mutedStyle}>
            {step.protectedProgress.status === 'completed'
              ? 'This step is complete. Its work and notes will not change.'
              : 'Any work already recorded on this step will stay as it is.'}
          </p>
        </section>
      ))}
      <details style={{ marginTop: 10 }}>
        <summary>Details for support</summary>
        <p style={mutedStyle}>
          Update: {offer.revisionLabel}. Record: {offer.id}. Step records:{' '}
          {offer.steps.map((step) => step.id).join(', ')}.
        </p>
      </details>
    </section>
  );
}

function PropagationFieldRow({
  decision,
  onDecision,
}: {
  decision: OfferDecision;
  onDecision: (decision: OfferDecision['decision']) => void;
}) {
  const sentence =
    decision.field === 'due_offset'
      ? `Move due date from ${decision.before ?? 'the current date'} to ${decision.after}`
      : decision.field === 'default_assignee_role'
        ? `Send new work from ${decision.before ?? 'the current person'} to ${decision.after}`
        : decision.field === 'title'
          ? `Rename this step${decision.before ? ` from ${decision.before}` : ''} to ${decision.after}`
          : decision.field === 'required'
            ? `${decision.after === 'true' ? 'Make this step required' : 'Make this step optional'}`
            : decision.field === 'description'
              ? 'Update the step instructions'
              : decision.field === 'order'
                ? `Move this step to ${decision.after}`
                : `${decision.label}: ${decision.before ? `${decision.before} to ` : ''}${decision.after}`;
  return (
    <div
      style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'start' }}
    >
      <span>
        <strong>{sentence}</strong>
        <br />
        <span style={mutedStyle}>
          This is a future-work change. Work already done will stay as it is.
        </span>
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        <Button
          size="sm"
          variant={decision.decision === 'accepted' ? 'primary' : 'secondary'}
          data-testid={`crm-propagation-accept-${decision.id}`}
          onClick={() => {
            onDecision('accepted');
          }}
        >
          Apply
        </Button>
        <Button
          size="sm"
          variant={decision.decision === 'rejected' ? 'primary' : 'secondary'}
          data-testid={`crm-propagation-reject-${decision.id}`}
          onClick={() => {
            onDecision('rejected');
          }}
        >
          Keep current
        </Button>
        {decision.decision === 'review_required' && (
          <span
            data-testid={`crm-propagation-unresolved-${decision.id}`}
            style={mutedStyle}
          >
            Choose one
          </span>
        )}
      </div>
    </div>
  );
}

function plainField(
  decision: LiveWorkflowOffer['engineOffer']['decisions'][number],
  instance: LiveWorkflowInstance
) {
  const before = stepValue(instance, decision.stepId, decision.field);
  const value = displayValue(decision.value);
  if (decision.changeKind === 'add')
    return decision.field === 'title'
      ? `Add “${value}”`
      : `${decision.field === 'defaultAssigneeRole' ? 'Send it to' : decision.field === 'dueOffset' ? 'Schedule it for' : 'Set'} ${value}`;
  if (decision.changeKind === 'remove')
    return 'Remove this untouched future step';
  if (decision.field === 'title')
    return `Rename “${displayValue(before)}” to “${value}”`;
  if (decision.field === 'dueOffset')
    return `Move timing from ${displayValue(before) || 'the current day'} to ${value}`;
  if (decision.field === 'defaultAssigneeRole')
    return `Send new work from ${displayValue(before) || 'the current role'} to ${value}`;
  return `Change ${decision.field} from ${displayValue(before) || 'the current setting'} to ${value}`;
}

export function LivePropagationReview({
  data,
  onSave,
}: {
  data: LiveWorkflowData;
  onSave: (record: LiveCrmRecord) => Promise<unknown>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const offers = data.offers.filter(
    (offer) => offer.engineOffer.state === 'pending'
  );
  const instanceFor = (offer: LiveWorkflowOffer) =>
    data.instances.find(
      (instance) => instance.id === offer.engineOffer.instanceId
    );
  const templateFor = (offer: LiveWorkflowOffer) =>
    data.templates.find((template) => template.id === offer.templateId);
  const change = async (
    offer: LiveWorkflowOffer,
    decisionId: string,
    decision: 'accepted' | 'rejected'
  ) => {
    await onSave(decideOffer(offer, decisionId, decision));
  };
  const apply = async (offer: LiveWorkflowOffer) => {
    const template = templateFor(offer);
    const instance = instanceFor(offer);
    if (!template || !instance) return;
    try {
      const result = applyWorkflowOffer(template, instance, offer);
      await onSave(result.instance);
      await onSave(result.offer);
      setMessage(
        `${offer.householdLabel} is updated. Completed work and notes stayed as they were.`
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const undo = async (instance: LiveWorkflowInstance) => {
    const result = undoWorkflowApply(instance);
    await onSave(result.instance);
    setMessage(
      result.protectedCells.length
        ? `Restored ${String(result.undoneCells.length)} untouched change${result.undoneCells.length === 1 ? '' : 's'}. Kept ${String(result.protectedCells.length)} later household change${result.protectedCells.length === 1 ? '' : 's'}: ${result.protectedCells.join(', ')}.`
        : `Restored ${String(result.undoneCells.length)} untouched change${result.undoneCells.length === 1 ? '' : 's'}. No later household changes needed to stay.`
    );
  };
  return (
    <Screen
      title="Workflow update review"
      description="Choose how a template update should affect open household work"
      Icon={GitPullRequest}
      action={undefined}
    >
      {offers.length === 0 ? (
        <section style={panelStyle}>
          <strong>No workflow updates waiting for review</strong>
          <p style={mutedStyle}>
            When you update a workflow template, each household’s open work will
            appear here for a simple choice.
          </p>
        </section>
      ) : (
        <>
          <section style={panelStyle}>
            <strong>Workflow updates ready to review</strong>
            <p style={mutedStyle}>
              Choose what should change for each household. Work already done
              stays exactly as it is.
            </p>
          </section>
          {offers.map((offer) => {
            const instance = instanceFor(offer);
            const grouped = new Map<
              string,
              LiveWorkflowOffer['engineOffer']['decisions']
            >();
            for (const decision of offer.engineOffer.decisions)
              grouped.set(decision.stepId, [
                ...(grouped.get(decision.stepId) ?? []),
                decision,
              ]);
            const changeCount = offer.engineOffer.decisions.length;
            const ready =
              !offer.engineOffer.requiresConcurrentHeadReview &&
              !offer.engineOffer.decisions.some(
                (decision) => decision.decision === 'review_required'
              );
            return (
              <section
                key={offer.id}
                data-testid={`crm-live-propagation-offer-${offer.id}`}
                style={panelStyle}
              >
                <strong>{offer.householdLabel}: Template updated</strong>
                <p style={mutedStyle}>
                  {changeCount} change{changeCount === 1 ? '' : 's'} to review.
                  Work already done stays as it is.
                </p>
                {offer.engineOffer.requiresConcurrentHeadReview && (
                  <p
                    role="alert"
                    style={{ ...panelStyle, borderColor: 'var(--kp-direct)' }}
                  >
                    This workflow was changed in two places. Compare each choice
                    before applying.
                  </p>
                )}
                {[...grouped.entries()].map(([stepId, decisions]) => (
                  <div
                    key={stepId}
                    style={{
                      borderTop: '1px solid var(--kp-border)',
                      paddingTop: 9,
                      marginTop: 9,
                    }}
                  >
                    <strong>
                      {instance
                        ? liveStepTitle(instance, stepId)
                        : 'New workflow step'}
                    </strong>
                    {instance?.snapshot.steps[stepId]?.status === 'done' && (
                      <p style={mutedStyle}>
                        This step is complete. Its completed work and notes will
                        not change.
                      </p>
                    )}
                    {decisions.map((decision) => (
                      <div
                        key={decision.id}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          padding: '6px 0',
                        }}
                      >
                        <span style={{ flex: 1 }}>
                          {plainField(
                            decision,
                            instance ??
                              ({
                                snapshot: { steps: {} },
                              } as LiveWorkflowInstance)
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant={
                            decision.decision === 'accepted'
                              ? 'primary'
                              : 'secondary'
                          }
                          data-testid={`crm-live-propagation-accept-${decision.id}`}
                          onClick={() => {
                            void change(offer, decision.id, 'accepted');
                          }}
                        >
                          Apply
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            decision.decision === 'rejected'
                              ? 'primary'
                              : 'secondary'
                          }
                          data-testid={`crm-live-propagation-reject-${decision.id}`}
                          onClick={() => {
                            void change(offer, decision.id, 'rejected');
                          }}
                        >
                          Keep current
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
                <details style={{ marginTop: 10 }}>
                  <summary>Details for support</summary>
                  <p style={mutedStyle}>
                    Update: {offer.revisionLabel}. Record: {offer.id}. Workflow:{' '}
                    {offer.engineOffer.instanceId}.
                  </p>
                </details>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button
                    data-testid={`crm-live-propagation-apply-${offer.id}`}
                    disabled={!ready}
                    onClick={() => {
                      void apply(offer);
                    }}
                  >
                    Apply these changes
                  </Button>
                  {instance?.lastApplyEventId && (
                    <Button
                      variant="secondary"
                      data-testid={`crm-live-propagation-undo-${instance.id}`}
                      onClick={() => {
                        void undo(instance);
                      }}
                    >
                      Undo last update
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}
      {data.instances
        .filter((instance) => instance.lastApplyEventId)
        .map((instance) => (
          <section key={`undo-${instance.id}`} style={panelStyle}>
            <strong>{instance.householdLabel}</strong>
            <span style={mutedStyle}>
              {' '}
              · Last update can be undone safely. Later household edits will
              stay in place.
            </span>
            <Button
              data-testid={`crm-live-propagation-undo-${instance.id}`}
              variant="secondary"
              style={{ marginLeft: 8 }}
              onClick={() => {
                void undo(instance);
              }}
            >
              Undo last update
            </Button>
          </section>
        ))}
      {message && (
        <p data-testid="crm-live-propagation-result" role="status">
          {message}
        </p>
      )}
    </Screen>
  );
}
