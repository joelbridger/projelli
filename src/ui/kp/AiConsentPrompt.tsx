import { Lock } from 'lucide-react';
import type { IconType } from './types';
import { Callout } from './Callout';
import { Button } from './Button';

export interface AiConsentPromptProps {
  /** The one-sentence question or blocked-state headline, e.g. "Ready to
   *  build the Hollings Family Client Map". Bold. */
  message: string;
  /** Optional secondary explanation line, muted. */
  detail?: string;
  /** Primary action label, e.g. "Build map" / "Enable cloud AI". */
  actionLabel: string;
  onAction: () => void;
  /** Optional secondary "not now" affordance. Omit for a needs-you state that
   *  has no reasonable dismissal (e.g. a build that can't proceed at all). */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Small trailing note, e.g. "Uses your cloud AI". */
  note?: string;
  icon?: IconType;
  'data-testid'?: string;
}

/**
 * AiConsentPrompt — the ONE in-place "needs-you" banner for AI privacy/consent
 * moments across the app (S2/S3 of the 2026-07-03 UX evaluation). Built on the
 * shared `Callout` shell so every surface that gates on an AI choice looks and
 * behaves like the same component, not a bespoke sentence pointing at Settings.
 * Mirrors the shape of `FileAccessConsentBanner` (the Ask feature's shipped
 * consent banner): a bold question, an optional detail line, a primary action,
 * an optional "not now", and a small trailing note.
 */
export function AiConsentPrompt({
  message,
  detail,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  note,
  icon = Lock,
  'data-testid': testId,
}: AiConsentPromptProps) {
  return (
    <div data-testid={testId} data-state="needs-you">
      <Callout variant="info" icon={icon}>
        <p style={{ fontWeight: 'var(--kp-weight-semibold)' }}>{message}</p>
        {detail && (
          <p style={{ marginTop: 2, opacity: 0.9 }}>{detail}</p>
        )}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button type="button" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
          {secondaryLabel && (
            <button
              type="button"
              onClick={onSecondary}
              style={{ fontSize: 'var(--kp-font-xs)', textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}
            >
              {secondaryLabel}
            </button>
          )}
          {note && (
            <span style={{ fontSize: 'var(--kp-font-2xs)', opacity: 0.75, marginLeft: 'auto' }}>{note}</span>
          )}
        </div>
      </Callout>
    </div>
  );
}

export default AiConsentPrompt;
