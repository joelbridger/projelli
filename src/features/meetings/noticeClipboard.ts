/**
 * Recording Notice Kit — clipboard writer with a webview/insecure-context
 * fallback (mirrors the pattern in ClientQuestionsList). navigator.clipboard is
 * absent in some Tauri webviews, so fall back to a hidden textarea + execCommand.
 */
export async function copyText(text: string): Promise<void> {
  const clip = navigator.clipboard as { writeText?: (t: string) => Promise<void> } | undefined;
  if (clip?.writeText) {
    try {
      await clip.writeText(text);
      return;
    } catch {
      // fall through to the legacy path
    }
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    // execCommand is deprecated but is the only synchronous copy available in
    // webviews/insecure contexts where navigator.clipboard is absent.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    // last resort — nothing more we can do; the copy silently no-ops.
  }
}
