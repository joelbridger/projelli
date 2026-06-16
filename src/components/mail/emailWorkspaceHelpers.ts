import type React from 'react';

export function formatRelativeDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (diffDays < 7) {
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * Maps a raw backend/provider error to a plain-language message suitable for display.
 * Auth/401 variants become a reconnect prompt; everything else becomes a generic retry message.
 */
export function mapMailError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthenticated') ||
    lower.includes('token') ||
    lower.includes('auth')
  ) {
    return "Your email account isn't fully connected. Reconnect it in Settings.";
  }
  // scope_upgrade_required is handled separately at the compose level — don't remap it
  if (lower.includes('scope_upgrade_required')) return msg;
  return 'Something went wrong with that email action. Try again.';
}

export function slugify(s: string): string {
  return s
    .slice(0, 50)
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

export function parseRecipients(raw: string): string[] {
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

export const filterInputStyle: React.CSSProperties = {
  height: 'var(--kp-control-sm)',
  padding: '0 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  fontSize: 'var(--kp-font-xs)',
  color: 'var(--color-foreground)',
  background: '#fff',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
};
