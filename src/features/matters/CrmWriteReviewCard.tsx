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
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronUp, Check, AlertTriangle, CalendarDays, Pencil } from 'lucide-react';
import { Card, Button } from '@/ui/kp';
import { useCrmWriteQueueStore, type ProposedCrmWrite } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { buildInverseCrmMap, matterLabel } from '@/platform/rag/matterResolver';
import { crmIsConnected } from '@/platform/utils/wealthbox-commands';
import { composeComplianceNote } from '@/features/matters/complianceNote';
import { composeCrmProvenance } from '@/features/matters/crmProvenance';
import { useLicense } from '@/platform/hooks/useLicense';
import { useProfileStore } from '@/platform/profile/profileStore';
import { getRememberedComplianceNoteChoice, setRememberedComplianceNoteChoice } from '@/features/matters/complianceNotePref';
import { brandText } from '@/config/brandText';

export interface CrmWriteReviewCardProps {
  matterId: string;
}

const RETRYABLE_STATUSES: ProposedCrmWrite['status'][] = ['proposed', 'failed', 'verify_pending', 'stale'];

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
  const fields = items.filter((i) => i.kind === 'field').length;
  const parts: string[] = [];
  if (notes > 0) parts.push(pluralize(notes, 'note'));
  if (tasks > 0) parts.push(pluralize(tasks, 'task'));
  if (fields > 0) parts.push(pluralize(fields, 'field update'));
  return parts.join(' · ');
}

