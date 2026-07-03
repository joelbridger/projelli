// src/features/matters/CrmWriteReviewCard.tsx
/**
 * CrmWriteReviewCard — the Wealthbox write-back approval card.
 *
 * AI proposes, the advisor decides: every note/task drafted from a client's
 * documents or meetings sits here, checked by default, until one Approve
 * press sends the checked rows to Wealthbox. Nothing sends on its own — not
 * on enqueue, not on mount, not on a timer. Renders nothing when the client
 * has no queued items.
 *
 * Visual language: the same tracked-changes green used for AI-proposed Client
 * Map updates and Word redlines elsewhere in the product (see the design
 * constitution in docs/plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md
 * section 2), scaled down to a card instead of a document.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronUp, Check, AlertTriangle, CalendarDays } from 'lucide-react';
import { Card, Button } from '@/ui/kp';
import { useCrmWriteQueueStore, type ProposedCrmWrite } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { buildInverseCrmMap } from '@/platform/rag/matterResolver';
import { crmIsConnected } from '@/platform/utils/wealthbox-commands';

export interface CrmWriteReviewCardProps {
  matterId: string;
}

const RETRYABLE_STATUSES: ProposedCrmWrite['status'][] = ['proposed', 'failed', 'verify_pending'];

/** How often to re-check the Wealthbox connection while disconnected and a
 *  write is queued, so connecting elsewhere unsticks this card without a
 *  reload. */
const CONNECTION_RECHECK_MS = 5000;

function pluralize(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** Mirrors the Rust `crm_key_belongs_to_provider("wealthbox", ...)` rule and
 *  the TS `filterCrmMatterMapForProvider` sibling: Wealthbox keys are bare
 *  ids, other providers prefix theirs (`sfdc:...`, `redtail:...`). This card
 *  only ever writes to Wealthbox, so a client mixed into another CRM's
 *  household map must not offer that other provider's id as a target. */
function isWealthboxHouseholdKey(key: string): boolean {
  return !key.startsWith('sfdc:') && !key.startsWith('redtail:');
}

function summaryLabel(items: ProposedCrmWrite[]): string {
  const notes = items.filter((i) => i.kind === 'note').length;
  const tasks = items.filter((i) => i.kind === 'task').length;
  const parts: string[] = [];
  if (notes > 0) parts.push(pluralize(notes, 'note'));
  if (tasks > 0) parts.push(pluralize(tasks, 'task'));
  return parts.join(' · ');
}

export function CrmWriteReviewCard({ matterId }: CrmWriteReviewCardProps) {
  const allItems = useCrmWriteQueueStore((s) => s.items);
  const items = useMemo(() => allItems.filter((i) => i.matterId === matterId), [allItems, matterId]);
  const approve = useCrmWriteQueueStore((s) => s.approve);
  const dismiss = useCrmWriteQueueStore((s) => s.dismiss);
  const matters = useMatterStore((s) => s.matters);

  const [expanded, setExpanded] = useState(false);
  const [uncheckedIds, setUncheckedIds] = useState<Set<string>>(new Set());
  const [household, setHousehold] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  const householdKeys = useMemo(
    () => (buildInverseCrmMap(matters).get(matterId) ?? []).filter(isWealthboxHouseholdKey),
    [matters, matterId],
  );
  const effectiveHousehold = householdKeys.length === 1 ? (householdKeys[0] ?? null) : household;

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;

    function check() {
      void crmIsConnected('wealthbox').then((isConnected) => {
        if (cancelled) return;
        setConnected(isConnected);
        // Codex review catch: a card that queued a write before Wealthbox
        // was connected must not stay stuck on the "Connect" hint forever —
        // keep polling until connected, the queue empties, or we unmount.
        if (!isConnected) {
          recheckTimer = setTimeout(check, CONNECTION_RECHECK_MS);
        }
      });
    }
    check();

    return () => {
      cancelled = true;
      if (recheckTimer) clearTimeout(recheckTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length > 0, matterId]);

  if (items.length === 0) return null;

  if (connected === false) {
    return (
      <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', padding: '8px 0' }}>
        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
        Connect Wealthbox to send updates from this client.
        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
      </div>
    );
  }
  if (connected !== true) return null;

  const selectable = items.filter((i) => RETRYABLE_STATUSES.includes(i.status));
  const selectedIds = selectable.filter((i) => !uncheckedIds.has(i.id)).map((i) => i.id);
  const approveDisabled = selectedIds.length === 0 || effectiveHousehold === null;

  function toggle(id: string) {
    setUncheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApprove() {
    if (effectiveHousehold === null || selectedIds.length === 0) return;
    void approve(selectedIds, effectiveHousehold);
  }

  function handleRetry(id: string) {
    if (effectiveHousehold === null) return;
    void approve([id], effectiveHousehold);
  }

  return (
    <Card
      variant="raised"
      style={{ marginTop: 'var(--kp-space-xs)', padding: expanded ? undefined : 0, overflow: 'hidden' }}
    >
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
      {!expanded && (
        <button
          type="button"
          data-testid="crm-write-card-collapsed"
          onClick={() => { setExpanded(true); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            padding: 'var(--kp-space-xs) var(--kp-card-pad)',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
              Update Wealthbox
            </span>
            <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
              {summaryLabel(items)} drafted from this note
            </span>
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--kp-font-2xs)',
              fontWeight: 'var(--kp-weight-bold)',
              color: 'var(--kp-accent, var(--kp-navy))',
              flexShrink: 0,
            }}
          >
            Review
            <ChevronRight size={14} strokeWidth={2} />
          </span>
        </button>
      )}

      {expanded && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 'var(--kp-space-xs) var(--kp-card-pad)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)' }}>
                Update Wealthbox
              </span>
              <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                Nothing sends until you approve
              </span>
            </div>
            <button
              type="button"
              aria-label="Collapse"
              onClick={() => { setExpanded(false); }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted-foreground)', padding: 4 }}
            >
              <ChevronUp size={16} strokeWidth={1.75} />
            </button>
          </div>

          {householdKeys.length === 0 && (
            <div style={{ padding: 'var(--kp-card-pad)', fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
              Link this client to a Wealthbox household first.
            </div>
          )}

          {householdKeys.length > 1 && (
            <div style={{ padding: 'var(--kp-space-xs) var(--kp-card-pad)', background: 'var(--kp-bg-soft, #f8f9fb)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)', marginBottom: 8 }}>
                This client links to two Wealthbox households. Pick where these changes should go.
              </div>
              {householdKeys.map((key) => (
                <label
                  key={key}
                  data-testid={`crm-household-${key}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    marginBottom: 6,
                    border: `1px solid ${household === key ? 'var(--kp-action-border, var(--kp-navy))' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-md)',
                    background: household === key ? 'var(--kp-action-bg, #eef1ff)' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name={`crm-household-${matterId}`}
                    checked={household === key}
                    onChange={() => { setHousehold(key); }}
                    style={{ accentColor: 'var(--kp-navy)', width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--kp-navy)' }}>{key}</span>
                </label>
              ))}
            </div>
          )}

          {householdKeys.length > 0 && (
            <div style={{ padding: '10px var(--kp-card-pad) 2px' }}>
              {items.map((item) => (
                <CrmWriteRow
                  key={item.id}
                  item={item}
                  checked={!uncheckedIds.has(item.id)}
                  onToggle={() => { toggle(item.id); }}
                  onRetry={() => { handleRetry(item.id); }}
                  onDismiss={() => { dismiss(item.id); }}
                />
              ))}
            </div>
          )}

          {householdKeys.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 'var(--kp-space-xs) var(--kp-card-pad) var(--kp-card-pad)' }}>
              <Button variant="primary" size="md" disabled={approveDisabled} onClick={handleApprove}>
                Approve {pluralize(selectedIds.length, 'change')}
              </Button>
              <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                Nothing is written to Wealthbox until you approve.
              </span>
            </div>
          )}
        </div>
      )}
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </Card>
  );
}

