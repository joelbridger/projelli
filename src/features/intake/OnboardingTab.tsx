import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  ExternalLink,
  Trash2,
} from 'lucide-react';

import { Button } from '@/ui/button';
import type { IntakeRecord } from '@/platform/intake/intakeStore';
import type { SignatureStatus } from '@/platform/intake/docusignSignature/signatureRecord';
import { SendForSignatureDialog } from './docusignSigning/SendForSignatureDialog';
import { requestItemDisplayLabel, requestItemStatusLabel } from './requestItemLabels';
import {
  intakeFactList,
  intakeFactPurge,
  intakeFactReveal,
  type MaskedClientFact,
} from '@/platform/intake/factsStore';
import { reconstructAdvisorIntakeLink } from '@/platform/intake/advisorIntakeLink';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { LinkLifecyclePanel } from './LinkLifecyclePanel';
import { EmailReplyProposalCard } from './EmailReplyProposalCard';
import { DocumentExtractionReviewPanel } from './DocumentExtractionReviewPanel';
import { EmailReplyQuarantinePanel } from './EmailReplyQuarantinePanel';
import { PhoneWalkthrough } from './PhoneWalkthrough';

export interface OnboardingTabProps {
  matterId: string;
  intake: IntakeRecord | null;
  /** The generalized Requests tab supplies each request's local display title. */
  title?: string;
  testId?: string;
  /** Matter-wide inbox panels are rendered once by the Requests tab, per matter. */
  showMatterSignals?: boolean;
  /** Lets the Requests tab refresh every request card after a matter-wide acceptance. */
  factsRefreshVersion?: number;
  advisorId?: string;
  onExtend?: (intakeId: string) => Promise<void> | void;
  onRevoke?: (intakeId: string) => Promise<void> | void;
  onRegenerate?: (intakeId: string) => Promise<void> | void;
  onShareWithTeam?: (intakeId: string) => Promise<void> | void;
  onOpenFile?: (path: string) => void;
  workspaceService?: WorkspaceService | null | undefined;
  matterFolderPath?: string | undefined;
  /** Encrypted-local signature state is loaded by the caller, never put in intake persistence. */
  signatureStatuses?: Record<string, SignatureStatus | undefined>;
  onSendForSignature?: (input: { intake: IntakeRecord; signatureItemId: string; signerName: string; signerEmail: string }) => Promise<void> | void;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function provenanceColor(channel: string): {
  bg: string;
  color: string;
  border: string;
} {
  if (channel === 'manual') {
    return {
      bg: 'var(--kp-warning-bg)',
      color: 'var(--kp-warning)',
      border: 'var(--kp-warning-line)',
    };
  }
  if (channel === 'intake_link') {
    return {
      bg: 'var(--kp-success-bg)',
      color: 'var(--kp-success-text)',
      border: 'var(--kp-success-line)',
    };
  }
  return {
    bg: 'var(--kp-assured-bg)',
    color: 'var(--kp-assured)',
    border: 'var(--kp-assured-line)',
  };
}

function ProvenanceChip({
  label,
  channel,
}: {
  label: string;
  channel: string;
}) {
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

function factProvenanceLabel(channel: string): string {
  if (channel === 'phone_walkthrough') return 'entered by you on a call';
  if (channel === 'manual') return 'manual';
  if (channel === 'email_reply') return 'from email reply';
  return 'typed by client';
}

export function OnboardingTab({
  matterId,
  intake,
  title,
  testId = 'onboarding-tab',
  showMatterSignals = true,
  factsRefreshVersion = 0,
  advisorId = 'advisor',
  onExtend,
  onRevoke,
  onRegenerate,
  onShareWithTeam,
  onOpenFile,
  workspaceService,
  matterFolderPath,
  signatureStatuses,
  onSendForSignature,
}: OnboardingTabProps) {
  const { t } = useTranslation();
  const [facts, setFacts] = useState<MaskedClientFact[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [phoneWalkthroughOpen, setPhoneWalkthroughOpen] = useState(false);
  const [signatureDialogItemId, setSignatureDialogItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void intakeFactList(matterId)
      .then((next) => {
        if (!cancelled) setFacts(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setActionError(
            error instanceof Error ? error.message : 'Could not load facts.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [factsRefreshVersion, matterId, intake?.receivedItems.length]);

  const completedCount = useMemo(
    () =>
      intake?.items.filter((item) => item.state !== 'not_started').length ?? 0,
    [intake?.items]
  );

  if (!intake) {
    return (
      <div
        style={{
          padding: '28px var(--kp-gutter)',
          color: 'var(--color-muted-foreground)',
        }}
      >
        {t('intake.onboarding.no-link')}
      </div>
    );
  }

  const handleAsyncError = (error: unknown, fallback: string) => {
    setActionError(error instanceof Error ? error.message : fallback);
  };

  const copyLink = async () => {
    const link =
      intake.link ??
      (await reconstructAdvisorIntakeLink({
        intakeId: intake.intakeId,
        publicKeyRawB64: intake.publicKeyRawB64 ?? '',
      }));
    await navigator.clipboard.writeText(link);
  };

  const reloadFacts = async () => {
    setFacts(await intakeFactList(matterId));
  };

  return (
    <div
      data-testid={testId}
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--kp-navy)',
                }}
              >
                {title ?? intake.requestTitle ?? (intake.kind === 'standing' ? 'Client request' : 'Onboarding')}
              </h2>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 13,
                  color: 'var(--color-muted-foreground)',
                }}
              >
                {t('intake.onboarding.activity-count', {
                  completed: completedCount,
                  total: intake.items.length,
                })}
              </p>
            </div>
            <span
              style={{
                border: '1px solid var(--kp-divider)',
                borderRadius: 999,
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 800,
                color:
                  intake.status === 'active'
                    ? 'var(--kp-success-text)'
                    : 'var(--color-muted-foreground)',
                background:
                  intake.status === 'active'
                    ? 'var(--kp-success-bg)'
                    : 'var(--kp-bg-soft)',
              }}
            >
              {intake.status}
            </span>
          </div>

          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            {showMatterSignals ? (
              <>
                <EmailReplyProposalCard
                  matterId={matterId}
                  advisorId={advisorId}
                  onAccepted={() => {
                    setRevealed({});
                    void reloadFacts().catch((error: unknown) => {
                      handleAsyncError(error, 'Could not load facts.');
                    });
                  }}
                />
                <EmailReplyQuarantinePanel matterId={matterId} advisorId={advisorId} />
                <DocumentExtractionReviewPanel
                  matterId={matterId}
                  advisorId={advisorId}
                  onAccepted={() => {
                    setRevealed({});
                    void reloadFacts().catch((error: unknown) => {
                      handleAsyncError(error, 'Could not load facts.');
                    });
                  }}
                />
              </>
            ) : null}
            {intake.items.map((item) => (
              <div
                key={item.itemId}
                style={{
                  border: '1px solid var(--kp-divider)',
                  borderRadius: 8,
                  background: 'var(--kp-surface-card)',
                  padding: 14,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong style={{ color: 'var(--kp-navy)', fontSize: 14 }}>
                      {requestItemDisplayLabel(intake, item.itemId, item.label)}
                    </strong>
                    {item.provenance ? (
                      <ProvenanceChip
                        label={item.provenance.label}
                        channel={item.provenance.channel}
                      />
                    ) : null}
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      color: 'var(--color-muted-foreground)',
                      fontSize: 12,
                    }}
                  >
                    {requestItemStatusLabel(intake, item.itemId, item.state, signatureStatuses)}
                    {item.provenance?.at
                      ? ` · ${formatDate(item.provenance.at)}`
                      : ''}
                  </div>
                </div>
                {item.filePath ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenFile?.(item.filePath ?? '')}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                    View
                  </Button>
                ) : null}
                {(() => {
                  const signature = intake.requestItems?.find((candidate) => candidate.item_id === item.itemId);
                  if (signature?.t !== 'signature' || signature.grade !== 'docusign') return null;
                  const source = intake.items.find((candidate) => candidate.itemId === signature.source_pdf_fill_item_id);
                  const canSend = source?.state === 'received' && (signatureStatuses?.[signature.item_id] === undefined || ['not_ready', 'ready_to_send', 'needs_followup', 'declined', 'voided'].includes(signatureStatuses[signature.item_id] ?? 'not_ready'));
                  return <Button type="button" variant="outline" size="sm" disabled={!canSend || !onSendForSignature} onClick={() => { setSignatureDialogItemId(signature.item_id); }}>{t('intake.signature.send-for-signature')}</Button>;
                })()}
              </div>
            ))}
          </div>
          {signatureDialogItemId ? <SendForSignatureDialog open signerName={intake.clientFirstName} signerEmail={intake.clientEmail ?? ''} {...(signatureStatuses?.[signatureDialogItemId] !== undefined ? { status: signatureStatuses[signatureDialogItemId] } : {})} canSend={Boolean(onSendForSignature)} onOpenChange={(open) => { if (!open) setSignatureDialogItemId(null); }} onConfirm={({ name, email }) => onSendForSignature?.({ intake, signatureItemId: signatureDialogItemId, signerName: name, signerEmail: email })} /> : null}
        </section>

        <aside style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          <LinkLifecyclePanel
            intake={intake}
            onCopyLink={copyLink}
            {...(onExtend ? { onExtend } : {})}
            {...(onRegenerate ? { onRegenerate } : {})}
            {...(onRevoke ? { onRevoke } : {})}
          />

          {onShareWithTeam ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { void Promise.resolve(onShareWithTeam(intake.intakeId)).catch((error: unknown) => { handleAsyncError(error, 'Could not share this intake with the team.'); }); }}
            >
              {t('intake.onboarding.share-with-team')}
            </Button>
          ) : null}