export function CrmWriteReviewCard({ matterId }: CrmWriteReviewCardProps) {
  const allItems = useCrmWriteQueueStore((s) => s.items);
  const items = useMemo(() => allItems.filter((i) => i.matterId === matterId), [allItems, matterId]);
  const approve = useCrmWriteQueueStore((s) => s.approve);
  const dismiss = useCrmWriteQueueStore((s) => s.dismiss);
  const enqueue = useCrmWriteQueueStore((s) => s.enqueue);
  const updateFinalValue = useCrmWriteQueueStore((s) => s.updateFinalValue);
  const setProvenanceIfUnset = useCrmWriteQueueStore((s) => s.setProvenanceIfUnset);
  const matters = useMatterStore((s) => s.matters);
  const { t, i18n } = useTranslation();
  // R5 (Tier B trust guard): in a firm the compliance note is supervisory and
  // shouldn't be opt-in, so it defaults ON for the firm (practice) tier; solo
  // advisors keep — and we remember — their own choice.
  const isFirmTier = useLicense().tier === 'practice';
  const defaultComplianceNote = isFirmTier || getRememberedComplianceNoteChoice();

  const [expanded, setExpanded] = useState(false);
  const [uncheckedIds, setUncheckedIds] = useState<Set<string>>(new Set());
  const [household, setHousehold] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [fileComplianceNote, setFileComplianceNote] = useState(defaultComplianceNote);

  // Codex review catch (P1): if this component instance is reused for a
  // DIFFERENT client (e.g. no `key={matterId}` upstream), the previously
  // selected household would otherwise survive the switch — Approve could
  // then send the new client's write to the OLD client's Wealthbox
  // household. React's "adjust state during render" pattern resets the
  // per-client selection the moment matterId changes, before anything can
  // render or be approved with the stale value.
  const [prevMatterId, setPrevMatterId] = useState(matterId);
  if (matterId !== prevMatterId) {
    setPrevMatterId(matterId);
    setHousehold(null);
    setUncheckedIds(new Set());
    setExpanded(false);
    setFileComplianceNote(defaultComplianceNote);
  }

  // Coordinator review catch (P2): a stale item's finalValue gets rebuilt by
  // the store (see crmWriteQueueStore.ts), but a stale item that was already
  // checked stayed checked and re-selectable with one Approve click — the
  // rebuilt blend still hadn't been REVIEWED by the advisor, so approving it
  // sight-unseen is exactly the "one click overwrites the concurrent edit"
  // failure this exists to prevent. Every newly-stale item is deselected the
  // moment it's detected (compared during render, same pattern as the
  // matterId reset above) — the advisor must look at the rebuilt Blended
  // text and consciously re-check the box before it can send again.
  const staleKey = items
    .filter((i) => i.status === 'stale')
    .map((i) => i.id)
    .sort()
    .join(',');
  const [prevStaleKey, setPrevStaleKey] = useState('');
  if (staleKey !== prevStaleKey) {
    const prevStaleIds = new Set(prevStaleKey.split(',').filter(Boolean));
    const newlyStaleIds = staleKey.split(',').filter((id) => id !== '' && !prevStaleIds.has(id));
    if (newlyStaleIds.length > 0) {
      setUncheckedIds((prev) => {
        const next = new Set(prev);
        newlyStaleIds.forEach((id) => { next.add(id); });
        return next;
      });
    }
    setPrevStaleKey(staleKey);
  }

  const householdKeys = useMemo(
    () => (buildInverseCrmMap(matters).get(matterId) ?? []).filter(isWealthboxHouseholdKey),
    [matters, matterId],
  );
  // Defense-in-depth alongside the matterId reset above: a selected household
  // that is no longer in this matter's key list (e.g. unlinked while the card
  // was open) is never treated as valid, even if `household` state lags.
  const effectiveHousehold =
    householdKeys.length === 1
      ? (householdKeys[0] ?? null)
      : household !== null && householdKeys.includes(household)
        ? household
        : null;

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
    // Codex review catch (P2): the queue now persists across restarts, so an
    // item stuck here while disconnected must not become permanently
    // undismissable — offer Dismiss per row even though Approve isn't
    // reachable until Wealthbox is connected.
    const dismissable = items.filter((i) => i.status !== 'sent');
    return (
      <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', padding: '8px 0' }}>
        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
        Connect Wealthbox to send updates from this client.
        {dismissable.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dismissable.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--kp-navy)' }}>{item.title}</span>
                <button
                  type="button"
                  onClick={() => { dismiss(item.id); }}
                  style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}
        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
      </div>
    );
  }
  if (connected !== true) return null;

  const selectable = items.filter((i) => RETRYABLE_STATUSES.includes(i.status));
  const selectedItems = selectable.filter((i) => !uncheckedIds.has(i.id));
  const selectedIds = selectedItems.map((i) => i.id);
  const sentCount = items.filter((i) => i.status === 'sent').length;
  const hasBlankFieldBlend = selectedItems.some((i) => i.kind === 'field' && (i.finalValue ?? '').trim() === '');
  const approveDisabled = selectedIds.length === 0 || effectiveHousehold === null || hasBlankFieldBlend;

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
    const household_ = effectiveHousehold;
    // These ids are also the encrypted Rust proposal ids. The queue store sends
    // only those ids to the backend approval command; note/task/field content is
    // loaded and verified on the Rust side before Wealthbox sees anything.
    const approvedIds = selectedIds;
    const shouldFileCompliance = fileComplianceNote;
    // E3: stamp AI-drafted notes with an honest provenance line at the moment
    // of approval (so the "approved on" date is real), set-once so a retry
    // keeps the exact same line. It travels into the CRM note content.
    const approvedAtIso = new Date().toISOString();
    const profile = useProfileStore.getState();
    const advisor = isFirmTier ? (profile.firmName || profile.soloName) : profile.soloName;
    for (const id of approvedIds) {
      const it = items.find((i) => i.id === id);
      if (it?.kind === 'note' && it.aiSource) {
        setProvenanceIfUnset(
          id,
          composeCrmProvenance(
            t,
            { advisor, sourceKind: it.aiSource.kind, sourceDate: it.aiSource.date, approvedIso: approvedAtIso },
            i18n.language,
          ),
        );
      }
    }
    // R5 (coordinator review): re-derive the toggle from the firm-tier /
    // remembered-choice default after an approval rather than hard-resetting
    // to false — otherwise a SECOND update in the same mounted card would
    // default OFF and silently skip the supervisory note, even though the firm
    // tier is meant to default ON (and solo remembers the advisor's choice).
    // Recursion (a compliance note about a compliance note) is prevented
    // structurally below by excluding compliance items from the summary, not
    // by forcing the toggle off.
    setFileComplianceNote(defaultComplianceNote);
    void approve(approvedIds, household_).then(() => {
      if (!shouldFileCompliance) return;
      // Read fresh state after approve() settles — the sent items just
      // landed in the store, and this must never fire for rows that failed
      // or are still pending. The compliance note is only ever ENQUEUED
      // here, exactly like every other item — it goes through the same
      // Approve button on this card's next render, never a direct send.
      // Exclude prior compliance notes (sourceRef `compliance:…`): a compliance
      // note must never be summarized into another one — that's the recursion
      // guard, independent of the toggle state.
      const sentJustNow = useCrmWriteQueueStore
        .getState()
        .items.filter(
          (i) =>
            i.matterId === matterId &&
            approvedIds.includes(i.id) &&
            i.status === 'sent' &&
            !i.sourceRef.startsWith('compliance:'),
        );
      if (sentJustNow.length === 0) return;
      const matter = matters.find((m) => m.id === matterId);
      const clientLabel = matter ? matterLabel(matter) : matterId;
      const { title, body } = composeComplianceNote(sentJustNow, {
        clientLabel,
        whenIso: new Date().toISOString(),
      });
      enqueue({ kind: 'note', matterId, title, body, sourceRef: `compliance:${new Date().toISOString()}` });
    });
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
              {summaryLabel(items)} ready for review
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
                  data-testid={`crm-write-review-household-${key}`}
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
                  onFinalValueChange={(value) => { updateFinalValue(item.id, value); }}
                />
              ))}
            </div>
          )}

          {sentCount > 0 && (
            <div
              data-testid="crm-write-approval-receipt"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                margin: '0 var(--kp-card-pad) var(--kp-space-xs)',
                padding: '9px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--kp-success-line)',
                background: 'var(--kp-success-bg)',
                color: 'var(--kp-success-text)',
                fontSize: 'var(--kp-font-2xs)',
                fontWeight: 650,
                lineHeight: 1.45,
              }}
            >
              <Check size={13} strokeWidth={3} style={{ flex: 'none', marginTop: 1 }} />
              <span>
                {brandText(`Approved ${pluralize(sentCount, 'change')} to Wealthbox; sent direct to Wealthbox; nothing to Lantern.`)}
              </span>
            </div>
          )}

          {householdKeys.length > 0 && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 var(--kp-card-pad) var(--kp-space-xs)',
                fontSize: 'var(--kp-font-2xs)',
                color: 'var(--color-muted-foreground)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                data-testid="file-compliance-note"
                checked={fileComplianceNote}
                onChange={(e) => {
                  setFileComplianceNote(e.target.checked);
                  // Solo advisors' choice is remembered; the firm tier stays
                  // defaulted ON and doesn't overwrite the shared preference.
                  if (!isFirmTier) setRememberedComplianceNoteChoice(e.target.checked);
                }}
                style={{ width: 14, height: 14, cursor: 'pointer' }}
              />
              Also file a compliance note
            </label>
          )}

          {householdKeys.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 var(--kp-card-pad) var(--kp-card-pad)' }}>
              <Button variant="primary" size="md" disabled={approveDisabled} onClick={handleApprove}>
                Approve {pluralize(selectedIds.length, 'change')}
              </Button>
              <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                {t('matter.crm-write.approve-to-send')}
              </span>
            </div>
          )}
        </div>
      )}
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </Card>
  );
}

