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
import { Briefcase, Lock, ChevronRight, Sparkles, FileText, Mail, GitBranch, Clock, ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { useMatters, useActiveMatterPrivileged, SAMPLE_MATTER_ID } from '@/stores/matterStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { useEntityLabel } from '@/hooks/useEntityLabel';
import { useMatterAtAGlanceStore } from '@/stores/matterAtAGlanceStore';
import {
  generateMatterAtAGlance,
  hasCloudKeyForGlance,
} from '@/features/matters/logic/matterAtAGlance';
import { isMemoryEnabled } from '@/modules/memory/MemoryService';
import type { MatterAtAGlanceResult } from '@/features/matters/logic/matterAtAGlance';
import { Button, IconButton, SearchField, Chip, Badge, Eyebrow, Card } from '@/ui/kp';
import SurfaceHeader from '@/components/layout/SurfaceHeader';

// ── Props ──────────────────────────────────────────────────────────────────

export interface MatterHubProps {
  matterId: string;
  onBack: () => void;
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

// ── MatterHub ──────────────────────────────────────────────────────────────

export function MatterHub({ matterId, onBack }: MatterHubProps) {
  const matters = useMatters();
  const matter = matters.find((m) => m.id === matterId) ?? null;
  const isPrivileged = useActiveMatterPrivileged();
  const entityLabel = useEntityLabel();

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
      const result = await generateMatterAtAGlance(mid, { signal });
      if (signal.aborted) return;
      glanceStore.setEntry(mid, result);
      const isEmpty =
        result.openIssues.length === 0 &&
        result.deadlines.length === 0 &&
        result.nextActions.length === 0;
      setGlanceResult(result);
      setGlanceStatus(isEmpty ? 'empty' : 'done');
    } catch {
      if (signal.aborted) return;
      setGlanceStatus('error');
    }
  }, [glanceStore]);

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
        setGlanceResult(cached.result);
        const isEmpty =
          cached.result.openIssues.length === 0 &&
          cached.result.deadlines.length === 0 &&
          cached.result.nextActions.length === 0;
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
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        Matter not found
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
                const folderCount = matter.folderPaths.length;
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
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            <Eyebrow>Upcoming / Activity</Eyebrow>
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
                  Matter created {formatDate(matter.createdAt)}
                </span>
                <span style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  No upcoming deadlines yet. Ask the AI to find any in your documents.
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </span>
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
              ({String(matter.folderPaths.length)})
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
            {matter.folderPaths.length === 0 ? (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>No folders added yet</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            ) : (
              matter.folderPaths.slice(0, 2).map((p, i) => (
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
              ({String((matter.mailFolderPaths ?? []).length)})
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
            {(matter.mailFolderPaths ?? []).length === 0 ? (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>No email folders connected</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            ) : (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>{String((matter.mailFolderPaths ?? []).length)} mail folder(s) connected</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
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
              <span>Run a workflow on this matter</span>
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
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>Matter opened Apr 3, 2026</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            ) : (
              <span>Matter created {formatDate(matter.createdAt)}</span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
