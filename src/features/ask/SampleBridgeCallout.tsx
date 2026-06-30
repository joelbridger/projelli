import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/kp';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { SK_SAMPLE_BRIDGE_DISMISSED, EV_OPEN_MATTER_MANAGER } from '@/config/identity';

/* -------------------------------------------------------------------------- */
/* Constants                                                                    */
/* -------------------------------------------------------------------------- */

export const SAMPLE_BRIDGE_DISMISSED_KEY = SK_SAMPLE_BRIDGE_DISMISSED;

/* -------------------------------------------------------------------------- */
/* SampleBridgeCallout — gentle nudge to add real files (sample matter only)  */
/* -------------------------------------------------------------------------- */

export function SampleBridgeCallout() {
  const entityLabel = useEntityLabel();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(SAMPLE_BRIDGE_DISMISSED_KEY) === '1',
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(SAMPLE_BRIDGE_DISMISSED_KEY, '1');
    setDismissed(true);
  };

  const handleAddMatter = () => {
    window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
  };

  return (
    <div
      data-testid="sample-bridge-callout"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--kp-space-sm)',
        padding: 'var(--kp-space-sm) var(--kp-space-md)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-secondary)',
        marginTop: 'var(--kp-space-xs)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 'var(--kp-font-sm)',
            color: 'var(--color-foreground)',
            lineHeight: 'var(--kp-leading-normal)',
            margin: 0,
          }}
        >
          {`This is sample data. When you are ready, add your first real ${entityLabel.one} to search your own files.`}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Button
          variant="primary"
          size="sm"
          data-testid="sample-bridge-add-matter"
          onClick={handleAddMatter}
        >
          {`Add a ${entityLabel.one}`}
        </Button>
        <button
          type="button"
          data-testid="sample-bridge-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-background)',
            color: 'var(--color-muted-foreground)',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
