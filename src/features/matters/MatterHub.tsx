/**
 * MatterHub — per-matter command-center hub.
 *
 * Full-page workspace for a single client: a header with back navigation, a row
 * of sub-tabs (Overview · Documents · Email · Meetings · Activity), and the
 * matching panel below. Overview leads with the Client Map (the hero) and a
 * compact Ask box; Documents / Email / Activity render THIS client's scoped
 * surfaces in place, so opening a file or reading mail never leaves the client
 * (no orphaned global destinations) — those are passed in as render props from
 * the shell, which owns their handler wiring. Meetings (Wave 3c) is
 * self-contained (ClientMeetingsTab/MeetingEntry read the workspace/matter
 * stores directly), so it's rendered inline rather than via a render prop.
 *
 * Light theme only. Inline styles + CSS vars.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Lock, FileText, Mail, Clock, Loader2, Map, Users, Mic } from 'lucide-react';
import { ClientMeetingsTab } from '@/features/meetings/ClientMeetingsTab';
import { MeetingEntry } from '@/features/meetings/MeetingEntry';
import { isTauri } from '@tauri-apps/api/core';
import { useMatters, useActiveMatterPrivileged, useMatterStore, SAMPLE_MATTER_ID, type ClientMapHubTab } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { Badge } from '@/ui/kp';
import SurfaceHeader from '@/ui/SurfaceHeader';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { useClientMap } from '@/features/matters/useClientMap';
import { usePromptDialog } from '@/platform/hooks/usePromptDialog';
import { PromptDialog } from '@/ui/PromptDialog';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { BeforeYouMeetStrip } from '@/features/meetings/BeforeYouMeetStrip';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { ClientMapUpdatesTray } from '@/features/matters/ClientMapUpdatesTray';
import { CrmWriteReviewCard } from '@/features/matters/CrmWriteReviewCard';
import { VoiceprintsCard } from '@/features/matters/VoiceprintsCard';
import { isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useCrmStore } from '@/platform/connectors/crm/crmStore';
import { answerQuestion, flagForClient } from '@/features/matters/clientMap/guidedInterview';
import { dispatchOpenSource } from '@/features/matters/clientMap/openSource';
import type { SourceRef } from '@/platform/clientMap/types';
import type { AuditEntry } from '@/platform/types/audit';
import type { Matter } from '@/platform/types/matter';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

// ── Props ──────────────────────────────────────────────────────────────────

export interface MatterHubProps {
  matterId: string;
  onBack: () => void;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * The scoped per-client surfaces, supplied by the shell (which owns their
   * many handlers). Each is rendered only when its sub-tab is active, so the
   * heavy surface (and its effects) mounts on demand, not on every hub open.
   * Absent (e.g. in isolated component tests) → the sub-tab shows a placeholder.
   *
   * `renderDocuments` is handed THIS hub's exact `matter` (the one resolved from
   * `matterId` below), so the scoped Documents surface reads its `folderPaths` /
   * id from the client actually being rendered — never from a stale outer
   * "active matter" closure in the shell (2026-07-01 re-fix: a stale/mismatched
   * matter was one way a wrong/empty `scopeFolderPaths` reached the scoped tab).
   */
  renderDocuments?: (matter: Matter | null) => ReactNode;
  renderEmail?: () => ReactNode;
  renderActivity?: () => ReactNode;
  /**
   * The active WorkspaceService (or null before a workspace is open), passed
   * down from the shell for the self-contained Meetings sub-tab
   * (ClientMeetingsTab/MeetingEntry) — features must not reach for the
   * app-layer singleton themselves, per ARCHITECTURE.md's DAG, so this is
   * threaded as a plain prop rather than imported.
   */
  workspaceService?: WorkspaceService | null;
}

// ── Sub-tabs ───────────────────────────────────────────────────────────────

type HubTab = ClientMapHubTab;

const HUB_TABS: { id: HubTab; label: string; Icon: typeof FileText }[] = [
  { id: 'overview', label: 'Client Map', Icon: Map },
  { id: 'documents', label: 'Documents', Icon: FileText },
  { id: 'email', label: 'Email', Icon: Mail },
  { id: 'meetings', label: 'Meetings', Icon: Mic },
  { id: 'activity', label: 'Activity', Icon: Clock },
];

// ── Labels ─────────────────────────────────────────────────────────────────

const LABEL_YOUR_ANSWER_PROMPT = 'Your answer to:';

