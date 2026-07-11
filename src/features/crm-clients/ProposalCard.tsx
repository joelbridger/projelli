import { AlertCircle, Check, Clock3, Mail, RotateCcw, X } from 'lucide-react';
import { Badge, Button, Card, CiteChip } from '@/ui/kp';
import type { CrmClientsActions, CrmProposal } from './adapters';

const KIND_LABEL: Record<CrmProposal['kind'], string> = {
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
  const isTerminal =
    proposal.state === 'approved' || proposal.state === 'dismissed';
  const isCommunication = proposal.kind === 'communication_draft';
  return (
    <Card
      variant="raised"
      data-testid={`crm-proposal-${proposal.id}`}
      style={{
        borderLeft: `4px solid ${proposal.state === 'dismissed' ? '#b45309' : '#0f766e'}`,
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
            proposal.state === 'failed'
              ? 'danger'
              : proposal.state === 'dismissed'
                ? 'warning'
                : 'success'
          }
          icon={
            proposal.state === 'failed'
              ? AlertCircle
              : proposal.state === 'pending'
                ? Clock3
                : Check
          }
        >
          {KIND_LABEL[proposal.kind]}
        </Badge>
        <span style={{ fontWeight: 650 }}>{proposal.context}</span>
        {proposal.changedSinceReview ? (
          <Badge variant="warning">Changed since review</Badge>
        ) : null}
      </div>
      <p style={{ margin: '10px 0 8px' }}>{proposal.rationale}</p>
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
      {proposal.error ? (
        <p role="alert" style={{ color: '#b91c1c' }}>
          {proposal.error}
        </p>
      ) : null}
      {isCommunication && !isTerminal ? (
        <p style={{ fontSize: 13, color: '#475569' }}>
          <Mail
            size={14}
            aria-hidden="true"
            style={{ verticalAlign: 'text-bottom' }}
          />{' '}
          Approval opens the mail review; it does not send anything.
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {proposal.state === 'pending' ? (
          <>
            <Button
              size="sm"
              iconLeft={Check}
              disabled={proposal.changedSinceReview}
              data-testid={`crm-proposal-approve-${proposal.id}`}
              onClick={() => actions?.onApproveProposal?.(proposal.id)}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={X}
              data-testid={`crm-proposal-dismiss-${proposal.id}`}
              onClick={() => actions?.onDismissProposal?.(proposal.id)}
            >
              Dismiss
            </Button>
          </>
        ) : null}
        {proposal.state === 'failed' ? (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={RotateCcw}
            data-testid={`crm-proposal-retry-${proposal.id}`}
            onClick={() => actions?.onRetryProposal?.(proposal.id)}
          >
            Retry
          </Button>
        ) : null}
        {proposal.state === 'dismissed' ? (
          <span style={{ fontSize: 13, color: '#92400e' }}>
            Dismissed. This stays in recoverable history.
          </span>
        ) : null}
        {proposal.state === 'approved' ? (
          <span style={{ fontSize: 13, color: '#166534' }}>
            Approved and recorded.
          </span>
        ) : null}
      </div>
    </Card>
  );
}
