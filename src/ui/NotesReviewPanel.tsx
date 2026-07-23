import { useEffect, useState, type CSSProperties } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '@/ui/kp';
import type {
  ExactMeetingCrmReviewItem,
  ExactMeetingNotesReviewItem,
  NotesReviewClientPair,
  NotesReviewCrmFieldChange,
  NotesReviewCrmFieldValue,
  NotesReviewPanelProps,
  NotesReviewReceipt,
} from './notesReview';

const KIND_LABELS = {
  task: 'Tasks',
  'crm-update': 'CRM updates',
} as const;

function inputStyle(): CSSProperties {
  return {
    minHeight: 34,
    width: '100%',
    border: '1px solid var(--kp-divider)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-background)',
    color: 'var(--color-foreground)',
    fontFamily: 'inherit',
    fontSize: 'var(--kp-font-sm)',
    padding: '6px 8px',
  };
}

function valueForInput(value: NotesReviewCrmFieldValue): string {
  if (value === null) return '';
  return String(value);
}

function editedCrmValue(
  field: NotesReviewCrmFieldChange,
  raw: string
): NotesReviewCrmFieldValue {
  if (field.valueType === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : field.proposed;
  }
  if (field.valueType === 'boolean') return raw === 'true';
  return raw;
}

/**
 * One destination-specific, exact-meeting review tab. Edits stay in component
 * memory. Merely rendering, loading, or typing never calls the approval port.
 */
