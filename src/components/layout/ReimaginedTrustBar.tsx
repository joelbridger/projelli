/**
 * ReimaginedTrustBar — the hero trust element.
 *
 * Research finding (Streams A + C converge): the egress indicator was the
 * single most emotionally powerful moment in the persona study, yet today it
 * is buried among nine items in a 24px status strip. Here it is elevated to a
 * prominent, always-visible bar: which matter you are in (scope) on the left,
 * and exactly where an AI request would go (egress) on the right. Composes the
 * already-wired EgressIndicator + matter scope + Data Map, so the trust state
 * is real, not a mock. Rendered only in the reimagined shell.
 */
import { useState } from 'react';
import { Briefcase, Globe, Map as MapIcon } from 'lucide-react';
import { useActiveMatter } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { useConfidentialityMode } from '@/hooks/useConfidentialityMode';
import { EgressIndicator } from '@/components/privacy/EgressIndicator';
import { DataMapDialog } from '@/components/privacy/DataMapDialog';

export function ReimaginedTrustBar() {
  const activeMatter = useActiveMatter();
  const confidentialityMode = useConfidentialityMode();
  const [dataMapOpen, setDataMapOpen] = useState(false);

  return (
    <div
      data-testid="trust-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 14, height: 54,
        padding: '0 18px 0 20px', flex: 'none',
        background: 'var(--color-background)', borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Matter scope */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {activeMatter
          ? <Briefcase size={18} strokeWidth={1.75} style={{ color: 'var(--kp-navy)', flex: 'none' }} />
          : <Globe size={18} strokeWidth={1.75} style={{ color: 'var(--kp-navy)', flex: 'none' }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kp-navy)', lineHeight: 1.2, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>
            {activeMatter ? matterLabel(activeMatter) : 'All matters'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>
            {activeMatter
              ? 'Scoped to this matter. Nothing from other clients can appear.'
              : 'Searching across every matter. Nothing crosses between clients.'}
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={() => { setDataMapOpen(true); }}
        title="Data Map: where your data goes, in plain English"
        aria-label="Open the Data Map"
        style={{
          width: 34, height: 34, borderRadius: 6, border: 0, background: 'transparent',
          color: 'var(--color-muted-foreground)', cursor: 'pointer', display: 'grid', placeItems: 'center',
        }}
      >
        <MapIcon size={18} strokeWidth={1.75} />
      </button>

      {/* The egress hero: always visible, real state, all three modes. */}
      <EgressIndicator provider="anthropic" mode={confidentialityMode} variant="full" />

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />
    </div>
  );
}
