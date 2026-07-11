import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, FileText, Plus } from 'lucide-react';

import { EV_MATTER_LAUNCH, EV_OPEN_MATTER_MANAGER } from '@/config/identity';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { reconstructAdvisorIntakeLink } from '@/platform/intake/advisorIntakeLink';
import {
  deriveRequestRow,
  sortOnboardingRows,
  type OnboardingRow,
  type RequestRow,
} from '@/platform/intake/onboardingModel';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import { computeOnboardingKpis } from '@/platform/intake/onboardingKpis';
import { Button } from '@/ui/kp';
import { OnboardingBoardEmptyState } from './OnboardingBoardEmptyState';
import { OnboardingKpiStrip } from './OnboardingKpiStrip';
import { OnboardingBoardRow } from './OnboardingBoardRow';
import { FormBuilderLibrary } from './formBuilder/FormBuilderLibrary';

export type RequestsBoardFilter = 'onboarding' | 'all';

export interface RequestsBoardProps {
  now?: Date;
  onNewClient?: () => void;
  onOpenNudge?: (row: RequestRow) => void;
  onOpenLinkSignals?: (row: RequestRow) => void;
  onReviewItems?: (row: RequestRow) => void;
  onCopyLink?: (row: RequestRow) => Promise<void> | void;
  renderNudgeSlot?: (row: RequestRow) => ReactNode;
  renderLinkSignals?: (row: RequestRow) => ReactNode;
  renderEmailReplySignals?: (row: RequestRow) => ReactNode;
  /** Compatibility seam: the old board is this same data set filtered to onboarding. */
  filter?: RequestsBoardFilter;
  testId?: string;
  title?: string;
}

function defaultNewClient(): void {
  window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
}

/**
 * The cross-client request board deliberately derives only row metadata. It
 * never loads client facts or document details; those stay in the client tab.
 */
