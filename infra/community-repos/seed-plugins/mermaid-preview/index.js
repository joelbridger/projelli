const POLL_MS = 1e3;
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
const FENCE = /```mermaid\s*\n([\s\S]*?)```/g;
function extractDiagrams(content) {
  const out = [];
  let match;
  let i = 0;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(content)) !== null) {
    const source = (match[1] ?? "").trim();
    if (source) out.push({ index: i, source });
    i += 1;
  }
  return out;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function renderEmptyPanel() {
  return [
    '<div style="font-family: system-ui, -apple-system, sans-serif; padding: 20px; color: #6b7280;">',
    '<h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280;">Mermaid Preview</h2>',
    '<p style="font-size: 13px; line-height: 1.5;">No mermaid blocks found in the active document. Add one with:</p>',
    '<pre style="background: #f3f4f6; padding: 10px; border-radius: 4px; font-size: 12px; color: #374151;">```mermaid\nflowchart LR\n  A --&gt; B\n```</pre>',
    "</div>"
  ].join("");
}
function renderDiagramPanel(diagrams) {
  const blocks = diagrams.map(
    (d) => `<div style="margin-bottom: 16px;"><div style="font-size: 11px; color: #9ca3af; margin-bottom: 6px;">Diagram ${d.index + 1}</div><pre class="mermaid" style="background: white; padding: 12px; border: 1px solid #e5e7eb; border-radius: 4px;">${escapeHtml(d.source)}</pre></div>`
  ).join("");
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
  <\/script>`;
  return [
    '<div style="font-family: system-ui, -apple-system, sans-serif; padding: 20px; color: #1f2937;">',
    '<h2 style="margin: 0 0 16px; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280;">Mermaid Preview</h2>',
    blocks,
    script,
    "</div>"
  ].join("");
}
const plugin = {
  async activate(api) {
    let lastSerialized = "";
    const refresh = async () => {
      let content = "";
      try {
        content = await api.editor.getContent();
      } catch {
      }
      const diagrams = extractDiagrams(content);
      const serialized = JSON.stringify(diagrams);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      api.sidebar.addPanel({
        id: "mermaid-preview-panel",
        title: "Mermaid Preview",
        html: diagrams.length === 0 ? renderEmptyPanel() : renderDiagramPanel(diagrams)
      });
    };
    api.commands.register("mermaid-preview.refresh", async () => {
      lastSerialized = "";
      await refresh();
      api.notify.info("Mermaid preview refreshed.");
    });
    api.toolbar.addButton({
      id: "mermaid-preview-button",
      icon: "workflow",
      tooltip: "Refresh mermaid preview",
      command: "mermaid-preview.refresh"
    });
    await refresh();
    setInterval(() => {
      void refresh();
    }, POLL_MS);
  }
};
export {
  plugin as default
};
