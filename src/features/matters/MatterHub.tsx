/**
 * MatterHub — per-matter command-center hub.
 *
 * Full-page overview for a single matter. The Client Map is the centerpiece:
 * a slim AI headline sits at the top, the auto-built Client Map fills the
 * middle, and Documents / Email / Workflows / Activity are demoted to a slim
 * shortcut row beneath it.
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
import type { MatterAtAGlanceResult } from '@/platform/matter/matterAtAGlance';
import { Button, IconButton, SearchField, Chip, Badge, Eyebrow } from '@/ui/kp';
import SurfaceHeader from '@/ui/SurfaceHeader';
import { useClientMap } from '@/features/matters/useClientMap';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { ClientMapUpdatesTray } from '@/features/matters/ClientMapUpdatesTray';
import { isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
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

function hasUpcomingDates(result: MatterAtAGlanceResult | null): boolean {
  return deriveMatterHubUpcomingItems(result).length > 0;
}

// ── Labels ─────────────────────────────────────────────────────────────────

const LABEL_YOUR_ANSWER_PROMPT = 'Your answer to:';

// ── MatterHub ──────────────────────────────────────────────────────────────

export function MatterHub({ matterId, onBack, onAuditLog }: MatterHubProps) {
  // ── Client Map wiring ────────────────────────────────────────────────────
  // Declare client map hook at component top — must not be inside a condition.
  const clientMap = useClientMap(
    matterId,
    onAuditLog ? { onAuditLog } : undefined,
  );
  const { checkForUpdates } = clientMap;
  const matters = useMatters();
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
      if (!hasKey || !isMemoryEnabled()) {
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

  // When the Client Map becomes ready, check for updates from new source material.
  useEffect(() => {
    if (clientMap.status === 'ready') {
      void checkForUpdates();
    }
  }, [clientMap.status, checkForUpdates]);

  // The Client Map is the centerpiece of this screen, so build it automatically
  // on open (when nothing is cached yet) instead of waiting for a click.
  useEffect(() => {
    if (clientMap.status === 'idle') {
      void clientMap.generate();
    }
  }, [clientMap.status]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Slim headline (the TL;DR) ────────────────────────────────────────────
  // Prefer the AI at-a-glance when we have it; otherwise distill the single most
  // important line from the Client Map itself (where things stand + next action)
  // so the headline is populated even without a cloud key.
  const standingItems = clientMap.map?.sections.find((s) => s.key === 'standing')?.items ?? [];
  const nextItems = clientMap.map?.sections.find((s) => s.key === 'next')?.items ?? [];
  const glanceHeadline =
    glanceStatus === 'done' && glanceResult !== null
      ? [
          glanceResult.openIssues.length > 0
            ? `${String(glanceResult.openIssues.length)} open issue${glanceResult.openIssues.length === 1 ? '' : 's'}`
            : null,
          glanceResult.deadlines[0] ?? null,
          glanceResult.nextActions[0] != null ? `Next: ${glanceResult.nextActions[0]}` : null,
        ].filter(Boolean).join('  ·  ')
      : '';
  const mapHeadline = [
    standingItems[0]?.text ?? null,
    nextItems[0]?.text != null ? `Next: ${nextItems[0]?.text}` : null,
  ].filter(Boolean).join('  ·  ');
  const headlineText = glanceHeadline || mapHeadline;

  // ── Shortcut links (was the four panel cards) ────────────────────────────
  const shortcuts: { id: string; Icon: typeof FileText; label: string; count: number | null; surface: string }[] = [
    { id: 'documents', Icon: FileText, label: 'Documents', count: displayFolderPaths.length, surface: 'files' },
    { id: 'email', Icon: Mail, label: 'Email', count: (matter.mailFolderPaths ?? []).length, surface: 'email' },
    { id: 'workflows', Icon: GitBranch, label: 'Workflows', count: null, surface: 'workflows' },
    { id: 'activity', Icon: Clock, label: 'Activity', count: null, surface: 'audit' },
  ];

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
              placeholder={`Search this ${entityLabel.one}...`}
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
            Search
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

      {/* ── C. Slim headline (the TL;DR; replaces the big At-a-Glance cards) ── */}
      <div
        data-testid="hub-glance-headline"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 'var(--kp-surface-gap) var(--kp-gutter)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Sparkles style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--kp-blue)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--kp-font-sm)', color: 'var(--color-foreground)', lineHeight: 'var(--kp-leading-snug)' }}>
          {clientMap.status === 'generating' || (clientMap.status === 'idle' && headlineText === '') ? (
            <span style={{ color: 'var(--color-muted-foreground)' }}>Reading this {entityLabel.one}…</span>
          ) : headlineText !== '' ? (
            <span>{headlineText}</span>
          ) : (
            <span style={{ color: 'var(--color-muted-foreground)' }}>Add documents, connect email, or ask a question to get started.</span>
          )}
        </div>
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

      {/* ── D. Client Map — the centerpiece, auto-built + always expanded ── */}
      <div
        data-testid="hub-panel-clientmap"
        style={{
          padding: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-section-gap)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--kp-stack-gap)' }}>
          <Map style={{ width: 'var(--kp-icon-md)', height: 'var(--kp-icon-md)', strokeWidth: 2, color: 'var(--kp-navy)', flex: 'none' }} />
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <Eyebrow style={{ fontSize: 'var(--kp-font-md)' }}>Client Map</Eyebrow>
          {clientMap.status === 'ready' && (
            /* eslint-disable-next-line keepance-i18n/no-hardcoded-string */
            <Badge variant="neutral" size="sm" icon={Sparkles} uppercase>Auto-built</Badge>
          )}
          <div style={{ flex: 1 }} />
          {clientMap.status === 'ready' && (
            <Button
              type="button"
              data-testid="clientmap-start-interview"
              variant="secondary"
              size="sm"
              onClick={() => { setShowInterview((v) => !v); }}
            >
              {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
              Fill in gaps
            </Button>
          )}
        </div>

        {/* Local-only notice */}
        {isLocalOnlyMode() && (
          <div
            data-testid="hub-clientmap-local-notice"
            style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', marginBottom: 8 }}
          >
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
            Running on-device only. Generation uses your local model.
          </div>
        )}

        {(clientMap.status === 'idle' || clientMap.status === 'generating') && (
          <div
            data-testid="hub-clientmap-loading"
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}
          >
            <Loader2 className="animate-spin" style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
            Building client map…
          </div>
        )}

        {clientMap.status === 'empty' && (
          <div data-testid="hub-clientmap-empty" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
            No information found yet. Add documents or email to this {entityLabel.one} first.
          </div>
        )}

        {clientMap.status === 'error' && (
          <div data-testid="hub-clientmap-error" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
            Could not build client map. Check your AI connection and try again.
          </div>
        )}

        {clientMap.status === 'ready' && clientMap.map !== undefined && (
          <div data-testid="hub-panel-clientmap-body">
            {/* Approve-first updates tray — shown at the top so the marker is visible */}
            <ClientMapUpdatesTray matterId={matterId} />

            {showInterview && (
              <div style={{ marginBottom: 12 }}>
                <GuidedInterview
                  matterId={matterId}
                  onClose={() => { setShowInterview(false); }}
                />
              </div>
            )}

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
          </div>
        )}
      </div>

      {/* ── E. Shortcut links (was the four panel cards) ───────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--kp-stack-gap)',
          padding: '0 var(--kp-gutter) var(--kp-section-gap)',
        }}
      >
        {shortcuts.map(({ id, Icon, label: shortcutLabel, count, surface }) => (
          <button
            key={id}
            type="button"
            data-testid={`hub-panel-${id}-open`}
            onClick={() => { dispatchLaunch(surface); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: '#fff',
              color: 'var(--kp-navy)',
              cursor: 'pointer',
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 'var(--kp-weight-semibold)',
              fontFamily: 'Satoshi, sans-serif',
            }}
          >
            <Icon style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, flex: 'none' }} />
            <span>{shortcutLabel}</span>
            {count !== null && (
              <span style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--color-muted-foreground)' }}>
                {count}
              </span>
            )}
            <ChevronRight style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, color: 'var(--color-muted-foreground)', flex: 'none' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
