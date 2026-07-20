import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Pencil, Send, Trash2 } from 'lucide-react';

import { Button, Card } from '@/ui/kp';
import {
  useExternalWriteQueueStore,
  type ProposedExternalWrite,
} from '@/platform/state/externalWriteQueueStore';
import { RIGHTCAPITAL_INCOME_FIXTURE } from '@/features/planning/externalWriteFixtures';
import { BRAND } from '@/config/brand';

export interface ExternalWriteReviewCardProps {
  matterId: string;
}

const RETRYABLE = new Set(['proposed', 'failed', 'verify_pending', 'stale']);

function formatMoney(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Not set';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function targetLabel(item: ProposedExternalWrite): string {
  return item.data.target === 'rightcapital' ? 'RightCapital' : 'Holistiplan';
}

function approveLabel(items: ProposedExternalWrite[]): string {
  if (items.length > 0 && items.every((item) => item.data.target === 'holistiplan')) return 'Send to Holistiplan';
  if (items.length > 0 && items.every((item) => item.data.target === 'rightcapital')) return 'Update RightCapital';
  return 'Send approved updates';
}

function statusText(item: ProposedExternalWrite): string | null {
  if (item.status === 'sent') return `Sent. Receipt ${item.receiptRef ?? item.remoteId ?? 'saved'}.`;
  if (item.status === 'verify_pending') return `Delivery unconfirmed. ${BRAND.name} will check before retrying.`;
  if (item.status === 'stale') return `Current in ${targetLabel(item)} changed. Review again before sending.`;
  if (item.status === 'failed') return item.error ?? 'Could not send.';
  return null;
}

