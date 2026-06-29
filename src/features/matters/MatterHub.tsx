/**
 * MatterHub — per-matter command-center hub.
 *
 * Full-page workspace for a single client: a header with back navigation, a row
 * of sub-tabs (Overview · Documents · Email · Activity), and the matching panel
 * below. Overview leads with the Client Map (the hero) and a compact Ask box;
 * Documents / Email / Activity render THIS client's scoped surfaces in place,
 * so opening a file or reading mail never leaves the client (no orphaned global
 * destinations). The scoped surfaces are passed in as render props from the
 * shell, which owns their handler wiring.
 *
 * Light theme only. Inline styles + CSS vars.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Lock, FileText, Mail, Clock, Loader2, Map } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { useMatters, useActiveMatterPrivileged, useMatterStore, SAMPLE_MATTER_ID, type ClientMapHubTab } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { Button, Badge } from '@/ui/kp';
import SurfaceHeader from '@/ui/SurfaceHeader';
import { useClientMap } from '@/features/matters/useClientMap';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { ClientMapUpdatesTray } from '@/features/matters/ClientMapUpdatesTray';
import { isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { useCrmStore } from '@/features/crm/crmStore';
import { answerQuestion, flagForClient } from '@/platform/clientMap/guidedInterview';
import { dispatchOpenSource } from '@/platform/clientMap/openSource';
import type { SourceRef } from '@/platform/clientMap/types';
import type { AuditEntry } from '@/platform/types/audit';

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
   */
  renderDocuments?: () => ReactNode;
  renderEmail?: () => ReactNode;
  renderActivity?: () => ReactNode;
}

// ── Sub-tabs ───────────────────────────────────────────────────────────────

type HubTab = ClientMapHubTab;

const HUB_TABS: { id: HubTab; label: string; Icon: typeof FileText }[] = [
  { id: 'overview', label: 'Overview', Icon: Map },
  { id: 'documents', label: 'Documents', Icon: FileText },
  { id: 'email', label: 'Email', Icon: Mail },
  { id: 'activity', label: 'Activity', Icon: Clock },
];

// ── Labels ─────────────────────────────────────────────────────────────────

const LABEL_START_INTERVIEW = 'Start the guided interview';
const LABEL_YOUR_ANSWER_PROMPT = 'Your answer to:';

// ── MatterHub ──────────────────────────────────────────────────────────────

