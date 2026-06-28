/**
 * MatterHub — per-matter command-center hub.
 *
 * Full-page overview for a single matter: header with back navigation, a
 * compact Ask hero with recent questions, a slim shortcut row to the relocated
 * surfaces (Documents, Email, Workflows, Activity), and the Client Map as the
 * hero view.
 *
 * Light theme only. Inline styles + CSS vars.
 */

import { useState, useEffect, useCallback } from 'react';
import { Briefcase, Lock, Sparkles, FileText, Mail, GitBranch, Clock, ArrowLeft, Loader2, Map } from 'lucide-react';
import { useMatters, useActiveMatterPrivileged, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { mailListMessages } from '@/platform/utils/mail-commands';
import { Button, SearchField, Chip, Badge, Eyebrow, Card } from '@/ui/kp';
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
import { dedupeFolderPathsForDisplay } from './matterManagerDialogHelpers';
import type { AuditEntry } from '@/platform/types/audit';

// ── Props ──────────────────────────────────────────────────────────────────

export interface MatterHubProps {
  matterId: string;
  onBack: () => void;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Labels ─────────────────────────────────────────────────────────────────

const LABEL_START_INTERVIEW = 'Start the guided interview';
const LABEL_YOUR_ANSWER_PROMPT = 'Your answer to:';
// newNav shortcut-row labels (the relocated surfaces, kept reachable).
const SHORTCUT_DOCUMENTS = 'Documents';
const SHORTCUT_EMAIL = 'Email';
const SHORTCUT_WORKFLOWS = 'Workflows';
const SHORTCUT_ACTIVITY = 'Activity';

// ── MatterHub ──────────────────────────────────────────────────────────────

export function MatterHub({ matterId, onBack, onAuditLog }: MatterHubProps) {
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
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  // ai chat sessions for recent questions
  const sessions = useAIChatStore((s: { sessions: Record<string, unknown> }) => s.sessions) as Record<string, { messages?: Array<{ role: string; content: string }> }>;

  const [askQ, setAskQ] = useState('');

  // ── This client's emails (for the Email panel preview) ─────────────────────
  // Connected mail is searchable globally and tagged to a matter for retrieval,
  // but there is no "list messages by matter" command yet, so we preview this
  // client's mail by matching the household name against the sender. Shows the
  // real connected emails instead of a misleading "no email folders connected".
  const [clientEmails, setClientEmails] = useState<Array<{ subject: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    const fullName = matter?.name ?? '';
    const firstPart = fullName.split(/[,&]/)[0] ?? fullName;
    const surname = firstPart.trim().toLowerCase();
    if (!surname) {
      // Defer the empty-state reset out of the effect body (no synchronous
      // setState in an effect — it can trigger cascading renders).
      void Promise.resolve().then(() => { if (!cancelled) setClientEmails([]); });
      return;
    }
    void mailListMessages({ sortBy: 'date', sortDesc: true, limit: 100, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        const mine = page.items.filter((m) =>
          `${m.fromName} ${m.fromAddr}`.toLowerCase().includes(surname),
        );
        setClientEmails(mine.map((m) => ({ subject: m.subject })));
      })
      .catch(() => { if (!cancelled) setClientEmails([]); });
    return () => { cancelled = true; };
  }, [matterId, matter?.name]);

  // Count sessions belonging to this matter (key starts with `ask-${matterId}`)
  const matterSessionPrefix = `ask-${matterId}`;
  const recentQuestions: string[] = Object.entries(sessions)
    .filter(([key]) => key.startsWith(matterSessionPrefix))
    .map(([, session]) => {
      const msgs = session.messages ?? [];
      const first = msgs.find((msg) => msg.role === 'user');
      return first?.content ?? '';
    })
    .filter(Boolean)
    .slice(0, 3);

  // Once a map exists, re-check for new source material. Covers BOTH a populated
  // map ('ready') AND one that was built empty ('empty') — the latter recovers a
  // map built before its content was indexed (e.g. a client opened before its
  // Wealthbox household synced): when the source fingerprint later changes,
  // checkForUpdates rebuilds and routes the new facts through the approve-first
  // tray. checkForUpdates no-ops when the fingerprint is unchanged, so an empty
  // matter with still no content costs nothing.
  useEffect(() => {
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
  const crmSyncStatus = useCrmStore((s) => s.progress?.status);
  useEffect(() => {
    if (crmSyncStatus === 'done') {
      void checkForUpdates();
    }
  }, [crmSyncStatus, checkForUpdates]);

  const dispatchLaunch = (surface: string) => {
    window.dispatchEvent(
      new CustomEvent('keepance:matter-launch', {
        detail: { matterId, surface },
      }),
    );
  };

  // ── Client Map handlers ──────────────────────────────────────────────────
  // The Client Map is the hero of the client-detail view — always expanded.
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

  const handleAskSubmit = () => {
    const q = askQ.trim();
    window.dispatchEvent(
      new CustomEvent('keepance:matter-launch', {
        detail: { matterId, surface: 'search', question: q },
      }),
    );
  };

  const handleAskKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleAskSubmit();
    }
  };

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
  const displayFolderPaths = dedupeFolderPathsForDisplay(matter.folderPaths, rootPath);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
      }}
    >
      {/* ── A. Header bar ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* Back button — sits above the standard header, not part of it */}
        <div style={{ paddingBottom: 12 }}>
          <Button
            type="button"
            data-testid="hub-back-btn"
            variant="link"
            size="sm"
            iconLeft={ArrowLeft}
            onClick={onBack}
          >
            {entityLabel.Other}
          </Button>
        </div>

        <SurfaceHeader
          Icon={Briefcase}
          title={label}
          description={
            <>
              {matter.client && <span>{matter.client}</span>}
              {matter.client && <span> · </span>}
              <span>Created {formatDate(matter.createdAt)}</span>
            </>
          }
          actions={
            (matter.isSample || isPrivileged || matter.privileged) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
            ) : undefined
          }
        />
      </div>

      {/* ── B. Ask hero ────────────────────────────────────────────────── */}
      <div
        style={{
          padding: 'var(--kp-surface-gap) var(--kp-gutter)',
          borderBottom: '1px solid var(--color-border)',
          background: 'rgba(10,37,64,0.02)',
        }}
      >
        {/* Compact Ask row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <SearchField
              data-testid="hub-ask-input"
              icon={Sparkles}
              size="md"
              value={askQ}
              onChange={(v: string) => { setAskQ(v); }}
              onClear={() => { setAskQ(''); }}
              placeholder={`Ask this ${entityLabel.one}...`}
              onKeyDown={handleAskKeyDown}
            />
          </div>
          <Button
            type="button"
            data-testid="hub-ask-submit"
            variant="primary"
            size="sm"
            onClick={handleAskSubmit}
          >
            Ask
          </Button>
        </div>

        {/* Recent questions */}
        {recentQuestions.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 'var(--kp-font-2xs)',
                color: 'var(--color-muted-foreground)',
                fontWeight: 'var(--kp-weight-semibold)',
                letterSpacing: '0.02em',
                flex: 'none',
              }}
            >
              { }
              Recent:
              { }
            </span>
            {recentQuestions.map((q, i) => (
              <Chip
                key={i}
                size="sm"
                data-testid={`hub-recent-q-${String(i)}`}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('keepance:matter-launch', {
                      detail: { matterId, surface: 'search', question: q },
                    }),
                  );
                }}
              >
                {q}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* A slim shortcut row keeps Documents / Email / Workflows / Activity one
          click away (capabilities relocated, not removed) without making them
          the primary view. The Client Map below is the hero. */}
      <div
        data-testid="hub-shortcut-row"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-sm)', padding: 'var(--kp-surface-gap) var(--kp-gutter) 0' }}
      >
          {([
            { id: 'files', label: SHORTCUT_DOCUMENTS, Icon: FileText, count: displayFolderPaths.length, testid: 'hub-shortcut-documents' },
            { id: 'email', label: SHORTCUT_EMAIL, Icon: Mail, count: clientEmails.length, testid: 'hub-shortcut-email' },
            { id: 'workflows', label: SHORTCUT_WORKFLOWS, Icon: GitBranch, count: null, testid: 'hub-shortcut-workflows' },
            { id: 'audit', label: SHORTCUT_ACTIVITY, Icon: Clock, count: null, testid: 'hub-shortcut-activity' },
          ] as { id: string; label: string; Icon: typeof FileText; count: number | null; testid: string }[]).map(({ id, label, Icon, count, testid }) => (
            <button
              key={id}
              type="button"
              data-testid={testid}
              onClick={() => { dispatchLaunch(id); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--kp-navy)', cursor: 'pointer', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-medium)' }}
            >
              <Icon style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
              <span>{label}</span>
              {count !== null && <span style={{ color: 'var(--color-muted-foreground)' }}>{count}</span>}
            </button>
          ))}
      </div>

      {/* ── E. Client Map ──────────────────────────────────────────────── */}
      <div
        data-testid="hub-panel-clientmap"
        style={{
          padding: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-section-gap)',
        }}
      >
        <Card variant="raised" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-stack-gap)' }}>
          {/* Header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Eyebrow style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Map style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
              Client Map
            </Eyebrow>
          </div>

          {/* Body — the Client Map is always expanded as the hero. */}
          <div data-testid="hub-panel-clientmap-body">
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

              {/* States */}
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

              {clientMap.status === 'ready' && clientMap.map !== undefined && (
                <>
                  {/* Approve-first updates tray — shown at the top so the marker is visible */}
                  <ClientMapUpdatesTray matterId={matterId} />

                  <div style={{ marginBottom: 8 }}>
                    <Button
                      type="button"
                      data-testid="clientmap-start-interview"
                      variant="secondary"
                      size="sm"
                      onClick={() => { setShowInterview((v) => !v); }}
                    >
                      {LABEL_START_INTERVIEW}
                    </Button>
                  </div>
                  {showInterview && (
                    <div style={{ marginBottom: 12 }}>
                      <GuidedInterview
                        matterId={matterId}
                        onClose={() => { setShowInterview(false); }}
                      />
                    </div>
                  )}
                  {/* The redesigned tabbed Client Map panel absorbs the
                      questions list, the custom-section composer, and the
                      templates list. */}
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
                </>
              )}
            </div>
        </Card>
      </div>
    </div>
  );
}
