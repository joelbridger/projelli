import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';

import { Button } from '@/ui/button';
import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import { deriveRequestRow } from '@/platform/intake/onboardingModel';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import { emailReplyProposalList } from '@/platform/intake/emailReplyProposalStore';
import { listEmailQuarantines } from '@/platform/intake/emailQuarantineStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { RequestFromClientIssuer } from './RequestFromClientDialog';
import { RequestFromClientDialog } from './RequestFromClientDialog';
import { OnboardingTab } from './OnboardingTab';

export interface ClientRequestsTabProps {
  matterId: string;
  clientName: string;
  advisorId?: string;
  issueRequest: RequestFromClientIssuer;
  activeRequestId?: string | null;
  onActiveRequestConsumed?: () => void;
  onExtend?: (intakeId: string) => Promise<void> | void;
  onRevoke?: (intakeId: string) => Promise<void> | void;
  onRegenerate?: (intakeId: string) => Promise<void> | void;
  onShareWithTeam?: (intakeId: string) => Promise<void> | void;
  onOpenFile?: (path: string) => void;
  workspaceService?: WorkspaceService | null;
  matterFolderPath?: string;
}

function requestTitle(intake: IntakeRecord): string {
  return intake.requestTitle ?? (intake.kind === 'standing' ? 'Client request' : 'Onboarding');
}

export function ClientRequestsTab({
  matterId,
  clientName,
  advisorId = 'advisor',
  issueRequest,
  activeRequestId,
  onActiveRequestConsumed,
  onExtend,
  onRevoke,
  onRegenerate,
  onShareWithTeam,
  onOpenFile,
  workspaceService,
  matterFolderPath,
}: ClientRequestsTabProps) {
  const intakesById = useIntakeStore((state) => state.intakesById);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(activeRequestId ?? null);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [quarantineCounts, setQuarantineCounts] = useState<Record<string, number>>({});

  const requests = useMemo(() => {
    const all = useIntakeStore.getState().getIntakesForMatter(matterId);
    return [...all].sort((a, b) => {
      const aOnboarding = (a.kind ?? 'onboarding') === 'onboarding' && a.status === 'active';
      const bOnboarding = (b.kind ?? 'onboarding') === 'onboarding' && b.status === 'active';
      if (aOnboarding !== bOnboarding) return aOnboarding ? -1 : 1;
      return (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.intakeId.localeCompare(b.intakeId);
    });
  }, [intakesById, matterId]);

  useEffect(() => {
    if (!activeRequestId || !intakesById[activeRequestId]) return;
    setSelectedRequestId(activeRequestId);
    onActiveRequestConsumed?.();
  }, [activeRequestId, intakesById, onActiveRequestConsumed]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void Promise.all([emailReplyProposalList(matterId), listEmailQuarantines(matterId)])
        .then(([proposals, quarantines]) => {
          if (cancelled) return;
          const proposalNext: Record<string, number> = {};
          const quarantineNext: Record<string, number> = {};
          for (const proposal of proposals) proposalNext[proposal.matchedRequestId] = (proposalNext[proposal.matchedRequestId] ?? 0) + 1;
          for (const quarantine of quarantines) {
            if (quarantine.matchedRequestId) quarantineNext[quarantine.matchedRequestId] = (quarantineNext[quarantine.matchedRequestId] ?? 0) + 1;
          }
          setReplyCounts(proposalNext);
          setQuarantineCounts(quarantineNext);
        })
        .catch((error: unknown) => { console.warn('[ClientRequestsTab] Could not load request reply signals:', error); });
    };
    load();
    const interval = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [matterId]);

  return (
    <div data-testid="client-requests-tab" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--color-background)', padding: '20px var(--kp-gutter) 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--kp-navy)', fontSize: 20, fontWeight: 800 }}>Requests</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--color-muted-foreground)', fontSize: 13 }}>Every open request for this client stays separate.</p>
        </div>
        <Button type="button" onClick={() => { setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Request from client
        </Button>
      </div>

      {requests.length === 0 ? (
        <section data-testid="client-requests-empty" style={{ border: '1px dashed var(--kp-divider)', borderRadius: 8, padding: 24, color: 'var(--color-muted-foreground)' }}>
          <ClipboardList className="mb-2 h-5 w-5" aria-hidden />
          No requests yet. Start one when you need something from this client.
        </section>
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          {requests.map((intake) => {
            const row = deriveRequestRow(intake, new Date(), DEFAULT_ONBOARDING_CONFIG);
            const selected = selectedRequestId === intake.intakeId;
            return (
              <section key={intake.intakeId} data-testid={`client-request-${intake.intakeId}`} data-selected={selected ? 'true' : 'false'} style={{ border: selected ? '2px solid var(--kp-accent)' : '1px solid var(--kp-divider)', borderRadius: 10, overflow: 'hidden' }}>
                <button type="button" onClick={() => { setSelectedRequestId(intake.intakeId); }} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--kp-divider)', background: 'var(--kp-surface-card)', padding: '12px 16px', cursor: 'pointer' }}>
                  <strong style={{ color: 'var(--kp-navy)' }}>{requestTitle(intake)}</strong>
                  <span style={{ marginLeft: 8, color: 'var(--color-muted-foreground)', fontSize: 12 }}>{row.kind === 'onboarding' ? 'Onboarding' : 'Standing request'} · {row.receivedCount}/{row.requiredCount} received</span>
                  <span data-testid={`request-nudge-state-${intake.intakeId}`} style={{ display: 'block', marginTop: 4, color: 'var(--color-muted-foreground)', fontSize: 12 }}>Nudge: {row.nudgeEligibility.reason.replaceAll('_', ' ')}</span>
                  {(replyCounts[intake.intakeId] ?? 0) + (quarantineCounts[intake.intakeId] ?? 0) > 0 ? <span data-testid={`request-email-signals-${intake.intakeId}`} style={{ display: 'block', marginTop: 4, color: 'var(--kp-warning)', fontSize: 12 }}>{replyCounts[intake.intakeId] ?? 0} reply items · {quarantineCounts[intake.intakeId] ?? 0} quarantined</span> : null}
                </button>
                <OnboardingTab
                  matterId={matterId}
                  intake={intake}
                  title={requestTitle(intake)}
                  testId={`client-request-detail-${intake.intakeId}`}
                  showMatterSignals={false}
                  advisorId={advisorId}
                  {...(onExtend ? { onExtend } : {})}
                  {...(onRevoke ? { onRevoke } : {})}
                  {...(onRegenerate ? { onRegenerate } : {})}
                  {...(onShareWithTeam ? { onShareWithTeam } : {})}
                  {...(onOpenFile ? { onOpenFile } : {})}
                  {...(workspaceService ? { workspaceService } : {})}
                  {...(matterFolderPath ? { matterFolderPath } : {})}
                />
              </section>
            );
          })}
        </div>
      )}
      <RequestFromClientDialog matterId={matterId} clientName={clientName} open={dialogOpen} onOpenChange={setDialogOpen} issueRequest={issueRequest} />
    </div>
  );
}
