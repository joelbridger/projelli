/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { AlertCircle, Check, Clock3, Mail, RotateCcw, X } from 'lucide-react';
import { Badge, Button, Card, CiteChip } from '@/ui/kp';
import type { CrmClientsActions, CrmProposal } from './adapters';

const KIND_LABEL: Record<CrmProposal['record']['proposalKind'], string> = {
  workflow_launch: 'Start workflow',
  task_create: 'Create task',
  fact_add: 'Add fact',
  communication_draft: 'Draft communication',
};

/** A durable proposal record, never a generic UI-only suggestion. */
export function ProposalCard({
  proposal,
  actions,
}: {
  proposal: CrmProposal;
  actions?: CrmClientsActions;
}) {
  const { record, review } = proposal;
  const isTerminal =
    record.state === 'approved' ||
    record.state === 'rejected' ||
    record.state === 'expired';
  const isCommunication = record.proposalKind === 'communication_draft';
  const changedSinceReview = review?.changedSinceReview;
  return (
    <Card
      variant="raised"
      data-testid={`crm-proposal-${record.id}`}
      style={{
        borderLeft: `4px solid ${record.state === 'rejected' || record.state === 'expired' ? 'var(--kp-warning)' : 'var(--color-teal-700)'}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Badge
          variant={
            proposal.deliveryError
              ? 'danger'
              : record.state === 'rejected' || record.state === 'expired'
                ? 'warning'
                : 'success'
          }
          icon={
            proposal.deliveryError
              ? AlertCircle
              : record.state === 'pending'
                ? Clock3
                : Check
          }
        >
          {KIND_LABEL[record.proposalKind]}
        </Badge>
        <span style={{ fontWeight: 650 }}>
          {proposal.contextLabel ?? (record.contextRefs.map((ref) => ref.label ?? ref.id).join(' · ') || 'Firm proposal')}
        </span>
        {changedSinceReview ? (
          <Badge variant="warning">Changed since review</Badge>
        ) : null}
      </div>
      <p style={{ margin: '10px 0 8px' }}>{record.rationale}</p>
      {changedSinceReview ? (
        <div
          data-testid={`crm-proposal-diff-${record.id}`}
          style={{ borderLeft: '3px solid var(--kp-warning)', paddingLeft: 10, color: 'var(--color-amber-900)' }}
        >
          <strong>Changed since review. Your selection was cleared.</strong>
          <div><span style={{ color: 'var(--color-red-700)' }}>Before: {review.before ?? 'Previous proposed change'}</span></div>
          <div><span style={{ color: 'var(--color-emerald-700)' }}>Now: {review.after ?? 'Updated proposed change'}</span></div>
          <p style={{ marginBottom: 0 }}>Review this tracked change before approving.</p>
        </div>
      ) : null}
      {proposal.sources.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {proposal.sources.map((source) => (
            <CiteChip
              key={source.id}
              docLabel={source.label}
              quote={source.asOf ?? 'Source available'}
            >
              {source.label}
            </CiteChip>
          ))}
        </div>
      ) : null}
      {proposal.deliveryError ? (
        <p role="alert" style={{ color: 'var(--color-red-700)' }}>
          {proposal.deliveryError}
        </p>
      ) : null}
      {isCommunication && !isTerminal ? (
        <p style={{ fontSize: 13, color: 'var(--color-slate-600)' }}>
          <Mail
            size={14}
            aria-hidden="true"
            style={{ verticalAlign: 'text-bottom' }}
          />{' '}
          Approval opens the mail review; it does not send anything.
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {record.state === 'pending' ? (
          <>
            <Button
              size="sm"
              iconLeft={Check}
              disabled={changedSinceReview}
              data-testid={`crm-proposal-approve-${record.id}`}
              onClick={() => actions?.onApproveProposal?.(record.id)}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={X}
              data-testid={`crm-proposal-dismiss-${record.id}`}
              onClick={() => actions?.onRejectProposal?.(record.id)}
            >
              Dismiss
            </Button>
          </>
        ) : null}
        {proposal.deliveryError ? (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={RotateCcw}
            data-testid={`crm-proposal-retry-${record.id}`}
            onClick={() => actions?.onRetryProposal?.(record.id)}
          >
            Retry
          </Button>
        ) : null}
        {record.state === 'rejected' ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--color-amber-800)' }}>
              Dismissed. This stays in recoverable history.
            </span>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={RotateCcw}
              data-testid={`crm-proposal-restore-${record.id}`}
              onClick={() => actions?.onRestoreProposal?.(record.id)}
            >
              Restore for review
            </Button>
          </>
        ) : null}
        {record.state === 'expired' ? (
          <span style={{ fontSize: 13, color: 'var(--color-amber-800)' }}>Expired. This remains in history.</span>
        ) : null}
        {record.state === 'approved' ? (
          <span style={{ fontSize: 13, color: 'var(--color-green-800)' }}>
            Approved and recorded.
          </span>
        ) : null}
      </div>
    </Card>
  );
}
