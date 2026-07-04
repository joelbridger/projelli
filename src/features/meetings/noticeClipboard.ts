/**
 * Recording Notice Kit — clipboard writer with a webview/insecure-context
 * fallback (mirrors the pattern in ClientQuestionsList). navigator.clipboard is
 * absent in some Tauri webviews, so fall back to a hidden textarea + execCommand.
 *
 * THROWS if the copy could not be confirmed. Callers must only show "Copied"
 * and write the corresponding ledger evidence AFTER this resolves — a silently
 * failed copy that still logged a chat/invite-notice entry would be false
 * compliance evidence (codex-review R5).
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
  fallbackCopy(text); // throws if it can't confirm the copy
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    // execCommand is deprecated but is the only synchronous copy available in
    // webviews/insecure contexts where navigator.clipboard is absent.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('clipboard copy was not confirmed');
  } finally {
    document.body.removeChild(ta);
  }
}
