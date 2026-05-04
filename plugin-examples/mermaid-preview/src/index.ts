import type { PluginAPI, PluginModule } from '@projelli/plugin-api';

// Mermaid Preview - example Projelli plugin.
//
// Demonstrates:
//   - api.editor.getContent (gated by editor:selection in v2.0)
//   - api.sidebar.addPanel (re-rendered every poll if content changed)
//   - api.commands.register / api.toolbar.addButton (manual refresh)
//
// Architecture note on rendering:
//
// Plugin code runs in a Web Worker, which has no DOM. Mermaid needs a DOM to
// render. So this plugin extracts the diagram source from the editor in the
// worker, then embeds each diagram as a `<pre class="mermaid">` block inside
// the sidebar iframe HTML. The iframe loads the mermaid library from a CDN
// via a `<script>` tag and renders each pre into SVG inside the iframe.
//
// This means the iframe needs network access to fetch mermaid, which the host
// CSP allows for the sandboxed sidebar context. The plugin worker itself
// declares no `network` permission because it never makes a fetch.
//
// v2.1 may add a worker-side rendering API; until then, deferring render to
// the iframe is the cleanest path that keeps the bundle small.

const POLL_MS = 1000;
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';
const FENCE = /```mermaid\s*\n([\s\S]*?)```/g;

interface ExtractedDiagram {
  index: number;
  source: string;
}

function extractDiagrams(content: string): ExtractedDiagram[] {
  const out: ExtractedDiagram[] = [];
  let match: RegExpExecArray | null;
  let i = 0;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(content)) !== null) {
    const source = (match[1] ?? '').trim();
    if (source) out.push({ index: i, source });
    i += 1;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmptyPanel(): string {
  return [
    '<div style="font-family: system-ui, -apple-system, sans-serif; padding: 20px; color: #6b7280;">',
    '<h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280;">Mermaid Preview</h2>',
    '<p style="font-size: 13px; line-height: 1.5;">No mermaid blocks found in the active document. Add one with:</p>',
    '<pre style="background: #f3f4f6; padding: 10px; border-radius: 4px; font-size: 12px; color: #374151;">```mermaid\nflowchart LR\n  A --&gt; B\n```</pre>',
    '</div>',
  ].join('');
}

function renderDiagramPanel(diagrams: ExtractedDiagram[]): string {
  const blocks = diagrams
    .map(
      (d) =>
        `<div style="margin-bottom: 16px;"><div style="font-size: 11px; color: #9ca3af; margin-bottom: 6px;">Diagram ${d.index + 1}</div><pre class="mermaid" style="background: white; padding: 12px; border: 1px solid #e5e7eb; border-radius: 4px;">${escapeHtml(d.source)}</pre></div>`,
    )
    .join('');

  // Inline module script renders all `pre.mermaid` blocks. Re-running on
  // every panel update is fine: mermaid replaces the children in place.
  const renderCall = `mermaid.run({ querySelector: 'pre.mermaid' })`;
  const script = `<script type="module">
    import mermaid from '${MERMAID_CDN}';
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
    ${renderCall}.catch(function(e) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'color:#b91c1c;font-size:12px;padding:8px;background:#fef2f2;border-radius:4px;margin-top:8px;';
      wrap.textContent = 'Mermaid render error: ' + (e && e.message ? e.message : String(e));
      document.body.appendChild(wrap);
    });
  </script>`;

  return [
    '<div style="font-family: system-ui, -apple-system, sans-serif; padding: 20px; color: #1f2937;">',
    '<h2 style="margin: 0 0 16px; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280;">Mermaid Preview</h2>',
    blocks,
    script,
    '</div>',
  ].join('');
}

const plugin: PluginModule = {
  async activate(api: PluginAPI) {
    let lastSerialized = '';

    const refresh = async (): Promise<void> => {
      let content = '';
      try {
        content = await api.editor.getContent();
      } catch {
        // No active editor or permission not granted yet.
      }
      const diagrams = extractDiagrams(content);
      const serialized = JSON.stringify(diagrams);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      api.sidebar.addPanel({
        id: 'mermaid-preview-panel',
        title: 'Mermaid Preview',
        html: diagrams.length === 0 ? renderEmptyPanel() : renderDiagramPanel(diagrams),
      });
    };

    api.commands.register('mermaid-preview.refresh', async () => {
      lastSerialized = ''; // Force re-render even if content is unchanged.
      await refresh();
      api.notify.info('Mermaid preview refreshed.');
    });

    api.toolbar.addButton({
      id: 'mermaid-preview-button',
      icon: 'workflow',
      tooltip: 'Refresh mermaid preview',
      command: 'mermaid-preview.refresh',
    });

    await refresh();
    setInterval(() => {
      void refresh();
    }, POLL_MS);
  },
};

export default plugin;