// ── MatterHub ──────────────────────────────────────────────────────────────

export function MatterHub({ matterId, onBack, onAuditLog, renderDocuments, renderEmail, renderActivity, workspaceService }: MatterHubProps) {
  // ── Client Map wiring ────────────────────────────────────────────────────
  // Declare client map hook at component top — must not be inside a condition.
  // autoBuild: a client's Client Map builds automatically the first time the
  // matter is opened (no manual "Open Client Map" step), so connector-created
  // clients a Wealthbox sync added show a populated, cited map — mirroring the
  // at-a-glance auto-run. The sample matter is excluded (its content is canned).
  const clientMap = useClientMap(matterId, {
    ...(onAuditLog ? { onAuditLog } : {}),
    autoBuild: matterId !== SAMPLE_MATTER_ID,
  });
  const { checkForUpdates } = clientMap;
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath);
  const matters = useMatters();
  const matter = matters.find((m) => m.id === matterId) ?? null;
  const isPrivileged = useActiveMatterPrivileged();
  const entityLabel = useEntityLabel();
  // The per-tab AI-status pill (same as Ask / Workflows) — the single, deduped
  // egress indicator now lives once per surface header, not in the top bar.
  const confidentialityMode = useConfidentialityMode();
  const egressProvider = useActiveEgressProvider(confidentialityMode);

  // ── Active sub-tab ─────────────────────────────────────────────────────────
  // Overview (the Client Map) is the default. A client-list quick-action can
  // request a specific sub-tab (the Documents/Email row shortcuts) via the
  // store's one-shot `clientMapHubTab`, so those land on THIS client's scoped
  // sub-tab instead of a global surface.
  const pendingHubTab = useMatterStore((s) => s.clientMapHubTab);
  const setPendingHubTab = useMatterStore((s) => s.setClientMapHubTab);
  // The initializer above seeds the sub-tab from any pending request on mount.
  // Resetting to Overview when the CLIENT changes is handled by the per-matter
  // key on MatterHub (MattersHome keys it by matterId, so a client switch
  // remounts this whole component fresh) — no reset effect needed here, which
  // also keeps the hub free of cross-client state reuse (matter isolation).
  const [subTab, setSubTab] = useState<HubTab>(() => pendingHubTab ?? 'overview');

  // Honor + consume a pending sub-tab request. Reactive on `pendingHubTab` so it
  // handles a quick-action targeting the SAME already-open client (no remount).
  // The setState is deferred out of the effect body (queueMicrotask — the
  // codebase pattern) to avoid cascading-render warnings.
  useEffect(() => {
    if (pendingHubTab) {
      const requested = pendingHubTab;
      queueMicrotask(() => {
        setSubTab(requested);
        setPendingHubTab(null);
      });
    }
  }, [pendingHubTab, setPendingHubTab]);

  // The currently open meeting on the Meetings sub-tab (list view when null).
  // Reset happens naturally on client switch (MatterHub remounts per matter).
  const [selectedMeeting, setSelectedMeeting] = useState<{ dir: string; folderName: string; startMs?: number } | null>(null);

  // Honor a `meeting:<dir>#<ms>` Client Map source click or Activity entry
  // click (Task 11's ref-resolution): land on the Meetings sub-tab with that
  // exact meeting open and seeked, same one-shot pattern as pendingHubTab.
  const pendingMeetingOpen = useMatterStore((s) => s.pendingMeetingOpen);
  const setPendingMeetingOpen = useMatterStore((s) => s.setPendingMeetingOpen);
  useEffect(() => {
    if (pendingMeetingOpen) {
      const req = pendingMeetingOpen;
      queueMicrotask(() => {
        setSubTab('meetings');
        setSelectedMeeting({
          dir: req.meetingDir,
          folderName: req.meetingDir.split('/').pop() ?? req.meetingDir,
          startMs: req.startMs,
        });
        setPendingMeetingOpen(null);
      });
    }
  }, [pendingMeetingOpen, setPendingMeetingOpen]);

  // Once a map exists, re-check for new source material. Covers BOTH a populated
  // map ('ready') AND one that was built empty ('empty') — the latter recovers a
  // map built before its content was indexed (e.g. a client opened before its
  // Wealthbox household synced): when the source fingerprint later changes,
  // checkForUpdates rebuilds and routes the new facts through the approve-first
  // tray. checkForUpdates no-ops when the fingerprint is unchanged, so an empty
  // matter with still no content costs nothing.
  //
  // Guard: the update check calls the desktop-only RAG engine (computeSource-
  // Fingerprint / buildClientMap), which throws outside Tauri. In a plain
  // browser (the web demo + seeded testMode previews) that error would flip a
  // freshly-seeded, cleanly-rendered map to the error state right after first
  // paint — so we skip the check entirely when not in the desktop app.
  useEffect(() => {
    if (!isTauri()) return;
    if (clientMap.status === 'ready' || clientMap.status === 'empty') {
      void checkForUpdates();
    }
  }, [clientMap.status, checkForUpdates]);

  // Live recovery: when a Wealthbox sync FINISHES while this client is already
  // open, re-check for the freshly-indexed CRM source material so an empty/stale
  // Client Map populates in place rather than only on the next reopen.
  // checkForUpdates() no-ops when the source fingerprint is unchanged, so firing
  // on every completion is safe. The effect re-runs only when the sync status
  // transitions (e.g. syncing -> done), so it fires once per completed sync.
  // Same not-in-Tauri guard as above (the sync + engine are desktop-only).
  const crmSyncStatus = useCrmStore((s) => s.progress?.status);
  useEffect(() => {
    if (!isTauri()) return;
    if (crmSyncStatus === 'done') {
      void checkForUpdates();
    }
  }, [crmSyncStatus, checkForUpdates]);

  // ── Client Map handlers ──────────────────────────────────────────────────
  // The Client Map is the hero of the Overview tab — always expanded.
  const [showInterview, setShowInterview] = useState(false);

  // In-app prompt dialog (WebView2-safe: native window.prompt is dead in the
  // Tauri Windows build, so Client Map edits/answers go through the in-DOM
  // dialog instead).
  const { prompt, dialogProps: promptDialogProps } = usePromptDialog();

  // Open the EXACT cited source (the specific document, scrolled to the cited
  // spot, or the specific email), not just the general Documents/Email surface.
  const handleOpenSource = useCallback((ref: SourceRef) => {
    dispatchOpenSource(matterId, ref);
  }, [matterId]);

  const handleEditItem = useCallback((sectionKey: string, itemId: string) => {
    void (async () => {
      // BUG-105: prefill the prompt with the item's current text so the user can
      // tweak it instead of retyping the whole thing from a blank box.
      const current = useClientMapStore.getState().getMap(matterId);
      const existingText =
        current?.sections.find((sec) => sec.key === sectionKey)?.items.find((it) => it.id === itemId)?.text ?? '';
      const text = await prompt('Edit item:', existingText, { title: 'Edit item', confirmLabel: 'Save' });
      if (text !== null && text.trim() !== '') {
        useClientMapStore.getState().editItem(matterId, sectionKey, itemId, text.trim());
      }
    })();
  }, [matterId, prompt]);

  if (!matter) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 12,
          fontFamily: 'Satoshi, sans-serif',
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-md)',
        }}
      >
        {entityLabel.One} not found
        <button
          type="button"
          onClick={onBack}
          style={{
            marginTop: 8,
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            border: '1px solid var(--color-border)',
            background: '#fff',
            color: 'var(--kp-navy)',
            cursor: 'pointer',
          }}
        >
          Back to {entityLabel.Other}
        </button>
      </div>
    );
  }

  const label = matterLabel(matter);
  // Title = just the client NAMES (drop the "- Household" suffix); the icon +
  // the left nav carry the "this is the Client Map" context. No subtitle under
  // the header (Jameson: no subtext under any tab header).
  const headerTitle = matter.client && matter.client.trim() !== '' ? matter.client : label;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
      }}
    >
      {/* ── A. Header row: [icon][name] on the left; the sub-tabs + the
             guided-interview action on the right (one clean line). ───────── */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--kp-divider)',
          flexShrink: 0,
        }}
      >
        <SurfaceHeader
          Icon={Map}
          iconColor="var(--kp-accent)"
          title={headerTitle}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-md)' }}>
              {/* Sub-tabs, inline to the right of the client name. Minimal
                  selected style: a soft demo-blue tint pill (no dark fill). */}
              <div role="tablist" aria-label="Client sections" data-testid="hub-subtab-bar" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {HUB_TABS.map(({ id, label: tabLabel }) => {
                  const active = subTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-testid={`hub-subtab-${id}`}
                      onClick={() => { setSubTab(id); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '7px 13px',
                        border: '1px solid transparent',
                        borderRadius: 'var(--radius-md)',
                        background: active ? 'var(--kp-accent-soft)' : 'transparent',
                        color: active ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                        fontWeight: active ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
                        fontSize: 'var(--kp-font-sm)',
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--kp-accent-softer)'; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {tabLabel}
                    </button>
                  );
                })}
              </div>

              {/* The guided-interview button moved to the BOTTOM of the Client
                  Map section rail (below "+ New section"). */}
              {(isPrivileged || matter.privileged) && (
                <span data-testid="hub-isolated-badge">
                  <Badge variant="privilege" size="sm" icon={Lock}>Isolated</Badge>
                </span>
              )}
              {matter.isSample && (
                <span data-testid="hub-sample-pill">
                  <Badge variant="sample" size="sm">Sample</Badge>
                </span>
              )}
              {/* Client boundary — a persistent reminder that recall here is
                  scoped to THIS household. Advisor Prep Hero never mixes one client's
                  files into another client's answers (matter isolation), and
                  making that visible is the trust story an advisor needs to see. */}
              <span
                data-testid="hub-scope-badge"
                title="Recall is scoped to this household. Advisor Prep Hero never mixes one client's files into another client's answers."
              >
                <Badge variant="neutral" size="sm" icon={Users}>
                  {(matter.name && matter.name.trim() ? matter.name : label)} only
                </Badge>
              </span>
              {/* AI-status pill — same dynamic badge as Ask / Workflows. */}
              <EgressIndicator provider={egressProvider} mode={confidentialityMode} variant="status" />
            </div>
          }
        />
      </div>

      {/* ── C. Active panel ────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {subTab === 'overview' && (
          <div
            data-testid="hub-subtab-panel-overview"
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: 'var(--kp-surface-gap) var(--kp-gutter) 0' }}>
              <BeforeYouMeetStrip matterId={matterId} />
            </div>
            {/* Client Map — flat & full-bleed (no card), matching the Ask
                surface: a calm section rail + a breathing reading column, with
                no box-in-a-box nesting. The in-hub Ask box was removed — Ask now
                lives in its own dedicated tab, so the Overview stays calm. */}
            <div
              data-testid="hub-panel-clientmap"
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              <div
                data-testid="hub-panel-clientmap-body"
                style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              >
                {/* Build states / local-only notice — only OFF the happy path.
                    Padded so they breathe under the tab bar. */}
                {(isLocalOnlyMode() ||
                  clientMap.status === 'idle' ||
                  clientMap.status === 'generating' ||
                  clientMap.status === 'empty' ||
                  clientMap.status === 'error') && (
                  <div style={{ padding: 'var(--kp-surface-gap) var(--kp-gutter) 0' }}>
                    {/* Local-only notice */}
                    {isLocalOnlyMode() && (
                      <div
                        data-testid="hub-clientmap-local-notice"
                        style={{
                          fontSize: 'var(--kp-font-xs)',
                          color: 'var(--color-muted-foreground)',
                          marginBottom: 6,
                        }}
                      >
                        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                        Running on-device only. Generation uses your local model.
                        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                      </div>
                    )}

                    {(clientMap.status === 'idle' || clientMap.status === 'generating') && (
                      <div
                        data-testid="hub-clientmap-loading"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          color: 'var(--color-muted-foreground)',
                          fontSize: 'var(--kp-font-xs)',
                        }}
                      >
                        <Loader2
                          className="animate-spin"
                          style={{
                            width: 'var(--kp-icon-sm)',
                            height: 'var(--kp-icon-sm)',
                            strokeWidth: 2,
                          }}
                        />
                        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                        Building client map...
                        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                      </div>
                    )}

                    {clientMap.status === 'empty' && (
                      <div
                        data-testid="hub-clientmap-empty"
                        style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                      >
                        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                        No information found yet. Add documents or email to this client first.
                        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                      </div>
                    )}

                    {clientMap.status === 'error' && (
                      <div
                        data-testid="hub-clientmap-error"
                        style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                      >
                        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                        {clientMap.errorMessage ?? 'Could not build client map. Check your AI connection and try again.'}
                        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                      </div>
                    )}
                  </div>
                )}

                {/* When ready: the approve-first updates tray (null when empty)
                    and the optional guided-interview panel. The interview BUTTON
                    now lives in the header (top-right). With no pending updates
                    and the interview closed this collapses to zero height, so the
                    section rail meets the tab bar — exactly like Ask. */}
                {clientMap.status === 'ready' && clientMap.map !== undefined && (
                  <div style={{ padding: '0 var(--kp-gutter)' }}>
                    <ClientMapUpdatesTray matterId={matterId} />
                    {showInterview && (
                      <div style={{ margin: 'var(--kp-surface-gap) 0 12px' }}>
                        <GuidedInterview
                          matterId={matterId}
                          onClose={() => { setShowInterview(false); }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Codex review catch: the Wealthbox write-back queue is
                    independent of Client Map readiness — a note sent from the
                    (always-available) shared notes editor must stay reachable
                    for approval/dismiss even while the map itself is empty,
                    still generating, or errored. The card is a no-op render
                    (returns null) when there's nothing queued. */}
                <div style={{ padding: '0 var(--kp-gutter)' }}>
                  <CrmWriteReviewCard matterId={matterId} />
                </div>

                {/* The flat, full-bleed Client Map panel absorbs the questions
                    list, the custom-section composer, and the templates list. */}
                {clientMap.status === 'ready' && clientMap.map !== undefined && (
                  <ClientMapPanel
                    map={clientMap.map}
                    onOpenSource={handleOpenSource}
                    onEditItem={handleEditItem}
                    onAnswerQuestion={(gap) => {
                      void (async () => {
                        const a = await prompt(`${LABEL_YOUR_ANSWER_PROMPT} ${gap.text}`, undefined, {
                          title: 'Your answer',
                          confirmLabel: 'Save',
                        });
                        if (a != null && a.trim() !== '') {
                          answerQuestion(matterId, gap.sectionKey, a.trim(), gap.text);
                        }
                      })();
                    }}
                    onFlagForClient={(gap) => { flagForClient(matterId, gap.text); }}
                    onStartInterview={() => { setShowInterview((v) => !v); }}
                    {...(onAuditLog ? { onAuditLog } : {})}
                  />
                )}
                {workspaceRoot != null && workspaceRoot !== '' && (
                  <div style={{ padding: '0 var(--kp-gutter)' }}>
                    <VoiceprintsCard matterId={matterId} workspaceRoot={workspaceRoot} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {subTab === 'documents' && (
          <div data-testid="hub-subtab-panel-documents" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderDocuments ? renderDocuments(matter) : <SubTabUnavailable label="Documents" />}
          </div>
        )}

        {subTab === 'email' && (
          <div data-testid="hub-subtab-panel-email" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderEmail ? renderEmail() : <SubTabUnavailable label="Email" />}
          </div>
        )}

        {subTab === 'meetings' && (
          <div data-testid="hub-subtab-panel-meetings" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {selectedMeeting ? (
              <MeetingEntry
                matterId={matterId}
                meetingDir={selectedMeeting.dir}
                folderName={selectedMeeting.folderName}
                clientName={headerTitle}
                workspaceRoot={workspaceRoot ?? ''}
                workspaceService={workspaceService ?? null}
                onBack={() => { setSelectedMeeting(null); }}
                {...(selectedMeeting.startMs !== undefined ? { initialSeekMs: selectedMeeting.startMs } : {})}
              />
            ) : (
              <ClientMeetingsTab
                matterId={matterId}
                matterFolder={matter.folderPaths[0] ?? ''}
                onOpenMeeting={(m) => { setSelectedMeeting({ dir: m.dir, folderName: m.folderName }); }}
                workspaceService={workspaceService ?? null}
              />
            )}
          </div>
        )}

        {subTab === 'activity' && (
          <div data-testid="hub-subtab-panel-activity" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderActivity ? renderActivity() : <SubTabUnavailable label="Activity" />}
          </div>
        )}
      </div>
      <PromptDialog {...promptDialogProps} />
    </div>
  );
}

// ── SubTabUnavailable ────────────────────────────────────────────────────────
// Fallback shown when a scoped surface isn't supplied (isolated component tests
// render MatterHub without the shell's render props). Never seen in the app.
function SubTabUnavailable({ label }: { label: string }) {
  return (
    <div
      data-testid="hub-subtab-unavailable"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-muted-foreground)',
        fontSize: 'var(--kp-font-sm)',
        fontFamily: 'Satoshi, sans-serif',
      }}
    >
      {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
      {label} isn’t available here.
    </div>
  );
}
