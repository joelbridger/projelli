import { useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Badge, Button } from '@/ui/kp';
import { normalizeNotesReviewItems } from './normalizeNotesReviewItems';
import type { NotesReviewDestination, NotesReviewItem, NotesReviewPanelProps, NotesReviewReceipt } from './types';

const DESTINATION_LABELS: Record<NotesReviewDestination, string> = {
  task: 'Task',
  crm: 'CRM update',
  'client-note': 'Client note',
  internal: 'Internal note',
};

function approvalLabel(destination: NotesReviewDestination): string {
  return `Approve ${DESTINATION_LABELS[destination].toLowerCase()}`;
}

function missingReceipt(): NotesReviewReceipt {
  return {
    status: 'recorded',
    message: 'Approved, but the destination did not return a delivery receipt.',
  };
}

/**
 * A per-item, propose-then-approve surface. This component never performs an
 * outbound write itself: it emits an approved item to its caller and only
 * shows success when that caller returns a receipt for the same item.
 */
export function NotesReviewPanel({ rawItems = [], onApprove }: NotesReviewPanelProps) {
  const items = useMemo(() => normalizeNotesReviewItems(rawItems), [rawItems]);
  const [destinations, setDestinations] = useState<Record<string, NotesReviewDestination>>({});
  const [receipts, setReceipts] = useState<Record<string, NotesReviewReceipt>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const approve = async (item: NotesReviewItem) => {
    const destination = destinations[item.id] ?? item.destination;
    const approvedItem = { ...item, destination };
    setApprovingId(item.id);
    setErrors((current) => {
      const { [item.id]: _removed, ...rest } = current;
      return rest;
    });
    try {
      const receipt = onApprove ? await onApprove(approvedItem) : undefined;
      setReceipts((current) => ({ ...current, [item.id]: receipt ?? missingReceipt() }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not approve this item. Nothing was sent.';
      setErrors((current) => ({ ...current, [item.id]: message }));
    } finally {
      setApprovingId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <section data-testid="notes-review-panel" aria-label="Review proposed note items" style={{ padding: 'var(--kp-space-sm) var(--kp-gutter)', borderBottom: '1px solid var(--kp-divider)', background: 'var(--color-background)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--kp-space-sm)', marginBottom: 'var(--kp-space-sm)' }}>
        <div>
          <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)' }}>Review notes</div>
          {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string -- this standalone seam has no copy namespace until the parallel template contract lands. */}
          <div style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', marginTop: 2 }}>Nothing is added anywhere until you approve each item.</div>
        </div>
        <Badge variant="warning" size="sm">{String(items.length)} proposed</Badge>
      </div>

      <div style={{ display: 'grid', gap: 'var(--kp-space-sm)' }}>
        {items.map((item) => {
          const destination = destinations[item.id] ?? item.destination;
          const receipt = receipts[item.id];
          const error = errors[item.id];
          const isApproving = approvingId === item.id;
          const completed = receipt && receipt.status !== 'failed';
          return (
            <article key={item.id} data-testid={`notes-review-item-${item.id}`} style={{ border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-md)', padding: 'var(--kp-space-sm)', background: 'var(--color-card)' }}>
              <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 'var(--kp-space-sm)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)' }}>{item.title}</div>
                  <div data-testid={`notes-review-detail-${item.id}`} style={{ marginTop: 4, color: 'var(--color-foreground)', fontSize: 'var(--kp-font-sm)', lineHeight: 1.45 }}>{item.detail}</div>
                  {item.sourceLabel && <div style={{ marginTop: 6, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>From: {item.sourceLabel}</div>}
                </div>
                <Badge variant={completed ? 'success' : 'neutral'} size="sm">{completed ? 'Approved' : 'Proposed'}</Badge>
              </div>

              {!completed && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--kp-space-sm)', marginTop: 'var(--kp-space-sm)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                    Add as
                    <select
                      aria-label={`Destination for ${item.title}`}
                      data-testid={`notes-review-destination-${item.id}`}
                      value={destination}
                      onChange={(event) => { setDestinations((current) => ({ ...current, [item.id]: event.target.value as NotesReviewDestination })); }}
                      style={{ minHeight: 30, border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-sm)', background: 'var(--color-background)', color: 'var(--color-foreground)', fontFamily: 'inherit', fontSize: 'var(--kp-font-xs)', padding: '0 6px' }}
                    >
                      {(Object.keys(DESTINATION_LABELS) as NotesReviewDestination[]).map((value) => <option key={value} value={value}>{DESTINATION_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <Button
                    data-testid={`notes-review-approve-${item.id}`}
                    size="sm"
                    variant="primary"
                    loading={isApproving}
                    onClick={() => {
                      void approve(item).catch((error: unknown) => {
                        const message = error instanceof Error ? error.message : 'Could not approve this item. Nothing was sent.';
                        setErrors((current) => ({ ...current, [item.id]: message }));
                      });
                    }}
                  >
                    {approvalLabel(destination)}
                  </Button>
                </div>
              )}

              {receipt && (
                <div data-testid={`notes-review-receipt-${item.id}`} role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--kp-space-sm)', color: receipt.status === 'recorded' ? 'var(--color-muted-foreground)' : 'var(--kp-success-text)', fontSize: 'var(--kp-font-xs)' }}>
                  <CheckCircle2 size={14} aria-hidden="true" />
                  {receipt.message}
                </div>
              )}
              {error && (
                <div data-testid={`notes-review-error-${item.id}`} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--kp-space-sm)', color: 'var(--destructive)', fontSize: 'var(--kp-font-xs)' }}>
                  <CircleAlert size={14} aria-hidden="true" />
                  {error}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