export function MatterHub({ matterId, onBack, onAuditLog, renderDocuments, renderEmail, renderActivity }: MatterHubProps) {
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
  const matters = useMatters();
  const matter = matters.find((m) => m.id === matterId) ?? null;
  const isPrivileged = useActiveMatterPrivileged();
  const entityLabel = useEntityLabel();

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

  // Open the EXACT cited source (the specific document, scrolled to the cited
  // spot, or the specific email), not just the general Documents/Email surface.
  const handleOpenSource = useCallback((ref: SourceRef) => {
    dispatchOpenSource(matterId, ref);
  }, [matterId]);

  const handleEditItem = useCallback((sectionKey: string, itemId: string) => {
    // BUG-105: prefill the prompt with the item's current text so the user can
    // tweak it instead of retyping the whole thing from a blank box.
    const current = useClientMapStore.getState().getMap(matterId);
    const existingText =
      current?.sections.find((sec) => sec.key === sectionKey)?.items.find((it) => it.id === itemId)?.text ?? '';
    const text = window.prompt('Edit item:', existingText);
    if (text !== null && text.trim() !== '') {
      useClientMapStore.getState().editItem(matterId, sectionKey, itemId, text.trim());
    }
  }, [matterId]);

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
  // the left nav carry the "this is the Client Map" context.
  const headerTitle = matter.client && matter.client.trim() !== '' ? matter.client : label;

  // A genuinely useful one-liner in place of the redundant name/created line:
  // a glanceable status — how much open work + anything to ask. Falls back to
  // "Up to date" when there's nothing outstanding; omitted until the map exists.
  const cmMap = clientMap.map;
  let headerSummary: string | undefined;
  if (cmMap) {
    const followUps = cmMap.sections.find((s) => s.key === 'next')?.items.length ?? 0;
    const openQuestions = cmMap.completeness.ask.length;
    const parts: string[] = [];
    if (followUps > 0) parts.push(`${String(followUps)} follow-up${followUps === 1 ? '' : 's'} open`);
    if (openQuestions > 0) parts.push(`${String(openQuestions)} ${openQuestions === 1 ? 'question' : 'questions'} to ask`);
    headerSummary = parts.length > 0 ? parts.join(' · ') : 'Up to date';
  }

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
      {/* ── A. Header bar ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--kp-divider)',
          flexShrink: 0,
        }}
      >
        {/* Reads exactly like Ask: [colored icon] + [name] + light subtitle. No
            floating breadcrumb — back navigation is the left Client Map nav /
            CLIENTS list. The icon is the Client-Map (map) icon in brand blue. */}
        <SurfaceHeader
          Icon={Map}
          iconColor="var(--kp-accent)"
          title={headerTitle}
          {...(headerSummary !== undefined ? { description: headerSummary } : {})}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Guided-interview lives here, top-right, so it never breaks
                  the flat reading column below. */}
              {subTab === 'overview' && clientMap.status === 'ready' && (
                <Button
                  type="button"
                  data-testid="clientmap-start-interview"
                  variant="secondary"
                  size="sm"
                  onClick={() => { setShowInterview((v) => !v); }}
                >
                  {LABEL_START_INTERVIEW}
                </Button>
              )}
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
            </div>
          }
        />
      </div>

      {/* ── B. Sub-tab bar ─────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Client sections"
        data-testid="hub-subtab-bar"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 2,
          padding: '0 var(--kp-gutter)',
          borderBottom: '1px solid var(--kp-divider)',
          background: 'var(--color-background)',
          flexShrink: 0,
        }}
      >
        {HUB_TABS.map(({ id, label: tabLabel, Icon }) => {
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
                gap: 6,
                padding: '10px 14px',
                border: 'none',
                borderBottom: active ? '2px solid var(--kp-navy)' : '2px solid transparent',
                background: active ? 'rgba(10,37,64,0.04)' : 'transparent',
                color: active ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                fontWeight: active ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
                fontSize: 'var(--kp-font-sm)',
                fontFamily: 'inherit',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              <Icon style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
              <span>{tabLabel}</span>
            </button>
          );
        })}
      </div>

      {/* ── C. Active panel ────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {subTab === 'overview' && (
          <div
            data-testid="hub-subtab-panel-overview"
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
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
                        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                        Running on-device only. Generation uses your local model.
                        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
                        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                        Building client map...
                        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                      </div>
                    )}

                    {clientMap.status === 'empty' && (
                      <div
                        data-testid="hub-clientmap-empty"
                        style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                      >
                        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                        No information found yet. Add documents or email to this client first.
                        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                      </div>
                    )}

                    {clientMap.status === 'error' && (
                      <div
                        data-testid="hub-clientmap-error"
                        style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                      >
                        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                        {clientMap.errorMessage ?? 'Could not build client map. Check your AI connection and try again.'}
                        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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

                {/* The flat, full-bleed Client Map panel absorbs the questions
                    list, the custom-section composer, and the templates list. */}
                {clientMap.status === 'ready' && clientMap.map !== undefined && (
                  <ClientMapPanel
                    map={clientMap.map}
                    onOpenSource={handleOpenSource}
                    onEditItem={handleEditItem}
                    onAnswerQuestion={(gap) => {
                      const a = window.prompt(`${LABEL_YOUR_ANSWER_PROMPT} ${gap.text}`);
                      if (a != null && a.trim() !== '') {
                        answerQuestion(matterId, gap.sectionKey, a.trim(), gap.text);
                      }
                    }}
                    onFlagForClient={(gap) => { flagForClient(matterId, gap.text); }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {subTab === 'documents' && (
          <div data-testid="hub-subtab-panel-documents" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderDocuments ? renderDocuments() : <SubTabUnavailable label="Documents" />}
          </div>
        )}

        {subTab === 'email' && (
          <div data-testid="hub-subtab-panel-email" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderEmail ? renderEmail() : <SubTabUnavailable label="Email" />}
          </div>
        )}

        {subTab === 'activity' && (
          <div data-testid="hub-subtab-panel-activity" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderActivity ? renderActivity() : <SubTabUnavailable label="Activity" />}
          </div>
        )}
      </div>
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
      {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
      {label} isn’t available here.
    </div>
  );
}