export function RequestsBoard({
  now,
  onNewClient,
  onOpenNudge,
  onOpenLinkSignals,
  onReviewItems,
  onCopyLink,
  renderNudgeSlot,
  renderLinkSignals,
  renderEmailReplySignals,
  filter,
  testId = 'requests-board',
  title,
}: RequestsBoardProps) {
  const { t } = useTranslation();
  const intakesById = useIntakeStore((state) => state.intakesById);
  const setClientMapHubTab = useMatterStore((state) => state.setClientMapHubTab);
  const setClientMapHubRequestId = useMatterStore((state) => state.setClientMapHubRequestId);
  const [savedFilter, setSavedFilter] = useState<RequestsBoardFilter>('onboarding');
  const [formLibraryOpen, setFormLibraryOpen] = useState(false);
  const activeFilter = filter ?? savedFilter;
  const handleNewClient = onNewClient ?? defaultNewClient;

  const rows = useMemo(() => {
    const effectiveNow = now ?? new Date();
    const all = Object.values(intakesById)
      .filter((intake) => intake.status === 'active')
      .map((intake) => deriveRequestRow(intake, effectiveNow, DEFAULT_ONBOARDING_CONFIG));
    // Lane 1's established sorter contains the visual priority contract.
    return sortOnboardingRows(all);
  }, [intakesById, now]);

  const visibleRows = useMemo(
    () => activeFilter === 'onboarding' ? rows.filter((row) => row.kind === 'onboarding') : rows,
    [activeFilter, rows],
  );

  const onboardingRows = useMemo(
    () => rows.filter((row): row is OnboardingRow => row.kind === 'onboarding'),
    [rows],
  );
  const kpis = useMemo(
    () => computeOnboardingKpis(onboardingRows, Object.values(intakesById)),
    [intakesById, onboardingRows],
  );

  const openRow = useCallback((row: RequestRow) => {
    window.dispatchEvent(new CustomEvent(EV_MATTER_LAUNCH, {
      detail: { matterId: row.matterId, surface: 'matters' },
    }));
    setClientMapHubRequestId(row.requestId);
    // Keep the legacy id so existing deep links continue to resolve. Its UI is
    // now the Requests tab.
    setClientMapHubTab('onboarding');
  }, [setClientMapHubRequestId, setClientMapHubTab]);

  const reviewRow = useCallback((row: RequestRow) => {
    if (onReviewItems) {
      onReviewItems(row);
      return;
    }
    openRow(row);
  }, [onReviewItems, openRow]);

  const copyLink = useCallback(async (row: RequestRow) => {
    if (onCopyLink) {
      await onCopyLink(row);
      return;
    }
    const intake = intakesById[row.requestId];
    if (!intake) throw new Error('No intake link is available.');
    const clipboard = (navigator as unknown as { clipboard?: { writeText?: (text: string) => Promise<void> } }).clipboard;
    if (!clipboard?.writeText) throw new Error('Clipboard is not available.');
    const link = intake.link ?? (intake.publicKeyRawB64
      ? await reconstructAdvisorIntakeLink({ intakeId: intake.intakeId, publicKeyRawB64: intake.publicKeyRawB64 })
      : null);
    if (!link) throw new Error('No intake link is available.');
    await clipboard.writeText(link);
  }, [intakesById, onCopyLink]);

  return (
    <div data-testid={testId}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--kp-space-md)', padding: '16px 18px', borderBottom: '1px solid var(--kp-divider)', background: 'var(--kp-surface-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)', minWidth: 0 }}>
          <ClipboardList aria-hidden="true" size={18} strokeWidth={1.75} style={{ color: 'var(--kp-accent)', flex: 'none' }} />
          <h2 style={{ margin: 0, color: 'var(--kp-navy)', fontSize: 'var(--kp-font-lg)', fontWeight: 'var(--kp-weight-bold)', lineHeight: 'var(--kp-leading-tight)' }}>
            {title ?? 'Requests'}
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)' }}>
          <Button variant="secondary" size="sm" iconLeft={FileText} onClick={() => { setFormLibraryOpen(true); }} data-testid="requests-board-manage-forms">
            Manage forms
          </Button>
          <Button variant="primary" size="sm" iconLeft={Plus} onClick={handleNewClient} data-testid="onboarding-board-new-client">
            {t('intake.board.new-client')}
          </Button>
        </div>
      </div>

      {!filter ? (
        <div role="tablist" aria-label="Request filters" style={{ display: 'flex', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--kp-divider)' }}>
          <Button type="button" size="sm" variant={activeFilter === 'onboarding' ? 'primary' : 'secondary'} onClick={() => { setSavedFilter('onboarding'); }} data-testid="requests-filter-onboarding">Onboarding</Button>
          <Button type="button" size="sm" variant={activeFilter === 'all' ? 'primary' : 'secondary'} onClick={() => { setSavedFilter('all'); }} data-testid="requests-filter-all">All requests</Button>
        </div>
      ) : null}

      {activeFilter === 'onboarding' ? <OnboardingKpiStrip kpis={kpis} /> : null}

      {visibleRows.length === 0 ? (
        <OnboardingBoardEmptyState onNewClient={handleNewClient} />
      ) : (
        <div>
          {visibleRows.map((row) => {
            const isOnboarding = row.kind === 'onboarding';
            const boardRow = row as OnboardingRow;
            return (
            <div key={row.requestId} data-testid={`requests-board-row-${row.requestId}`}>
              {activeFilter === 'all' ? (
                <div style={{ padding: '8px 18px 0', color: 'var(--color-muted-foreground)', fontSize: 12, fontWeight: 700 }}>
                  {isOnboarding ? 'Onboarding' : (intakesById[row.requestId]?.requestTitle ?? 'Client request')}
                </div>
              ) : null}
              <OnboardingBoardRow
                row={boardRow}
                hideNudgeAction={!isOnboarding}
                onOpen={openRow}
                onReviewItems={reviewRow}
                onCopyLink={copyLink}
                canCopyLink={Boolean(onCopyLink || intakesById[row.requestId]?.link || intakesById[row.requestId]?.publicKeyRawB64)}
                {...(isOnboarding && onOpenNudge ? { onOpenNudge } : {})}
                {...(onOpenLinkSignals ? { onOpenLinkSignals } : {})}
                {...(renderNudgeSlot ? { renderNudgeSlot } : {})}
                {...(renderLinkSignals ? { renderLinkSignals } : {})}
                {...(renderEmailReplySignals ? { renderEmailReplySignals } : {})}
              />
            </div>
            );
          })}
        </div>
      )}
      <FormBuilderLibrary open={formLibraryOpen} onOpenChange={setFormLibraryOpen} />
    </div>
  );
}
