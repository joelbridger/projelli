/**
 * MatterHub — per-matter command-center hub.
 *
 * Full-page overview for a single matter: header with back navigation,
 * compact Ask hero with recent questions, at-a-glance summary, and four
 * panel cards (Documents, Email, Workflows, Activity).
 *
 * Light theme only. Inline styles + CSS vars.
 */

import { useState } from 'react';
import { Lock, ChevronRight, Sparkles, FileText, Mail, GitBranch, Clock, ArrowLeft } from 'lucide-react';
import { useMatters, useActiveMatterPrivileged, SAMPLE_MATTER_ID } from '@/stores/matterStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { useEntityLabel } from '@/hooks/useEntityLabel';

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

  const dispatchLaunch = (surface: string) => {
    window.dispatchEvent(
      new CustomEvent('keepance:matter-launch', {
        detail: { matterId, surface },
      }),
    );
  };

  const handleAskSubmit = () => {
    dispatchLaunch('search');
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
          fontSize: 14,
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
            borderRadius: 5,
            fontSize: 13,
            fontWeight: 600,
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

  const panelCard: React.CSSProperties = {
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    background: '#fff',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  const panelHeader: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  };

  const panelTitle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-muted-foreground)',
  };

  const panelArrow: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--color-muted-foreground)',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
    borderRadius: 4,
  };

  const panelPreview: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--color-muted-foreground)',
    lineHeight: 1.5,
  };

  const panelCount: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-muted-foreground)',
    marginLeft: 'auto',
    marginRight: 4,
  };

  return (
    <div
      style={{
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
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: '#fff',
        }}
      >
        {/* Back button */}
        <button
          type="button"
          data-testid="hub-back-btn"
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-muted-foreground)',
            fontSize: 12,
            fontWeight: 500,
            padding: '0 0 12px 0',
            fontFamily: 'Satoshi, sans-serif',
          }}
        >
          <ArrowLeft style={{ width: 13, height: 13, strokeWidth: 2 }} />
          { }
          {entityLabel.Other}
          { }
        </button>

        {/* Matter name + eyebrow + badges */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1
              style={{
                margin: '0 0 4px',
                fontSize: 20,
                fontWeight: 700,
                color: 'var(--kp-navy, #0a2540)',
                fontFamily: 'Satoshi, sans-serif',
                lineHeight: 1.2,
              }}
            >
              {label}
            </h1>
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-muted-foreground)',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0 6px',
              }}
            >
              {matter.client && (
                <span>{matter.client}</span>
              )}
              {(isPrivileged || matter.privileged) && (
                <>
                  <span
                    data-testid="hub-isolated-badge"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '1px 7px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: 'rgba(10,37,64,0.07)',
                      color: 'var(--kp-navy, #0a2540)',
                      border: '1px solid rgba(10,37,64,0.18)',
                    }}
                  >
                    <Lock style={{ width: 11, height: 11, strokeWidth: 2 }} />
                    { }
                    Isolated
                    { }
                  </span>
                </>
              )}
              { }
              <span>Created {formatDate(matter.createdAt)}</span>
              { }
            </div>
          </div>

          {/* Sample pill */}
          {matter.isSample && (
            <span
              data-testid="hub-sample-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.03em',
                background: 'rgba(16,185,129,0.09)',
                color: '#065f46',
                border: '1px solid rgba(16,185,129,0.28)',
                whiteSpace: 'nowrap',
                flex: 'none',
              }}
            >
              { }
              Sample
              { }
            </span>
          )}
        </div>
      </div>

      {/* ── B. Ask hero ────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-border)',
          background: 'rgba(10,37,64,0.02)',
        }}
      >
        {/* Compact Ask row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 7,
            padding: '8px 10px',
          }}
        >
          <Sparkles
            style={{
              width: 15,
              height: 15,
              color: 'var(--color-muted-foreground)',
              flex: 'none',
              strokeWidth: 1.75,
            }}
          />
          <input
            type="text"
            data-testid="hub-ask-input"
            placeholder={`Ask about this ${entityLabel.one}...`}
            value={askQ}
            onChange={(e) => { setAskQ(e.target.value); }}
            onKeyDown={handleAskKeyDown}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: 13,
              color: 'var(--color-foreground)',
              background: 'transparent',
              fontFamily: 'Satoshi, sans-serif',
            }}
          />
          <button
            type="button"
            data-testid="hub-ask-submit"
            onClick={handleAskSubmit}
            style={{
              padding: '4px 12px',
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--kp-navy, #0a2540)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            { }
            Search
            { }
          </button>
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
                fontSize: 11,
                color: 'var(--color-muted-foreground)',
                fontWeight: 600,
                letterSpacing: '0.02em',
                flex: 'none',
              }}
            >
              { }
              Recent:
              { }
            </span>
            {recentQuestions.map((q, i) => (
              <button
                key={i}
                type="button"
                data-testid={`hub-recent-q-${String(i)}`}
                onClick={() => { dispatchLaunch('search'); }}
                style={{
                  padding: '2px 9px',
                  borderRadius: 4,
                  fontSize: 11,
                  border: '1px solid var(--color-border)',
                  background: '#fff',
                  color: 'var(--color-foreground)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontFamily: 'Satoshi, sans-serif',
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── C. At a Glance ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* Left: At a Glance */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-muted-foreground)',
              marginBottom: 8,
            }}
          >
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            At a Glance
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </div>

          {isSample ? (
            <div data-testid="hub-sample-glance" style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ color: 'var(--color-foreground)' }}>
                <strong>6</strong>
                { }
                {' open issues'}
                { }
              </div>
              <div style={{ color: 'var(--color-muted-foreground)', fontSize: 12, marginTop: 2 }}>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                HVAC habitability - lease amendment needed - damages calculation in progress
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
              <div style={{ color: 'var(--color-muted-foreground)', fontSize: 12, marginTop: 4 }}>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                Fee: $350/hr, $3,000 retainer deposited
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
            </div>
          ) : (
            /* Future: real AI at-a-glance summary */
            <div data-testid="hub-real-glance" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-foreground)' }}>
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
                      <div style={{ color: 'var(--color-muted-foreground)', fontSize: 12 }}>
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
          )}
        </div>

        {/* Right: Upcoming / Activity */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-muted-foreground)',
              marginBottom: 8,
            }}
          >
            { }
            Upcoming / Activity
            { }
          </div>

          <div data-testid="hub-activity" style={{ fontSize: 13, lineHeight: 1.6 }}>
            {isSample ? (
              <>
                <div style={{ color: 'var(--color-foreground)' }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Deadline: Lease copy from client (end of week)
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
                <div style={{ color: 'var(--color-muted-foreground)', fontSize: 12, marginTop: 4 }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Certified mail responses sent (May 25)
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
              </>
            ) : (
              <span style={{ color: 'var(--color-muted-foreground)' }}>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                No recent activity
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── D. Four panels ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '16px 24px 24px',
        }}
      >
        {/* Documents */}
        <div data-testid="hub-panel-documents" style={panelCard}>
          <div style={panelHeader}>
            <span style={panelTitle}>
              <FileText style={{ width: 13, height: 13, strokeWidth: 2 }} />
              { }
              Documents
              { }
            </span>
            <span style={panelCount}>
              ({String(matter.folderPaths.length)})
            </span>
            <button
              type="button"
              data-testid="hub-panel-documents-open"
              aria-label="Open Documents"
              style={panelArrow}
              onClick={() => { dispatchLaunch('files'); }}
            >
              <ChevronRight style={{ width: 15, height: 15, strokeWidth: 2 }} />
            </button>
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
        </div>

        {/* Email */}
        <div data-testid="hub-panel-email" style={panelCard}>
          <div style={panelHeader}>
            <span style={panelTitle}>
              <Mail style={{ width: 13, height: 13, strokeWidth: 2 }} />
              { }
              Email
              { }
            </span>
            <span style={panelCount}>
              ({String((matter.mailFolderPaths ?? []).length)})
            </span>
            <button
              type="button"
              data-testid="hub-panel-email-open"
              aria-label="Open Email"
              style={panelArrow}
              onClick={() => { dispatchLaunch('email'); }}
            >
              <ChevronRight style={{ width: 15, height: 15, strokeWidth: 2 }} />
            </button>
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
        </div>

        {/* Workflows */}
        <div data-testid="hub-panel-workflows" style={panelCard}>
          <div style={panelHeader}>
            <span style={panelTitle}>
              <GitBranch style={{ width: 13, height: 13, strokeWidth: 2 }} />
              { }
              Workflows
              { }
            </span>
            <button
              type="button"
              data-testid="hub-panel-workflows-open"
              aria-label="Open Workflows"
              style={panelArrow}
              onClick={() => { dispatchLaunch('workflows'); }}
            >
              <ChevronRight style={{ width: 15, height: 15, strokeWidth: 2 }} />
            </button>
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
        </div>

        {/* Activity */}
        <div data-testid="hub-panel-activity" style={panelCard}>
          <div style={panelHeader}>
            <span style={panelTitle}>
              <Clock style={{ width: 13, height: 13, strokeWidth: 2 }} />
              { }
              Activity
              { }
            </span>
            <button
              type="button"
              data-testid="hub-panel-activity-open"
              aria-label="Open Activity"
              style={panelArrow}
              onClick={() => { dispatchLaunch('audit'); }}
            >
              <ChevronRight style={{ width: 15, height: 15, strokeWidth: 2 }} />
            </button>
          </div>
          <div style={panelPreview}>
            {isSample ? (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>Matter opened Apr 3, 2026</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            ) : (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span>No recent activity logged</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