const KIND_LABEL: Record<ProposedCrmWrite['kind'], string> = {
  note: 'Note',
  task: 'Task',
  field: 'Field update',
};

function CrmWriteRow({
  item,
  checked,
  onToggle,
  onRetry,
  onDismiss,
  onFinalValueChange,
}: {
  item: ProposedCrmWrite;
  checked: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onFinalValueChange: (value: string) => void;
}) {
  const isSent = item.status === 'sent';
  const isSending = item.status === 'sending';
  const isFailed = item.status === 'failed';
  const isVerifyPending = item.status === 'verify_pending';
  const isStale = item.status === 'stale';
  const isField = item.kind === 'field';
  const needsAttention = isFailed || isVerifyPending || isStale;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 8,
        borderRadius: 'var(--radius-md)',
        // Field rows stay neutral at the row level — the tracked-changes
        // green lives on the Blended column alone, since Existing/From this
        // meeting are reference, not the proposed change (see fieldBlend.ts).
        background: isSent ? '#fff' : needsAttention ? 'var(--kp-warning-bg)' : isField ? '#fff' : 'var(--kp-success-bg)',
        border: `1px solid ${isSent ? 'var(--color-border)' : needsAttention ? 'var(--kp-warning-line)' : isField ? 'var(--color-border)' : 'var(--kp-success-line)'}`,
      }}
    >
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
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
          {KIND_LABEL[item.kind]}
        </div>
        <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: isField ? 'var(--kp-navy)' : '#0a4d38' }}>
          {item.title}
        </div>

        {isField ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <FieldColumn label="Existing" testId={`crm-field-existing-${item.id}`} value={item.existingValue ?? ''} />
            <FieldColumn label="From this meeting" testId={`crm-field-new-${item.id}`} value={item.newValue ?? ''} />
            <div>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-success-text)', marginBottom: 4,
                }}
              >
                <Pencil size={11} strokeWidth={2} />
                Blended — edit before approving
              </div>
              <textarea
                data-testid={`crm-field-blended-${item.id}`}
                value={item.finalValue ?? ''}
                onChange={(e) => { onFinalValueChange(e.target.value); }}
                disabled={isSending || isSent}
                rows={3}
                style={{
                  width: '100%',
                  resize: 'vertical',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--kp-font-xs)',
                  lineHeight: 1.5,
                  color: 'var(--kp-success-text)',
                  background: 'var(--kp-success-bg)',
                  border: '1px solid var(--kp-success-line)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '7px 9px',
                  outlineColor: 'var(--kp-success)',
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--kp-success-text)', marginTop: 3 }}>
            {item.body}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          {item.kind === 'task' && item.dueDate != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-success-text)' }}>
              <CalendarDays size={12} strokeWidth={1.75} />
              Due {item.dueDate}
            </span>
          )}
          <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
            from: {item.sourceRef}
          </span>
          {isSent && <span style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-success)' }}>In Wealthbox</span>}
        </div>

        {needsAttention && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, padding: '7px 10px',
              border: '1px solid var(--kp-warning-line)', borderRadius: 'var(--radius-md)',
              background: '#fff', color: '#7a4a1a', fontSize: 'var(--kp-font-2xs)', fontWeight: 500,
            }}
          >
            <AlertTriangle size={14} strokeWidth={1.9} color="var(--kp-warning)" />
            {isFailed
              ? "Couldn't reach Wealthbox"
              : isStale
                ? 'This field changed in Wealthbox since the proposal. Review again.'
                : 'Delivery unconfirmed. Will verify on next try.'}
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
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </div>
  );
}

function FieldColumn({ label, testId, value }: { label: string; testId: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--color-muted-foreground)', marginBottom: 4 }}>
        {label}
      </div>
      <div
        data-testid={testId}
        style={{
          fontSize: 'var(--kp-font-xs)',
          lineHeight: 1.5,
          color: 'var(--kp-navy)',
          background: 'var(--kp-bg-soft, #f8f9fb)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '7px 9px',
          // Coordinator review catch (P3): a plain <div> collapses newlines,
          // so a multi-paragraph narrative value (e.g. background_information)
          // rendered as one run-on line — the advisor wasn't seeing the true
          // text they were approving against.
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </div>
    </div>
  );
}
