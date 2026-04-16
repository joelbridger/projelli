/**
 * RagStatusBadge — compact "Memory: ready / indexing 47/312 / paused"
 * pill that lives in the status bar. Click-through: clicking the badge
 * could open a memory panel later (M2/M3); for M1 it's display-only.
 */

import { useRagStatus } from '@/hooks/useRagStatus';
import { isMemoryEnabled } from '@/modules/memory/MemoryService';
import { Brain } from 'lucide-react';

export interface RagStatusBadgeProps {
  status?: ReturnType<typeof useRagStatus>;
  /** Override the toggle reader (for tests). Defaults to `isMemoryEnabled()`. */
  enabled?: boolean;
}

export function RagStatusBadge({ status, enabled }: RagStatusBadgeProps) {
  const live = useRagStatus();
  const snap = status ?? live;
  const on = enabled ?? isMemoryEnabled();

  const label = (() => {
    if (!on) return 'Memory: paused';
    switch (snap.status) {
      case 'indexing':
        if (snap.total > 0) return `Memory: indexing ${snap.processed}/${snap.total}`;
        return 'Memory: indexing…';
      case 'done':
        return 'Memory: ready';
      case 'cancelled':
        return 'Memory: cancelled';
      case 'error':
        return 'Memory: error';
      case 'idle':
      default:
        return 'Memory: ready';
    }
  })();

  const tone = (() => {
    if (!on) return 'text-muted-foreground';
    if (snap.status === 'error') return 'text-destructive';
    if (snap.status === 'indexing') return 'text-foreground';
    return 'text-muted-foreground';
  })();

  return (
    <div
      data-testid="rag-status-badge"
      data-status={snap.status}
      data-enabled={on ? 'true' : 'false'}
      title={on ? label : 'Memory is paused. Re-enable in Settings → Memory.'}
      className={`flex items-center gap-1 px-2 py-0.5 ${tone}`}
    >
      <Brain className="h-3 w-3" aria-hidden="true" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export default RagStatusBadge;