function CrmWriteRow({
  item,
  checked,
  onToggle,
  onRetry,
  onDismiss,
}: {
  item: ProposedCrmWrite;
  checked: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const isSent = item.status === 'sent';
  const isSending = item.status === 'sending';
  const isFailed = item.status === 'failed';
  const isVerifyPending = item.status === 'verify_pending';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 8,
        borderRadius: 'var(--radius-md)',
        background: isSent ? '#fff' : (isFailed || isVerifyPending) ? 'var(--kp-warning-bg)' : 'var(--kp-success-bg)',
        border: `1px solid ${isSent ? 'var(--color-border)' : (isFailed || isVerifyPending) ? 'var(--kp-warning-line)' : 'var(--kp-success-line)'}`,
      }}
    >
      {isSent ? (
        <span
          style={{
            width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--kp-success)', color: '#fff',
          }}
        >
          <Check size={11} strokeWidth={3} />
        </span>
      ) : (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={isSending}
          style={{
            marginTop: 3,
            flexShrink: 0,
            width: 16,
            height: 16,
            accentColor: 'var(--kp-success)',
            cursor: isSending ? 'default' : 'pointer',
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {item.kind === 'note' ? 'Note' : 'Task'}
        </div>
        <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: '#0a4d38' }}>
          {item.title}
        </div>
        <div style={{ fontSize: 'var(--kp-font-xs)', color: '#0a5c43', marginTop: 3 }}>
          {item.body}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          {item.kind === 'task' && item.dueDate != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', color: '#0a5c43' }}>
              <CalendarDays size={12} strokeWidth={1.75} />
              Due {item.dueDate}
            </span>
          )}
          <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
            from: {item.sourceRef}
          </span>
          {isSent && <span style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-success)' }}>In Wealthbox</span>}
        </div>

        {(isFailed || isVerifyPending) && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, padding: '7px 10px',
              border: '1px solid var(--kp-warning-line)', borderRadius: 'var(--radius-md)',
              background: '#fff', color: '#7a4a1a', fontSize: 'var(--kp-font-2xs)', fontWeight: 500,
            }}
          >
            <AlertTriangle size={14} strokeWidth={1.9} color="var(--kp-warning)" />
            {isFailed ? "Couldn't reach Wealthbox" : 'Delivery unconfirmed. Will verify on next try.'}
            <button
              type="button"
              onClick={onRetry}
              style={{
                marginLeft: 'auto', border: '1px solid var(--kp-warning-line)', background: '#fff', color: '#7a4a1a',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--kp-font-2xs)', fontWeight: 700, cursor: 'pointer',
                borderRadius: 'var(--radius-sm)', padding: '3px 10px',
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {!isSent && !isSending && (
        <button
          type="button"
          onClick={onDismiss}
          style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
