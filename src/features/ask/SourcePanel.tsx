import { CheckCircle2, FileText, ExternalLink } from 'lucide-react';
import { Button, Badge, Eyebrow, Card } from '@/ui/kp';
import type { AnswerCitation } from './askHelpers';

/* -------------------------------------------------------------------------- */
/* SourcePanel — sticky side panel showing the selected citation's passage     */
/* -------------------------------------------------------------------------- */

export function SourcePanel({
  cite,
  onOpenFile,
}: {
  cite: AnswerCitation | null;
  onOpenFile?: (path: string) => void;
}) {
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
            Verified
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
