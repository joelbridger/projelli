import { useCallback } from 'react';
import { Card } from '@/components/ui/kp';
import type { RagHit } from '@/utils/tauri-commands';
import type { MailListItem } from '@/utils/mail-commands';

// ── AskHit card ────────────────────────────────────────────────────────────

export interface AskHitCardProps {
  hit: RagHit;
  rank: number;
  /** Pass the loaded keyword items so we can resolve subject from id when available. */
  items: MailListItem[];
}

export function AskHitCard({ hit, rank, items }: AskHitCardProps) {
  const sid = hit.sourceId ?? hit.path;
  const rawId = sid.startsWith('mail:') ? sid.slice(5) : sid;

  // Prefer subject from a loaded list item; otherwise fall back to snippet headline
  const matchedItem = items.find((it) => it.id === rawId);
  const title = matchedItem?.subject || hit.chunkText.slice(0, 100);
  const snippet = matchedItem ? hit.chunkText : null;

  const handleOpen = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('keepance:open-email', {
        detail: { sourceId: sid },
      }),
    );
  }, [sid]);

  return (
    <Card
      variant="interactive"
      data-testid="ask-hit-card"
      onClick={handleOpen}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        marginBottom: 'var(--kp-space-xs)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: snippet ? 4 : 0 }}>
        <span
          style={{
            fontSize: 'var(--kp-font-2xs)',
            fontWeight: 'var(--kp-weight-bold)',
            color: 'var(--color-muted-foreground)',
            fontVariantNumeric: 'tabular-nums',
            flex: 'none',
          }}
        >
          { }
          #{rank}
          { }
        </span>
        <span
          style={{
            fontSize: 'var(--kp-font-xs)',
            fontWeight: 'var(--kp-weight-semibold)',
            color: 'var(--kp-navy)',
            fontFamily: 'var(--font-sans)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 'var(--kp-font-2xs)',
            color: 'var(--color-muted-foreground)',
            fontVariantNumeric: 'tabular-nums',
            flex: 'none',
          }}
        >
          { }
          score {hit.score.toFixed(3)}
          { }
        </span>
      </div>
      {snippet && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
            lineHeight: 'var(--kp-leading-normal)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {snippet}
        </p>
      )}
      <span
        style={{
          display: 'block',
          marginTop: 4,
          fontSize: 'var(--kp-font-2xs)',
          color: 'var(--color-muted-foreground)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: 0.6,
        }}
      >
        {rawId}
      </span>
    </Card>
  );
}