          <section
            style={{
              border: '1px solid var(--kp-divider)',
              borderRadius: 8,
              background: 'var(--kp-surface-card)',
              padding: 14,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--kp-navy)' }}>
              {t('intake.onboarding.phone-call-title', { client: intake.clientFirstName })}
            </h3>
            <p style={{ margin: '6px 0 10px', fontSize: 12, color: 'var(--color-muted-foreground)' }}>
              {t('intake.onboarding.phone-call-description')}
            </p>
            <Button type="button" onClick={() => { setPhoneWalkthroughOpen(true); }}>
              {t('intake.onboarding.start-phone-walkthrough')}
            </Button>
          </section>

          <section
            style={{
              border: '1px solid var(--kp-divider)',
              borderRadius: 8,
              background: 'var(--kp-surface-card)',
              padding: 14,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 800,
                color: 'var(--kp-navy)',
              }}
            >
              Received facts
            </h3>
            {actionError ? (
              <p
                style={{
                  margin: '8px 0 0',
                  color: 'var(--kp-danger)',
                  fontSize: 12,
                }}
              >
                {actionError}
              </p>
            ) : null}
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {facts.length === 0 ? (
                <p
                  style={{
                    margin: 0,
                    color: 'var(--color-muted-foreground)',
                    fontSize: 12,
                  }}
                >
                  {t('intake.onboarding.no-facts')}
                </p>
              ) : (
                facts.map((fact) => (
                  <div
                    key={fact.fact_id}
                    style={{
                      borderTop: '1px solid var(--kp-divider)',
                      paddingTop: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            color: 'var(--kp-navy)',
                            fontSize: 13,
                            fontWeight: 800,
                          }}
                        >
                          {fact.kind}
                        </div>
                        <div
                          style={{
                            color: 'var(--color-muted-foreground)',
                            fontSize: 13,
                          }}
                        >
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
                            void intakeFactReveal(matterId, fact.fact_id)
                              .then((full) => {
                                setRevealed((current) => ({
                                  ...current,
                                  [fact.fact_id]: JSON.stringify(full.value),
                                }));
                              })
                              .catch((error: unknown) => {
                                handleAsyncError(
                                  error,
                                  'Could not reveal the fact.'
                                );
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
                            void intakeFactPurge(matterId, fact.fact_id)
                              .then(() => {
                                setFacts((current) =>
                                  current.filter(
                                    (candidate) =>
                                      candidate.fact_id !== fact.fact_id
                                  )
                                );
                              })
                              .catch((error: unknown) => {
                                handleAsyncError(
                                  error,
                                  'Could not purge the fact.'
                                );
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
                        label={factProvenanceLabel(fact.provenance.channel)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {intake.receivedItems.length > 0 ? (
            <section
              style={{
                border: '1px solid var(--kp-divider)',
                borderRadius: 8,
                background: 'var(--kp-surface-card)',
                padding: 14,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 800,
                  color: 'var(--kp-navy)',
                }}
              >
                Received items
              </h3>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {intake.receivedItems.map((item) => (
                  <div
                    key={`${item.itemId}:${item.receivedAt}`}
                    style={{ fontSize: 13, color: 'var(--kp-navy)' }}
                  >
                    {item.label}
                    {item.filePath ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenFile?.(item.filePath ?? '')}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                        {t('intake.onboarding.view-in-folder')}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
      {phoneWalkthroughOpen ? (
        <PhoneWalkthrough
          matterId={matterId}
          intake={intake}
          advisorId={advisorId}
          workspaceService={workspaceService}
          matterFolderPath={matterFolderPath}
          onClose={() => { setPhoneWalkthroughOpen(false); }}
          onCompleted={() => {
            setRevealed({});
            void reloadFacts().catch((error: unknown) => {
              handleAsyncError(error, 'Could not load facts.');
            });
          }}
        />
      ) : null}
    </div>
  );
}
