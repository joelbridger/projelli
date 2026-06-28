/**
 * MatterHub — per-matter command-center hub.
 *
 * Full-page overview for a single matter: header with back navigation,
 * compact Ask hero with recent questions, at-a-glance summary, and four
 * panel cards (Documents, Email, Workflows, Activity).
 *
 * Light theme only. Inline styles + CSS vars.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Briefcase, Lock, ChevronRight, Sparkles, FileText, Mail, GitBranch, Clock, ArrowLeft, RefreshCw, Loader2, Map } from 'lucide-react';
import { useMatters, useActiveMatterPrivileged, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterAtAGlanceStore } from '@/platform/matter/matterAtAGlanceStore';
import {
  deriveMatterHubUpcomingItems,
  generateMatterAtAGlance,
  hasCloudKeyForGlance,
  normalizeMatterAtAGlanceResult,
} from '@/platform/matter/matterAtAGlance';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { mailListMessages } from '@/platform/utils/mail-commands';
import type { MatterAtAGlanceResult } from '@/platform/matter/matterAtAGlance';
import { Button, IconButton, SearchField, Chip, Badge, Eyebrow, Card } from '@/ui/kp';
import SurfaceHeader from '@/ui/SurfaceHeader';
import { useClientMap } from '@/features/matters/useClientMap';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { useNewNav } from '@/platform/flags/newNav';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { ClientQuestionsList } from '@/features/matters/ClientQuestionsList';
import { ClientMapUpdatesTray } from '@/features/matters/ClientMapUpdatesTray';
import { AddCustomSectionForm } from '@/features/matters/AddCustomSectionForm';
import { ClientMapTemplates } from '@/features/matters/ClientMapTemplates';
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

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

function hasUpcomingDates(result: MatterAtAGlanceResult | null): boolean {
  return deriveMatterHubUpcomingItems(result).length > 0;
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
  const newNav = useNewNav();
  const matter = matters.find((m) => m.id === matterId) ?? null;
  const isPrivileged = useActiveMatterPrivileged();
  const entityLabel = useEntityLabel();
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  // ai chat sessions for recent questions
  const sessions = useAIChatStore((s: { sessions: Record<string, unknown> }) => s.sessions) as Record<string, { messages?: Array<{ role: string; content: string }> }>;

  const [askQ, setAskQ] = useState('');

  // ── AI at-a-glance state ───────────────────────────────────────────────
  const glanceStore = useMatterAtAGlanceStore();
  type GlanceStatus = 'idle' | 'generating' | 'done' | 'empty' | 'no-key' | 'error';
  const [glanceStatus, setGlanceStatus] = useState<GlanceStatus>('idle');
  const [glanceResult, setGlanceResult] = useState<MatterAtAGlanceResult | null>(null);
  const glanceAbortRef = useRef<AbortController | null>(null);

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

  // ── AI at-a-glance: generation + cache wiring ──────────────────────────
  const runGlanceGeneration = useCallback(async (mid: string, signal: AbortSignal) => {
    setGlanceStatus('generating');
    try {
      const result = await generateMatterAtAGlance(
        mid,
        onAuditLog ? { signal, onAuditLog } : { signal },
      );
      if (signal.aborted) return;
      const cleanResult = normalizeMatterAtAGlanceResult(result);
      glanceStore.setEntry(mid, cleanResult);
      const isEmpty =
        cleanResult.openIssues.length === 0 &&
        cleanResult.deadlines.length === 0 &&
        !hasUpcomingDates(cleanResult) &&
        cleanResult.nextActions.length === 0;
      setGlanceResult(cleanResult);
      setGlanceStatus(isEmpty ? 'empty' : 'done');
    } catch {
      if (signal.aborted) return;
      setGlanceStatus('error');
    }
  }, [glanceStore, onAuditLog]);

  // On mount / matterId change: load from cache or trigger generation.
  // Guards: sample matter is always skipped; no cloud key = 'no-key'; memory
  // disabled or no indexed content returns empty (handled inside generator).
  useEffect(() => {
    const isSampleMatter = matterId === SAMPLE_MATTER_ID;
    if (isSampleMatter) return;

    const abort = new AbortController();
    glanceAbortRef.current = abort;

    (async () => {
      const hasKey = await hasCloudKeyForGlance();
      if (abort.signal.aborted) return;
      // A cloud key is only required when NOT in Local-only mode. In private mode
      // the glance runs on the embedded Keepance Local AI (or Ollama) — same
      // local-completeness fix as Workflows/Email/Client Map — so a cloud-keyless
      // private-mode user with the embedded model still gets an AI at-a-glance
      // instead of being told to "add a key" (Codex). Memory is always required.
      if ((!isLocalOnlyMode() && !hasKey) || !isMemoryEnabled()) {
        setGlanceStatus('no-key');
        return;
      }

      // Try cache first.
      const cached = glanceStore.getEntry(matterId);
      if (cached) {
        const cleanResult = normalizeMatterAtAGlanceResult(cached.result);
        setGlanceResult(cleanResult);
        const isEmpty =
          cleanResult.openIssues.length === 0 &&
          cleanResult.deadlines.length === 0 &&
          !hasUpcomingDates(cleanResult) &&
          cleanResult.nextActions.length === 0;
        setGlanceStatus(isEmpty ? 'empty' : 'done');
        return;
      }

      await runGlanceGeneration(matterId, abort.signal);
    })().catch(() => {
      setGlanceStatus('error');
    });

    return () => {
      abort.abort();
    };
  }, [matterId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleGlanceRefresh = useCallback(() => {
    glanceAbortRef.current?.abort();
    glanceStore.invalidate(matterId);
    setGlanceResult(null);
    setGlanceStatus('idle');

    const abort = new AbortController();
    glanceAbortRef.current = abort;
    runGlanceGeneration(matterId, abort.signal).catch(() => {
      setGlanceStatus('error');
    });
  }, [matterId, glanceStore, runGlanceGeneration]);

  const dispatchLaunch = (surface: string) => {
    window.dispatchEvent(
      new CustomEvent('keepance:matter-launch', {
        detail: { matterId, surface },
      }),
    );
  };

  // ── Client Map handlers ──────────────────────────────────────────────────
  // newNav makes the Client Map the hero of the client-detail view, so it opens
  // expanded (no "Open Client Map" step); the legacy hub keeps it collapsed.
  const [showClientMap, setShowClientMap] = useState(newNav);
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
  const isSample = matterId === SAMPLE_MATTER_ID;
  const displayFolderPaths = dedupeFolderPathsForDisplay(matter.folderPaths, rootPath);
  const hubUpcomingItems = deriveMatterHubUpcomingItems(glanceResult, clientMap.map);

  // ── Styles ────────────────────────────────────────────────────────────

  const panelHeader: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  };

  const panelPreview: React.CSSProperties = {
    fontSize: 'var(--kp-font-xs)',
    color: 'var(--color-muted-foreground)',
    lineHeight: 'var(--kp-leading-relaxed)',
  };

  const panelCount: React.CSSProperties = {
    fontSize: 'var(--kp-font-2xs)',
    fontWeight: 'var(--kp-weight-semibold)',
    color: 'var(--color-muted-foreground)',
    marginLeft: 'auto',
    marginRight: 4,
  };

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
              placeholder={newNav ? `Ask this ${entityLabel.one}...` : `Search this ${entityLabel.one}...`}
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
            {newNav ? 'Ask' : 'Search'}
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

      {/* Legacy hub only: the At-a-Glance grid + the four-panel (Documents /
          Email / Workflows / Activity) grid. newNav hides BOTH and leads with
          the Client Map as the hero; those capabilities stay reachable via the
          slim shortcut row below + the gear menu — relocated, never removed. */}
      {!newNav && (
      <>
      {/* ── C. At a Glance ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--kp-stack-gap)',
          padding: 'var(--kp-surface-gap) var(--kp-gutter)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* Left: At a Glance */}
        <Card variant="raised">
          <div style={{ marginBottom: 8 }}>
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            <Eyebrow>At a Glance</Eyebrow>
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </div>

          {isSample ? (
            <div data-testid="hub-sample-glance" style={{ fontSize: 'var(--kp-font-sm)', lineHeight: 'var(--kp-leading-relaxed)' }}>
              <div style={{ color: 'var(--color-foreground)' }}>
                <strong>6</strong>
                { }
                {' open issues'}
                { }
              </div>
              <div style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', marginTop: 2 }}>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                HVAC habitability - lease amendment needed - damages calculation in progress
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
              <div style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', marginTop: 4 }}>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                Fee: $350/hr, $3,000 retainer deposited
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
            </div>
          ) : glanceStatus === 'no-key' ? (
            /* No cloud key: honest counts / recent-activity fallback */
            <div data-testid="hub-real-glance" style={{ fontSize: 'var(--kp-font-sm)', lineHeight: 'var(--kp-leading-relaxed)', color: 'var(--color-foreground)' }}>
              {(() => {
                const folderCount = displayFolderPaths.length;
                const questionCount = Object.keys(sessions)
                  .filter((k) => k.startsWith(matterSessionPrefix))
                  .filter((k) => {
                    const sess = sessions[k] as { messages?: Array<{ role: string }> } | undefined;
                    return (sess?.messages ?? []).some((m) => m.role === 'user');
                  }).length;

                if (folderCount === 0 && questionCount === 0) {
                  return (
                    <span style={{ color: 'var(--color-muted-foreground)' }}>
                      {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                      Add documents, connect email, or ask a question to get started.
                      {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                    </span>
                  );
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {folderCount > 0 && (
                      <div>
                        <strong>{String(folderCount)}</strong>
                        { }
                        {folderCount === 1 ? ' folder indexed' : ' folders indexed'}
                        { }
                      </div>
                    )}
                    {questionCount > 0 && (
                      <div style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                        <strong>{String(questionCount)}</strong>
                        { }
                        {questionCount === 1 ? ' question asked' : ' questions asked'}
                        { }
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            /* Real matter + cloud key: AI at-a-glance (loading / done / empty / error) */
            <div data-testid="hub-ai-glance" style={{ fontSize: 'var(--kp-font-sm)', lineHeight: 'var(--kp-leading-relaxed)' }}>
              {/* Header row: "Generated by AI" tag + Refresh button */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span data-testid="hub-ai-glance-tag">
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  <Badge variant="neutral" size="sm" icon={Sparkles} uppercase>Generated by AI</Badge>
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </span>
                {(glanceStatus === 'done' || glanceStatus === 'empty' || glanceStatus === 'error') && (
                  <IconButton
                    icon={RefreshCw}
                    label="Refresh"
                    variant="ghost"
                    size="xs"
                    data-testid="hub-ai-glance-refresh"
                    onClick={handleGlanceRefresh}
                  />
                )}
              </div>

              {/* Content by status */}
              {(glanceStatus === 'idle' || glanceStatus === 'generating') && (
                <div
                  data-testid="hub-ai-glance-loading"
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
                  Analyzing your documents...
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
              )}

              {glanceStatus === 'done' && glanceResult !== null && (
                <div
                  data-testid="hub-ai-glance-result"
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {glanceResult.openIssues.length > 0 && (
                    <div>
                      <div style={{ marginBottom: 2 }}>
                        <Eyebrow>Open Issues</Eyebrow>
                      </div>
                      {glanceResult.openIssues.map((issue, i) => (
                        <div key={i} style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-foreground)', lineHeight: 'var(--kp-leading-snug)' }}>
                          {issue}
                        </div>
                      ))}
                    </div>
                  )}
                  {glanceResult.deadlines.length > 0 && (
                    <div>
                      <div style={{ marginBottom: 2 }}>
                        <Eyebrow>Key Dates</Eyebrow>
                      </div>
                      {glanceResult.deadlines.map((d, i) => (
                        <div key={i} style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-foreground)', lineHeight: 'var(--kp-leading-snug)' }}>
                          {d}
                        </div>
                      ))}
                    </div>
                  )}
                  {glanceResult.nextActions.length > 0 && (
                    <div>
                      <div style={{ marginBottom: 2 }}>
                        <Eyebrow>Next Actions</Eyebrow>
                      </div>
                      {glanceResult.nextActions.map((a, i) => (
                        <div key={i} style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-foreground)', lineHeight: 'var(--kp-leading-snug)' }}>
                          {a}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {glanceStatus === 'empty' && (
                <div
                  data-testid="hub-ai-glance-empty"
                  style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                >
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Nothing notable yet. Add documents or ask a question.
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
              )}

              {glanceStatus === 'error' && (
                <div
                  data-testid="hub-ai-glance-error"
                  style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                >
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Could not generate a summary. Try refreshing.
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Right: Upcoming / Activity */}
        <Card variant="raised">
          <div style={{ marginBottom: 8 }}>
            <Eyebrow>Upcoming / Activity</Eyebrow>
          </div>

          <div data-testid="hub-activity" style={{ fontSize: 'var(--kp-font-sm)', lineHeight: 'var(--kp-leading-relaxed)' }}>
            {isSample ? (
              <>
                <div style={{ color: 'var(--color-foreground)' }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Deadline: Lease copy from client (end of week)
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
                <div style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', marginTop: 4 }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Certified mail responses sent (May 25)
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--color-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                  {entityLabel.One} created {formatDate(matter.createdAt)}
                </span>
                {hubUpcomingItems.length > 0 ? (
                  <div data-testid="hub-upcoming-dates" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {hubUpcomingItems.map((item, i) => (
                      <span key={i} style={{ color: 'var(--color-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : glanceStatus === 'idle' || glanceStatus === 'generating' ? (
                  <span style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                    {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                    Looking for upcoming dates...
                    {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                    {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                    No upcoming deadlines yet. Ask the AI to find any in your documents.
                    {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                  </span>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── D. Four panels ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--kp-stack-gap)',
          padding: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-section-gap)',
        }}
      >
        {/* Documents */}
        <Card variant="raised" data-testid="hub-panel-documents" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-stack-gap)' }}>
          <div style={panelHeader}>
            <Eyebrow style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
              Documents
            </Eyebrow>
            <span style={panelCount}>
              ({String(displayFolderPaths.length)})
            </span>
            <IconButton
              icon={ChevronRight}
              label="Open Documents"
              variant="ghost"
              size="sm"
              data-testid="hub-panel-documents-open"
              onClick={() => { dispatchLaunch('files'); }}
            />
          </div>
          <div style={panelPreview}>
            {displayFolderPaths.length === 0 ? (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>No folders added yet</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            ) : (
              displayFolderPaths.slice(0, 2).map((p, i) => (
                <div key={i}>{basename(p)}</div>
              ))
            )}
          </div>
        </Card>

        {/* Email */}
        <Card variant="raised" data-testid="hub-panel-email" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-stack-gap)' }}>
          <div style={panelHeader}>
            <Eyebrow style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Mail style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
              Email
            </Eyebrow>
            <span style={panelCount}>
              ({String(clientEmails.length)})
            </span>
            <IconButton
              icon={ChevronRight}
              label="Open Email"
              variant="ghost"
              size="sm"
              data-testid="hub-panel-email-open"
              onClick={() => { dispatchLaunch('email'); }}
            />
          </div>
          <div style={panelPreview}>
            {clientEmails.length === 0 ? (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>No emails for this client yet</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            ) : (
              clientEmails.slice(0, 2).map((m, i) => (
                <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</div>
              ))
            )}
          </div>
        </Card>

        {/* Workflows */}
        <Card variant="raised" data-testid="hub-panel-workflows" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-stack-gap)' }}>
          <div style={panelHeader}>
            <Eyebrow style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <GitBranch style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
              Workflows
            </Eyebrow>
            <IconButton
              icon={ChevronRight}
              label="Open Workflows"
              variant="ghost"
              size="sm"
              data-testid="hub-panel-workflows-open"
              onClick={() => { dispatchLaunch('workflows'); }}
            />
          </div>
          <div style={panelPreview}>
            {isSample ? (
              <span>2 workflows available</span>
            ) : (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>Run a workflow on this {entityLabel.one}</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            )}
          </div>
        </Card>

        {/* Activity */}
        <Card variant="raised" data-testid="hub-panel-activity" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-stack-gap)' }}>
          <div style={panelHeader}>
            <Eyebrow style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
              Activity
            </Eyebrow>
            <IconButton
              icon={ChevronRight}
              label="Open Activity"
              variant="ghost"
              size="sm"
              data-testid="hub-panel-activity-open"
              onClick={() => { dispatchLaunch('audit'); }}
            />
          </div>
          <div style={panelPreview}>
            {isSample ? (
              <span>{entityLabel.One} opened Apr 3, 2026</span>
            ) : (
              <span>{entityLabel.One} created {formatDate(matter.createdAt)}</span>
            )}
          </div>
        </Card>
      </div>
      </>
      )}

      {/* newNav: a slim shortcut row keeps Documents / Email / Workflows /
          Activity one click away (capabilities relocated, not removed) without
          making them the primary view. The Client Map below is the hero. */}
      {newNav && (
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
      )}

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
            {/* newNav keeps the Client Map permanently expanded as the hero, so
                the collapse toggle is only shown on the legacy hub. */}
            {!newNav && (
              <IconButton
                icon={ChevronRight}
                label="Open Client Map"
                variant="ghost"
                size="sm"
                data-testid="hub-panel-clientmap-open"
                onClick={() => {
                  if (!showClientMap && clientMap.status === 'idle') {
                    void clientMap.generate();
                  }
                  setShowClientMap((v) => !v);
                }}
              />
            )}
          </div>

          {/* Body — only shown when expanded */}
          {showClientMap && (
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
                  {clientMap.errorMessage ?? 'Could not build client map. Check your AI connection and try again.'}
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
                  {newNav ? (
                    // newNav: the redesigned tabbed Client Map panel absorbs the
                    // questions list, the custom-section composer, and the
                    // templates list — so they are NOT rendered separately here.
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
                  ) : (
                    <>
                      <ClientMapView
                        map={clientMap.map}
                        onOpenSource={handleOpenSource}
                        onEditItem={handleEditItem}
                        onAnswerQuestion={(gap) => {
                          const a = window.prompt(`${LABEL_YOUR_ANSWER_PROMPT} ${gap.text}`);
                          if (a != null && a.trim() !== '') {
                            // File the answer in the section this gap question came from,
                            // and mark the gap resolved so it stops being asked (BUG-106).
                            answerQuestion(matterId, gap.sectionKey, a.trim(), gap.text);
                          }
                        }}
                        onFlagForClient={(gap) => { flagForClient(matterId, gap.text); }}
                      />
                      <div style={{ marginTop: 12 }}>
                        <ClientQuestionsList matterId={matterId} />
                      </div>

                      {/* Add a custom section */}
                      <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                        <AddCustomSectionForm matterId={matterId} />
                      </div>

                      {/* Save / apply templates */}
                      <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                        <ClientMapTemplates matterId={matterId} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
