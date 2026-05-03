// Plugin Spike — sidebar panel preview for criterion #4.
//
// Renders a `SpikePanelSpec` into a real React subtree. Spike scope: plain
// HTML only. The HTML originates from plugin code we don't own, so we render
// it inside a sandboxed iframe via `srcDoc`. The sandbox attribute disables
// scripts, forms, popups, and same-origin access by default; this gives us a
// hard isolation boundary even though the plugin already runs in a worker.
// Production C3 will replace this with a structured ComponentTree renderer
// that has no string-HTML escape hatch at all.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3

import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { SpikePanelSpec } from '@/types/pluginSpike';

interface SpikeSidebarPreviewProps {
  /** Panel spec emitted by the plugin via `sidebar.addPanel`. */
  spec: SpikePanelSpec | null;
  className?: string;
}

/**
 * Inline CSS injected into the sandboxed iframe so the preview matches the
 * surrounding spike harness without inheriting parent stylesheets (sandbox
 * means no class names crossing the boundary).
 */
const PREVIEW_FRAME_STYLES = `
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 12px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    color: inherit;
    background: transparent;
  }
  body * { max-width: 100%; }
  a { color: inherit; }
`;

function buildSrcDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PREVIEW_FRAME_STYLES}</style></head><body>${html}</body></html>`;
}

export function SpikeSidebarPreview({
  spec,
  className,
}: SpikeSidebarPreviewProps) {
  const srcDoc = useMemo(() => (spec ? buildSrcDoc(spec.html) : ''), [spec]);

  if (!spec) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground',
          className,
        )}
        data-testid="sidebar-preview-empty"
      >
        No panel rendered yet. Criterion 4 will populate this preview.
      </div>
    );
  }
  return (
    <div
      className={cn('rounded-md border border-border bg-card overflow-hidden', className)}
      data-testid="sidebar-preview"
      data-panel-id={spec.id}
    >
      <div className="border-b border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {spec.title}
      </div>
      <iframe
        title={`spike-panel-${spec.id}`}
        sandbox=""
        srcDoc={srcDoc}
        className="block w-full min-h-[120px] bg-transparent"
        data-testid="sidebar-preview-frame"
      />
    </div>
  );
}
