/**
 * ChapterLayout — reusable centered layout for onboarding chapters.
 *
 * Used by Ch1–Ch4 (and Ch6–Ch8 when built). Provides a consistent structure:
 * optional scene on top, an h2 title, the body (children), and a footer with
 * an optional Back button and a primary Continue button.
 *
 * Light theme. No new npm dependencies.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/kp';

export interface ChapterLayoutProps {
  title: string;
  /** Optional scene illustration shown above the title. */
  scene?: ReactNode;
  /** Body content (form fields, explanatory text, etc.). */
  children: ReactNode;
  /** Called when the Back button is clicked. Omit to hide the Back button. */
  onBack?: () => void;
  /** Called when the Continue/primary button is clicked. */
  onContinue: () => void;
  /** Label for the primary button. Defaults to "Continue". */
  continueLabel?: string;
  /** Disables the primary button when true. */
  continueDisabled?: boolean;
  /** data-testid forwarded to the root element. */
  testId?: string;
}

/**
 * Centered column layout used by early onboarding chapters.
 * The title is an h2 (the host's outer page is h1-level).
 */
export function ChapterLayout({
  title,
  scene,
  children,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  testId,
}: ChapterLayoutProps) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-xl)',
        maxWidth: 520,
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Scene */}
      {scene && (
        <div
          style={{ display: 'flex', justifyContent: 'center' }}
        >
          {scene}
        </div>
      )}

      {/* Title */}
      <h2
        style={{
          fontSize: 'var(--kp-font-2xl)',
          fontWeight: 'var(--kp-weight-bold)',
          color: 'var(--kp-navy)',
          margin: 0,
          lineHeight: 1.2,
        }}
      >
        {title}
      </h2>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
        {children}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: onBack ? 'space-between' : 'flex-end',
          paddingTop: 'var(--kp-space-md)',
          borderTop: '1px solid var(--color-border)',
          gap: 'var(--kp-space-md)',
        }}
      >
        {onBack && (
          <Button
            variant="ghost"
            onClick={onBack}
            data-testid="chapter-back"
          >
            <ArrowLeft size={16} style={{ marginRight: 6 }} />
            Back
          </Button>
        )}

        <Button
          variant="primary"
          onClick={onContinue}
          disabled={continueDisabled}
          data-testid="chapter-continue"
        >
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
