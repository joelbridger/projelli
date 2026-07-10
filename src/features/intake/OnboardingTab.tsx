import { useEffect, useMemo, useState } from 'react';
import { Copy, Eye, ExternalLink, RefreshCcw, RotateCw, Save, Trash2, XCircle } from 'lucide-react';

import { Button } from '@/ui/button';
import type { IntakeRecord } from '@/platform/intake/intakeStore';
import {
  intakeFactList,
  intakeFactPurge,
  intakeFactReveal,
  intakeFactUpsert,
  type MaskedClientFact,
} from '@/platform/intake/factsStore';
import { FACT_KIND_SENSITIVITY, type FactKind, type FactValue } from '@/platform/intake/types';

export interface OnboardingTabProps {
  matterId: string;
  intake: IntakeRecord | null;
  advisorId?: string;
  onExtend?: (intakeId: string) => Promise<void> | void;
  onRevoke?: (intakeId: string) => Promise<void> | void;
  onRegenerate?: (intakeId: string) => Promise<void> | void;
  onOpenFile?: (path: string) => void;
}

const MANUAL_FACT_KINDS: FactKind[] = ['ssn', 'dob', 'income_annual', 'spending_monthly', 'drivers_license'];

function manualFactLabel(kind: FactKind): string {
  switch (kind) {
    case 'dob':
      return 'Date of birth';
    case 'ssn':
      return 'Social Security number';
    case 'income_annual':
      return 'Annual income';
    case 'spending_monthly':
      return 'Monthly spending';
    case 'drivers_license':
      return "Driver's license";
    default:
      return kind;
  }
}

