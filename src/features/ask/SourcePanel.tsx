import { useState } from 'react';
import { CheckCircle2, FileText, ExternalLink, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { Button, Badge, Eyebrow, Card } from '@/ui/kp';
import type { AnswerCitation } from './askHelpers';
import { ragVerifyCitation, type CitationVerdict } from '@/platform/utils/tauri-commands';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import type { AuditEntry } from '@/platform/types/audit';

/* -------------------------------------------------------------------------- */
/* SourcePanel — sticky side panel showing the selected citation's passage     */
/* -------------------------------------------------------------------------- */

export function SourcePanel({
  cite,
  onOpenFile,
  onAuditLog,
}: {
  cite: AnswerCitation | null;
  onOpenFile?: (path: string) => void;
  /**
   * WS3 (Task 4): when provided, each "Verify against source" result emits
   * a `citation_verified` audit entry so the check is on the record.
   */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}) {
  // WS3 (Task 4): verification state — null = not run, 'loading' = in flight,
  // CitationVerdict = result.
  const [verdictState, setVerdictState] = useState<CitationVerdict | 'loading' | null>(null);
  // Reset verdict when the selected citation changes so stale verdicts
  // don't carry over to a different chip.
  const citeKey = cite ? `${cite.n}-${cite.id ?? 'noid'}` : 'none';
  const [lastCiteKey, setLastCiteKey] = useState<string>(citeKey);
  if (citeKey !== lastCiteKey) {
    setLastCiteKey(citeKey);
    setVerdictState(null);
  }

  const canVerify = Boolean(cite?.id && cite?.matterId);

  async function handleVerify() {
    if (!cite?.id || !cite?.matterId) return;
    setVerdictState('loading');
    try {
      const result = await ragVerifyCitation(cite.id, cite.matterId, cite.excerpt);
      setVerdictState(result);
      // Emit audit entry so the check is on the record.
      // The audit type uses the plain verdict string, not the object.
      onAuditLog?.(
        auditEventToEntry({
          type: 'citation_verified',
          timestamp: new Date().toISOString(),
          payload: { citationId: cite.id, verdict: result.verdict },
        }),
      );
    } catch {
      // ragVerifyCitation throws in browser/test mode; treat as "not available".
      setVerdictState(null);
    }
  }

  if (!cite) {
    return (
      <Card
        variant="raised"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--kp-space-xs)',
          minHeight: 160,
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-sm)',
          textAlign: 'center',
        }}
      >
        <FileText size={22} strokeWidth={1.5} style={{ opacity: 0.35 }} />
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        Click a citation chip to see the source passage
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </Card>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-background)',
        boxShadow: 'var(--kp-shadow-1)',
        overflow: 'hidden',
        position: 'sticky',
        top: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Eyebrow>
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          Source · citation {cite.n}
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </Eyebrow>
        {cite.verified && (
          <Badge
            variant="local"
            size="sm"
            icon={CheckCircle2}
            className="ml-auto"
          >
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Source found
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </Badge>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: 'var(--kp-card-pad)' }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <FileText
            size={16}
            strokeWidth={1.75}
            style={{ color: 'var(--kp-navy)', marginTop: 1, flex: 'none' }}
          />
          <div>
            <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--color-foreground)', lineHeight: 'var(--kp-leading-snug)' }}>
              {cite.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--kp-font-2xs)',
                color: 'var(--color-muted-foreground)',
                marginTop: 3,
              }}
            >
              {cite.locator}
            </div>
          </div>
        </div>

        <blockquote
          style={{
            margin: 'var(--kp-space-sm) 0 0',
            padding: '10px 13px',
            borderLeft: '3px solid var(--kp-accent)',
            background: 'var(--color-secondary)',
            borderRadius: '0 7px 7px 0',
            fontSize: 'var(--kp-font-sm)',
            lineHeight: 'var(--kp-leading-relaxed)',
            color: 'var(--color-foreground)',
          }}
        >
          {cite.excerpt}
        </blockquote>

        {/* WS3 (Task 4): "Verify against source" button + verdict.
            Guard: disabled with tooltip when id/matterId are absent (pre-3.0 or
            browser mode). Only `verified` is reassuring; the other three
            verdicts render as clear problems — no softening. */}
        <div style={{ marginTop: 'var(--kp-space-sm)' }}>
          <button
            type="button"
            data-testid="verify-citation-btn"
            disabled={!canVerify || verdictState === 'loading'}
            title={canVerify ? 'Check this quote against the stored source' : 'Verification is not available for this citation (pre-3.0 or browser mode)'}
            onClick={() => { void handleVerify(); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-background)',
              fontSize: 'var(--kp-font-xs)',
              fontWeight: 'var(--kp-weight-medium)',
              color: canVerify ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
              cursor: canVerify ? 'pointer' : 'not-allowed',
              opacity: canVerify ? 1 : 0.55,
              width: '100%',
              justifyContent: 'center',
            }}
          >
            {verdictState === 'loading' ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            ) : (
              <ShieldCheck size={12} strokeWidth={2} />
            )}
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Verify against source
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </button>

          {/* Verdict rendering — honest, no softening.
              Only `verified` is reassuring. notFound / textMismatch /
              matterMismatch must read as clear problems. */}
          {verdictState && verdictState !== 'loading' && (
            <div
              data-testid="verify-verdict"
              data-verdict={verdictState.verdict}
              style={{
                marginTop: 8,
                padding: '8px 11px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--kp-font-xs)',
                lineHeight: 'var(--kp-leading-normal)',
                display: 'flex',
                gap: 7,
                alignItems: 'flex-start',
                ...(verdictState.verdict === 'verified'
                  ? {
                      background: 'var(--kp-local-bg)',
                      border: '1px solid var(--kp-local-line)',
                      color: 'var(--kp-local)',
                    }
                  : {
                      background: 'color-mix(in srgb, var(--kp-danger, #dc2626) 8%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--kp-danger, #dc2626) 35%, transparent)',
                      color: 'color-mix(in srgb, var(--kp-danger, #dc2626) 90%, black)',
                    }),
              }}
            >
              {verdictState.verdict === 'verified' ? (
                <CheckCircle2 size={13} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
              ) : (
                <AlertTriangle size={13} strokeWidth={2} style={{ flex: 'none', marginTop: 1 }} />
              )}
              <span>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                {verdictState.verdict === 'verified' && 'Quote found in source. This citation checks out.'}
                {verdictState.verdict === 'notFound' && 'This quote was not found in the cited source. Do not rely on it without checking the original.'}
                {verdictState.verdict === 'textMismatch' && 'The quote does not match the stored text. Do not rely on it without checking the original.'}
                {verdictState.verdict === 'matterMismatch' && `This source belongs to a different matter. Do not rely on it. This may be a cross-matter data leak.`}
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </span>
            </div>
          )}
        </div>

        {cite.path && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={ExternalLink}
            fullWidth
            onClick={() => { onOpenFile?.(cite.path ?? ''); }}
            style={{ marginTop: 'var(--kp-space-sm)' }}
          >
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Open in editor
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </Button>
        )}
      </div>
    </div>
  );
}