export function NotesReviewPanel<Client extends NotesReviewClientPair>({
  reviewKind,
  state,
  onRetry,
  onApprove,
  onReject,
}: NotesReviewPanelProps<Client>) {
  const { t } = useTranslation();
  const [edits, setEdits] = useState<
    Record<string, ExactMeetingNotesReviewItem<Client>>
  >({});
  const [receipts, setReceipts] = useState<Record<string, NotesReviewReceipt>>(
    state.kind === 'populated' ? { ...(state.receipts ?? {}) } : {}
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [approvedAfterErrors, setApprovedAfterErrors] = useState<
    Record<string, true>
  >({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  useEffect(() => {
    if (state.kind === 'populated') {
      setReceipts({ ...(state.receipts ?? {}) });
      setEdits(
        (current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) =>
              state.items.some(
                (item) => item.id === id && item.approvalState === 'proposed'
              )
            )
          ) as Record<string, ExactMeetingNotesReviewItem<Client>>
      );
    }
  }, [state]);

  const label = KIND_LABELS[reviewKind];
  if (state.kind === 'loading') {
    return (
      <div data-testid={`notes-review-${reviewKind}-loading`} role="status">
        <Loader2 size={16} aria-hidden="true" /> Loading {label.toLowerCase()}…
      </div>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div data-testid={`notes-review-${reviewKind}-empty`}>
        {t('meetings.review.not-produced', { label })}
      </div>
    );
  }
  if (state.kind === 'blocked') {
    return (
      <div data-testid={`notes-review-${reviewKind}-blocked`} role="alert">
        {state.message}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div data-testid={`notes-review-${reviewKind}-error`} role="alert">
        <CircleAlert size={16} aria-hidden="true" /> {state.message}
        {onRetry && (
          <Button
            data-testid={`notes-review-${reviewKind}-retry`}
            size="sm"
            variant="secondary"
            onClick={onRetry}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  const approve = async (source: ExactMeetingNotesReviewItem<Client>) => {
    const item = edits[source.id] ?? source;
    setApprovingId(source.id);
    setErrors((current) => {
      const { [source.id]: _removed, ...rest } = current;
      return rest;
    });
    try {
      const receipt = await onApprove(item);
      setReceipts((current) => ({ ...current, [source.id]: receipt }));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'approvalRecorded' in error &&
        error.approvalRecorded === true
      ) {
        setApprovedAfterErrors((current) => ({
          ...current,
          [source.id]: true,
        }));
      }
      setErrors((current) => ({
        ...current,
        [source.id]:
          error instanceof Error
            ? error.message
            : 'Could not approve this item. Nothing was changed.',
      }));
    } finally {
      setApprovingId(null);
    }
  };

  const reject = async (source: ExactMeetingNotesReviewItem<Client>) => {
    if (!onReject) return;
    const item = edits[source.id] ?? source;
    setApprovingId(source.id);
    try {
      await onReject(item);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [source.id]:
          error instanceof Error
            ? error.message
            : 'Could not reject this item.',
      }));
    } finally {
      setApprovingId(null);
    }
  };

  const update = (
    source: ExactMeetingNotesReviewItem<Client>,
    change: Partial<ExactMeetingNotesReviewItem<Client>>
  ) => {
    const current = edits[source.id] ?? source;
    setEdits((all) => ({
      ...all,
      [source.id]: {
        ...current,
        ...change,
      } as ExactMeetingNotesReviewItem<Client>,
    }));
  };

  const updateCrmField = (
    source: ExactMeetingCrmReviewItem<Client>,
    index: number,
    raw: string
  ) => {
    const current = (edits[source.id] ?? source) as ExactMeetingCrmReviewItem<Client>;
    const fields = current.fields.map((field, fieldIndex) =>
      fieldIndex === index
        ? { ...field, proposed: editedCrmValue(field, raw) }
        : field
    );
    update(source, { fields } as Partial<ExactMeetingNotesReviewItem<Client>>);
  };

  return (
    <section
      data-testid={`notes-review-${reviewKind}-panel`}
      aria-label={`Review proposed ${label.toLowerCase()}`}
      style={{ display: 'grid', gap: 'var(--kp-space-sm)' }}
    >
      <div>
        <strong>{label}</strong>
        <div
          style={{
            color: 'var(--color-muted-foreground)',
            fontSize: 'var(--kp-font-xs)',
          }}
        >
          {t('meetings.review.approve-description')}
        </div>
      </div>
      {state.items.map((source) => {
        const item = edits[source.id] ?? source;
        const receipt = receipts[source.id];
        const approved =
          source.approvalState === 'approved' ||
          Boolean(receipt) ||
          approvedAfterErrors[source.id] === true;
        const error = errors[source.id];
        const rejected = source.approvalState === 'rejected';
        const canRetryDelivery =
          approved &&
          (source.delivery?.status === 'failed' ||
            source.delivery?.status === 'retryable' ||
            approvedAfterErrors[source.id] === true);
        return (
          <article
            key={source.id}
            data-testid={`notes-review-item-${source.id}`}
            style={{
              border: '1px solid var(--kp-divider)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--kp-space-sm)',
              background: 'var(--color-card)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <strong>{item.title}</strong>
              <Badge variant={approved ? 'success' : 'neutral'} size="sm">
                {rejected ? 'Rejected' : approved ? 'Approved' : 'Proposed'}
              </Badge>
            </div>

            {!approved && !rejected && item.kind === 'task' && (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <label>
                  Task
                  <input
                    data-testid={`notes-review-task-title-${item.id}`}
                    value={item.title}
                    onChange={(event) => {
                      update(source, { title: event.target.value });
                    }}
                    style={inputStyle()}
                  />
                </label>
                <label>
                  Details
                  <textarea
                    data-testid={`notes-review-task-detail-${item.id}`}
                    value={item.detail}
                    onChange={(event) => {
                      update(source, { detail: event.target.value });
                    }}
                    style={{ ...inputStyle(), minHeight: 64 }}
                  />
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}
                >
                  <label>
                    Owner
                    <input
                      data-testid={`notes-review-task-owner-${item.id}`}
                      value={item.ownerRef ?? ''}
                      onChange={(event) => {
                        update(source, {
                          ownerRef: event.target.value.trim() || null,
                        });
                      }}
                      style={inputStyle()}
                    />
                  </label>
                  <label>
                    Due date
                    <input
                      data-testid={`notes-review-task-due-${item.id}`}
                      type="date"
                      value={item.dueDate ?? ''}
                      onChange={(event) => {
                        update(source, {
                          dueDate: event.target.value || null,
                        });
                      }}
                      style={inputStyle()}
                    />
                  </label>
                </div>
              </div>
            )}

            {!approved && !rejected && item.kind === 'crm-update' && (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {item.fields.map((field, index) => (
                  <div
                    key={field.field}
                    data-testid={`notes-review-crm-field-${item.id}-${field.field}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                    }}
                  >
                    <label>
                      {field.label} before
                      <input
                        value={valueForInput(field.before)}
                        readOnly
                        aria-readonly="true"
                        data-testid={`notes-review-crm-before-${item.id}-${field.field}`}
                        style={inputStyle()}
                      />
                    </label>
                    <label>
                      Proposed
                      {field.valueType === 'boolean' ? (
                        <select
                          data-testid={`notes-review-crm-proposed-${item.id}-${field.field}`}
                          value={valueForInput(field.proposed)}
                          onChange={(event) => {
                            updateCrmField(item, index, event.target.value);
                          }}
                          style={inputStyle()}
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : (
                        <input
                          data-testid={`notes-review-crm-proposed-${item.id}-${field.field}`}
                          type={field.valueType === 'date' ? 'date' : field.valueType}
                          value={valueForInput(field.proposed)}
                          onChange={(event) => {
                            updateCrmField(item, index, event.target.value);
                          }}
                          style={inputStyle()}
                        />
                      )}
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                marginTop: 8,
                color: 'var(--color-muted-foreground)',
                fontSize: 'var(--kp-font-xs)',
              }}
            >
              Transcript: {item.transcriptRef}
            </div>
            {!approved && !rejected && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button
                  data-testid={`notes-review-approve-${item.id}`}
                  size="sm"
                variant="primary"
                loading={approvingId === item.id}
                  onClick={() => {
                    void approve(source);
                  }}
                >
                  Approve {item.kind === 'task' ? 'task' : 'CRM update'}
                </Button>
                {onReject && (
                  <Button
                    data-testid={`notes-review-reject-${item.id}`}
                    size="sm"
                    variant="secondary"
                    disabled={approvingId === item.id}
                    onClick={() => {
                      void reject(source);
                    }}
                  >
                    Reject
                  </Button>
                )}
              </div>
            )}
            {approved && !canRetryDelivery && (
              <div
                data-testid={`notes-review-approved-${item.id}`}
                role="status"
              >
                <CheckCircle2 size={14} aria-hidden="true" />{' '}
                {receipt?.message ?? 'Approved earlier.'}
              </div>
            )}
            {canRetryDelivery && (
              <Button
                data-testid={`notes-review-retry-delivery-${item.id}`}
                size="sm"
                variant="primary"
                loading={approvingId === item.id}
                onClick={() => {
                  void approve(source);
                }}
              >
                Retry delivery
              </Button>
            )}
            {rejected && (
              <div
                data-testid={`notes-review-rejected-${item.id}`}
                role="status"
              >
                {/* eslint-disable lantern-i18n/no-hardcoded-string -- exact trust copy is intentionally fixed until the milestone's copy pass */}
                Rejected. Nothing was sent.
                {/* eslint-enable lantern-i18n/no-hardcoded-string */}
              </div>
            )}
            {error && (
              <div data-testid={`notes-review-error-${item.id}`} role="alert">
                <CircleAlert size={14} aria-hidden="true" /> {error}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
