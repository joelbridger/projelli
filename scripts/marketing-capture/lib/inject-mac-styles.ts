export function macStyles(): string {
  return `
    html, body, * {
      font-family: -apple-system, "SF Pro Text", "SF Pro Display",
                   "Inter", system-ui, sans-serif !important;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    code, pre, kbd, samp, .font-mono, [class*="mono"] {
      font-family: "SF Mono", ui-monospace, "Menlo", "Roboto Mono", monospace !important;
    }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.25);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.40); }
    ::-webkit-scrollbar-corner { background: transparent; }
    ::selection { background: rgba(0,122,255,0.25); }
    :focus-visible { outline-color: #007AFF !important; }
    input:focus, textarea:focus, button:focus { outline-offset: 2px; }
  `;
}