export function ExternalWriteReviewCard({ matterId }: ExternalWriteReviewCardProps) {
  const allItems = useExternalWriteQueueStore((state) => state.items);
  const approve = useExternalWriteQueueStore((state) => state.approve);
  const dismiss = useExternalWriteQueueStore((state) => state.dismiss);
  const updateRightCapitalIncomeFinal = useExternalWriteQueueStore((state) => state.updateRightCapitalIncomeFinal);
  const items = useMemo(
    () => allItems.filter((item) => item.data.matterId === matterId),
    [allItems, matterId],
  );
  const [uncheckedIds, setUncheckedIds] = useState<Set<string>>(new Set());

  if (items.length === 0) return null;

  const selectable = items.filter((item) => RETRYABLE.has(item.status));
  const selectedIds = selectable.filter((item) => !uncheckedIds.has(item.id)).map((item) => item.id);
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const approveDisabled = selectedIds.length === 0;

  function toggle(id: string) {
    setUncheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApprove() {
    if (selectedIds.length === 0) return;
    // eslint-disable-next-line lantern-async/no-silent-failure -- approve() writes per-item failures into the queue state.
    void approve(selectedIds).catch(() => undefined);
  }

  return (
    <Card
      variant="raised"
      style={{
        padding: 16,
        background: 'var(--kp-surface-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
      }}
    >
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 750, color: 'var(--kp-navy)' }}>
            {approveLabel(items)}
          </div>
          <div style={{ marginTop: 2, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
            Nothing is sent until you approve
          </div>
        </div>
        <Button variant="primary" size="sm" disabled={approveDisabled} onClick={handleApprove}>
          <Send size={14} />
          {approveLabel(selectedItems.length > 0 ? selectedItems : items)}
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {items.map((item) => (
          <ExternalWriteRow
            key={item.id}
            item={item}
            checked={!uncheckedIds.has(item.id)}
            onToggle={() => { toggle(item.id); }}
            onDismiss={() => { dismiss(item.id); }}
            onFinalAmountChange={(amount) => {
              updateRightCapitalIncomeFinal(item.id, { amount });
            }}
          />
        ))}
      </div>
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </Card>
  );
}

function ExternalWriteRow({
  item,
  checked,
  onToggle,
  onDismiss,
  onFinalAmountChange,
}: {
  item: ProposedExternalWrite;
  checked: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onFinalAmountChange: (amount: number) => void;
}) {
  if (item.proposalType === 'holistiplan_upload') {
    const message = statusText(item);
    const firstDoc = item.data.documents[0];
    return (
      <div style={rowStyle(item.status)}>
        { }
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={item.status === 'sending' || item.status === 'sent'}
          style={{ width: 16, height: 16, marginTop: 3, accentColor: 'var(--kp-success)' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={rowTitleStyle}>Send {firstDoc?.displayName ?? 'tax document'} to Holistiplan</div>
          <div style={gridStyle}>
            <InfoColumn label="Current in Holistiplan" value={item.data.holistiplanHouseholdId ?? 'Target match not confirmed'} />
            <InfoColumn label="From this meeting/intake" value={firstDoc?.source ?? 'client_folder'} />
            <InfoColumn
              label="Will send"
              value={`${firstDoc?.displayName ?? 'Document'}${firstDoc?.taxYear ? `, ${String(firstDoc.taxYear)}` : ''}`}
            />
          </div>
          {message && <StatusLine item={item} message={message} />}
        </div>
        {item.status !== 'sent' && (
          <DismissButton onDismiss={onDismiss} />
        )}
        { }
      </div>
    );
  }

  const data = item.data;
  const message = statusText(item);
  return (
    <div style={rowStyle(item.status)}>
      { }
      <input
        type="checkbox"
        aria-label={`Approve ${data.final.incomeType}`}
        checked={checked}
        onChange={onToggle}
        disabled={item.status === 'sending' || item.status === 'sent'}
        style={{ width: 16, height: 16, marginTop: 3, accentColor: 'var(--kp-success)' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={rowTitleStyle}>
          {data.final.incomeType} income for {data.final.owner ?? data.fromSource.owner ?? 'client'}
        </div>
        <div style={{ marginTop: 2, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
          {targetLabel(item)} household {data.rightCapitalHouseholdId}
        </div>
        <div style={gridStyle}>
          <InfoColumn
            label="Current in RightCapital"
            value={[
              data.existing.incomeType ?? 'Income',
              data.existing.owner ?? 'No owner',
              formatMoney(data.existing.amount),
              data.existing.frequency ?? 'No frequency',
            ].join('\n')}
          />
          <InfoColumn
            label="From this meeting/intake"
            value={[
              `${data.fromSource.incomeType} ${formatMoney(data.fromSource.amount)} ${data.fromSource.frequency}`,
              `Confidence: ${data.fromSource.confidence}`,
              `"${data.fromSource.quote}"`,
            ].join('\n')}
          />
          <div>
            <div style={columnLabelStyle}>
              <Pencil size={12} />
              Will send
            </div>
            <div style={sendBoxStyle}>
              <label style={fieldLabelStyle}>
                Amount
                <input
                  data-testid={`external-income-final-amount-${item.id}`}
                  type="number"
                  value={data.final.amount}
                  onChange={(event) => { onFinalAmountChange(Number(event.target.value)); }}
                  disabled={item.status === 'sending' || item.status === 'sent'}
                  style={inputStyle}
                />
              </label>
              <div>{data.final.incomeType} / {data.final.frequency}</div>
              {data.final.startDate && <div>Starts {data.final.startDate}</div>}
              {data.final.endDate && <div>Ends {data.final.endDate}</div>}
              {data.final.notes && <div>{data.final.notes}</div>}
            </div>
          </div>
        </div>
        {message && <StatusLine item={item} message={message} />}
      </div>
      {item.status !== 'sent' && (
        <DismissButton onDismiss={onDismiss} />
      )}
      { }
    </div>
  );
}

function InfoColumn({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={columnLabelStyle}>{label}</div>
      <div style={columnBoxStyle}>{value}</div>
    </div>
  );
}

function StatusLine({ item, message }: { item: ProposedExternalWrite; message: string }) {
  const ok = item.status === 'sent';
  return (
    <div
      data-testid={`external-write-status-${item.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        marginTop: 10,
        padding: '7px 9px',
        borderRadius: 6,
        border: `1px solid ${ok ? 'var(--kp-success-line)' : 'var(--kp-warning-line)'}`,
        background: ok ? 'var(--kp-success-bg)' : 'var(--kp-surface-card)',
        color: ok ? 'var(--kp-success-text)' : 'var(--kp-warning)',
        fontSize: 'var(--kp-font-2xs)',
        fontWeight: 650,
      }}
    >
      {ok ? <Check size={14} strokeWidth={2.5} /> : <AlertTriangle size={14} strokeWidth={2} />}
      {message}
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={onDismiss}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'var(--color-muted-foreground)',
        cursor: 'pointer',
        padding: 4,
        lineHeight: 0,
      }}
    >
      <Trash2 size={14} />
    </button>
  );
}

function rowStyle(status: ProposedExternalWrite['status']): React.CSSProperties {
  const needsAttention = status === 'failed' || status === 'verify_pending' || status === 'stale';
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    background: status === 'sent' ? 'var(--kp-success-bg)' : needsAttention ? 'var(--kp-warning-bg)' : 'var(--kp-surface-card)',
    border: `1px solid ${status === 'sent' ? 'var(--kp-success-line)' : needsAttention ? 'var(--kp-warning-line)' : 'var(--color-border)'}`,
  };
}

const rowTitleStyle: React.CSSProperties = {
  fontSize: 'var(--kp-font-sm)',
  fontWeight: 720,
  color: 'var(--kp-navy)',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
  marginTop: 10,
};

const columnLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  minHeight: 18,
  fontSize: 'var(--kp-font-2xs)',
  fontWeight: 700,
  color: 'var(--color-muted-foreground)',
};

const columnBoxStyle: React.CSSProperties = {
  minHeight: 92,
  whiteSpace: 'pre-wrap',
  fontSize: 'var(--kp-font-xs)',
  lineHeight: 1.45,
  color: 'var(--kp-navy)',
  background: 'var(--kp-bg-soft)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '8px 9px',
};

const sendBoxStyle: React.CSSProperties = {
  ...columnBoxStyle,
  border: '1px solid var(--kp-success-line)',
  background: 'var(--kp-success-bg)',
  color: 'var(--kp-success-text)',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 6,
  fontSize: 'var(--kp-font-2xs)',
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--kp-success-line)',
  borderRadius: 6,
  padding: '5px 7px',
  fontSize: 'var(--kp-font-xs)',
  color: 'var(--kp-navy)',
  background: 'var(--kp-surface-card)',
};

export function ExternalWriteReviewFixture() {
  const enqueue = useExternalWriteQueueStore((state) => state.enqueueRightCapitalIncome);
  const items = useExternalWriteQueueStore((state) => state.items);
  useEffect(() => {
    if (items.length === 0) enqueue(RIGHTCAPITAL_INCOME_FIXTURE);
  }, [enqueue, items.length]);
  return <ExternalWriteReviewCard matterId={RIGHTCAPITAL_INCOME_FIXTURE.matterId} />;
}