function manualValue(kind: FactKind, raw: string): FactValue {
  const value = raw.trim();
  if (kind === 'dob') return { t: 'date', v: value };
  return { t: 'string', v: value };
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(state: string): string {
  switch (state) {
    case 'received':
      return 'received';
    case 'accepted':
      return 'accepted';
    case 'needs_followup':
      return 'needs another look';
    case 'not_needed':
      return 'not needed';
    case 'provided':
      return 'provided';
    default:
      return 'not started';
  }
}

function provenanceColor(channel: string): { bg: string; color: string; border: string } {
  if (channel === 'manual') return { bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' };
  if (channel === 'intake_link') return { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
  return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
}

function ProvenanceChip({ label, channel }: { label: string; channel: string }) {
  const colors = provenanceColor(channel);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        padding: '0 8px',
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.color,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export function OnboardingTab({
  matterId,
  intake,
  advisorId = 'advisor',
  onExtend,
  onRevoke,
  onRegenerate,
  onOpenFile,
}: OnboardingTabProps) {
  const [facts, setFacts] = useState<MaskedClientFact[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [manualKind, setManualKind] = useState<FactKind>('ssn');
  const [manualSubject, setManualSubject] = useState('primary');
  const [manualRawValue, setManualRawValue] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<'extend' | 'revoke' | 'regenerate' | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void intakeFactList(matterId).then((next) => {
      if (!cancelled) setFacts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [matterId, intake?.receivedItems.length]);

  const completedCount = useMemo(
    () => intake?.items.filter((item) => item.state !== 'not_started').length ?? 0,
    [intake?.items],
  );

  if (!intake) {
    return (
      <div style={{ padding: '28px var(--kp-gutter)', color: 'var(--color-muted-foreground)' }}>
        No onboarding link has been created for this client yet.
      </div>
    );
  }

  const copyLink = async () => {
    await navigator.clipboard?.writeText(intake.link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const runLinkAction = async (
    action: 'extend' | 'revoke' | 'regenerate',
    fn: ((intakeId: string) => Promise<void> | void) | undefined,
  ) => {
    if (!fn) return;
    setActionError('');
    setPendingAction(action);
    try {
      await fn(intake.intakeId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Link update failed.');
    } finally {
      setPendingAction(null);
    }
  };

  const saveManualFact = async () => {
    const value = manualRawValue.trim();
    if (!value) return;
    setManualSaving(true);
    setActionError('');
    try {
      await intakeFactUpsert({
        matter_id: matterId,
        subject: manualSubject.trim() || 'primary',
        kind: manualKind,
        value: manualValue(manualKind, value),
        sensitivity: FACT_KIND_SENSITIVITY[manualKind],
        provenance: {
          channel: 'manual',
          entered_by: advisorId,
          at: new Date().toISOString(),
        },
        verification: 'advisor_confirmed',
      });
      setManualRawValue('');
      setRevealed({});
      setFacts(await intakeFactList(matterId));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save the fact.');
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <div
      data-testid="onboarding-tab"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        background: 'var(--color-background)',
        padding: '20px var(--kp-gutter) 28px',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.3fr) minmax(280px, 0.7fr)',
          gap: 18,
          alignItems: 'start',
        }}
      >
        <section style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--kp-navy)' }}>Onboarding</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-muted-foreground)' }}>
                {completedCount} of {intake.items.length} items have activity.
              </p>
            </div>
            <span
              style={{
                border: '1px solid var(--kp-divider)',
                borderRadius: 999,
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 800,
                color: intake.status === 'active' ? '#047857' : 'var(--color-muted-foreground)',
                background: intake.status === 'active' ? '#ecfdf5' : '#f8fafc',
              }}
            >
              {intake.status}
            </span>
          </div>

          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            {intake.items.map((item) => (
              <div
                key={item.itemId}
                style={{
                  border: '1px solid var(--kp-divider)',
                  borderRadius: 8,
                  background: '#fff',
                  padding: 14,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--kp-navy)', fontSize: 14 }}>{item.label}</strong>
                    {item.provenance ? (
                      <ProvenanceChip label={item.provenance.label} channel={item.provenance.channel} />
                    ) : null}
                  </div>
                  <div style={{ marginTop: 5, color: 'var(--color-muted-foreground)', fontSize: 12 }}>
                    {statusLabel(item.state)}
                    {item.provenance?.at ? ` · ${formatDate(item.provenance.at)}` : ''}
                  </div>
                </div>
                {item.filePath ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onOpenFile?.(item.filePath ?? '')}>
                    <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                    View
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <aside style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          <section style={{ border: '1px solid var(--kp-divider)', borderRadius: 8, background: '#fff', padding: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--kp-navy)' }}>Link controls</h3>
            <p style={{ margin: '5px 0 12px', color: 'var(--color-muted-foreground)', fontSize: 12 }}>
              This link works until {formatDate(intake.expiresAt)}. You can extend or turn it off anytime.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                <Copy className="mr-2 h-4 w-4" aria-hidden />
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingAction != null}
                onClick={() => { void runLinkAction('extend', onExtend); }}
              >
                <RotateCw className="mr-2 h-4 w-4" aria-hidden />
                {pendingAction === 'extend' ? 'Extending' : 'Extend'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingAction != null}
                onClick={() => { void runLinkAction('regenerate', onRegenerate); }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" aria-hidden />
                {pendingAction === 'regenerate' ? 'Making link' : 'Regenerate'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingAction != null}
                onClick={() => { void runLinkAction('revoke', onRevoke); }}
              >
                <XCircle className="mr-2 h-4 w-4" aria-hidden />
                {pendingAction === 'revoke' ? 'Turning off' : 'Turn off'}
              </Button>
            </div>
            {actionError ? (
              <p style={{ margin: '10px 0 0', color: '#b91c1c', fontSize: 12 }}>{actionError}</p>
            ) : null}
          </section>

          <section style={{ border: '1px solid var(--kp-divider)', borderRadius: 8, background: '#fff', padding: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--kp-navy)' }}>Received facts</h3>
            <div
              style={{
                marginTop: 10,
                border: '1px solid #fed7aa',
                borderRadius: 8,
                background: '#fff7ed',
                padding: 10,
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: '#9a3412' }}>
                  Fact
                  <select
                    value={manualKind}
                    onChange={(event) => setManualKind(event.target.value as FactKind)}
                    style={{ height: 32, border: '1px solid #fed7aa', borderRadius: 6, padding: '0 8px', background: '#fff' }}
                  >
                    {MANUAL_FACT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>{manualFactLabel(kind)}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: '#9a3412' }}>
                  Person
                  <input
                    value={manualSubject}
                    onChange={(event) => setManualSubject(event.target.value)}
                    style={{ height: 32, border: '1px solid #fed7aa', borderRadius: 6, padding: '0 8px', background: '#fff' }}
                  />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
                <input
                  value={manualRawValue}
                  onChange={(event) => setManualRawValue(event.target.value)}
                  placeholder="Type while you are on the phone"
                  style={{ height: 34, border: '1px solid #fed7aa', borderRadius: 6, padding: '0 9px', background: '#fff' }}
                />
                <Button type="button" variant="outline" size="sm" disabled={manualSaving || !manualRawValue.trim()} onClick={() => { void saveManualFact(); }}>
                  <Save className="mr-2 h-4 w-4" aria-hidden />
                  Save
                </Button>
              </div>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {facts.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--color-muted-foreground)', fontSize: 12 }}>No facts received yet.</p>
              ) : facts.map((fact) => (
                <div key={fact.fact_id} style={{ borderTop: '1px solid var(--kp-divider)', paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ color: 'var(--kp-navy)', fontSize: 13, fontWeight: 800 }}>{fact.kind}</div>
                      <div style={{ color: 'var(--color-muted-foreground)', fontSize: 13 }}>
                        {revealed[fact.fact_id] ?? fact.display_value}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Reveal fact"
                        onClick={() => {
                          void intakeFactReveal(fact.fact_id).then((full) => {
                            setRevealed((current) => ({ ...current, [fact.fact_id]: JSON.stringify(full.value) }));
                          });
                        }}
                      >
                        <Eye className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Purge fact"
                        onClick={() => {
                          void intakeFactPurge(matterId, fact.kind).then(() => {
                            setFacts((current) => current.filter((candidate) => candidate.fact_id !== fact.fact_id));
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <ProvenanceChip
                      channel={fact.provenance.channel}
                      label={fact.provenance.channel === 'manual' ? 'manual' : 'typed by client'}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {intake.receivedItems.length > 0 ? (
            <section style={{ border: '1px solid var(--kp-divider)', borderRadius: 8, background: '#fff', padding: 14 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--kp-navy)' }}>Received items</h3>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {intake.receivedItems.map((item) => (
                  <div key={`${item.itemId}:${item.receivedAt}`} style={{ fontSize: 13, color: 'var(--kp-navy)' }}>
                    {item.label}
                    {item.filePath ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => onOpenFile?.(item.filePath ?? '')}>
                        <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                        View in folder
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
