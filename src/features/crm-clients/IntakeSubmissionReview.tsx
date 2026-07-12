/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Badge, Button, Card } from '@/ui/kp';
import type { CrmClientsActions, IntakeSubmission } from './adapters';

/** Submission review never writes a household directly; a person deliberately matches or creates. */
export function IntakeSubmissionReview({
  submission,
  actions,
}: {
  submission: IntakeSubmission;
  actions?: CrmClientsActions;
}) {
  const [choice, setChoice] = useState(submission.matchedHouseholdId ?? '');
  const matched = submission.matchedHouseholdId
    ? submission.candidates.find(
        (candidate) => candidate.householdId === submission.matchedHouseholdId
      )
    : undefined;
  return (
    <Card variant="raised" data-testid={`crm-intake-review-${submission.id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Intake submission review</h2>
          <p>
            From {submission.submitterLabel} · {submission.submittedAt}
          </p>
        </div>
        <Badge variant="warning">Review required</Badge>
      </div>
      {matched ? (
        <>
          <div style={{ padding: 10, background: 'var(--color-blue-50)' }}>
            <Check size={14} aria-hidden="true" /> Matched to {matched.name}.
            Review each proposed dated fact before saving.
            <Button
              size="sm"
              variant="secondary"
              data-testid="crm-intake-open-matched-household"
              onClick={() => actions?.onOpenHousehold?.(matched.householdId)}
              style={{ marginLeft: 8 }}
            >
              Open household
            </Button>
          </div>
          <section aria-label="Proposed dated facts" style={{ marginTop: 12 }}>
            <h3>Proposed dated facts</h3>
            {submission.extractedFacts?.length ? (
              submission.extractedFacts.map((proposal) => (
                <Card
                  key={proposal.id}
                  variant="raised"
                  data-testid={`crm-intake-fact-${proposal.id}`}
                  style={{ marginTop: 8 }}
                >
                  <strong>{proposal.label}: {proposal.value}</strong>
                  <p style={{ margin: '4px 0' }}>
                    As of {proposal.asOf} · Source: {proposal.sourceLabel}
                  </p>
                  {proposal.state === 'pending' ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        size="sm"
                        data-testid={`crm-intake-approve-fact-${proposal.id}`}
                        onClick={() => actions?.onApproveIntakeFact?.(submission.id, proposal.id)}
                      >
                        Approve fact
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`crm-intake-reject-fact-${proposal.id}`}
                        onClick={() => actions?.onRejectIntakeFact?.(submission.id, proposal.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Badge variant={proposal.state === 'approved' ? 'success' : 'warning'}>
                      {proposal.state === 'approved' ? 'Approved' : 'Rejected'}
                    </Badge>
                  )}
                </Card>
              ))
            ) : (
              <p>No dated facts were extracted from this response.</p>
            )}
          </section>
        </>
      ) : (
        <>
          <p>This response is not written to a household yet.</p>
          <fieldset>
            <legend>Match this response</legend>
            {submission.candidates.map((candidate) => (
              <label
                key={candidate.householdId}
                style={{ display: 'block', margin: '8px 0' }}
              >
                <input
                  type="radio"
                  name={`intake-${submission.id}`}
                  value={candidate.householdId}
                  checked={choice === candidate.householdId}
                  onChange={() => { setChoice(candidate.householdId); }}
                />{' '}
                {candidate.name}{' '}
                <Badge
                  variant={
                    candidate.confidence === 'high' ? 'success' : 'warning'
                  }
                >
                  {candidate.confidence}
                </Badge>
              </label>
            ))}
          </fieldset>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="sm"
              disabled={!choice}
              data-testid="crm-intake-confirm-match"
              onClick={() => actions?.onMatchIntake?.(submission.id, choice)}
            >
              Review with household
            </Button>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={Plus}
              data-testid="crm-intake-create-household"
              onClick={() =>
                actions?.onCreateHouseholdForIntake?.(submission.id)
              }
            >
              Create household
            </Button>
          </div>
        </>
      )}
      <h3>Submitted fields</h3>
      {submission.fields.map((field) => (
        <p key={field.label}>
          <strong>{field.label}</strong>: {field.value}
        </p>
      ))}
    </Card>
  );
}
