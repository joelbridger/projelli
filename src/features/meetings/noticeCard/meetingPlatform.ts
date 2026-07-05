/**
 * Notice Card — platform detection + guest display-name building.
 *
 * Pure, dependency-free helpers shared by the consent dialog, the supervisor,
 * and the join adapters. Platform is derived from the join URL rather than
 * stored, so there is a single source of truth (the calendar's join URL).
 */
import type { NoticeCardPlatform } from './noticeCardTypes';

/**
 * Per-platform maximum length for a guest display name. Teams and Zoom both
 * silently truncate long guest names in the participant list; we truncate
 * ourselves so the honest "⏺ Recording Notice" prefix is what survives, not a
 * dangling firm name. Values are conservative, from bench observation.
 */
export const PLATFORM_NAME_MAX: Record<NoticeCardPlatform, number> = {
  teams: 64,
  zoom: 40,
  meet: 60,
  other: 60,
  none: 60,
};

/** Hostname suffix → platform. Order does not matter; suffixes are disjoint. */
const HOST_SUFFIXES: Array<{ suffix: string; platform: NoticeCardPlatform }> = [
  { suffix: 'teams.microsoft.com', platform: 'teams' },
  { suffix: 'teams.microsoft.us', platform: 'teams' }, // GCC High
  { suffix: 'teams.live.com', platform: 'teams' },
  { suffix: 'zoom.us', platform: 'zoom' },
  { suffix: 'zoomgov.com', platform: 'zoom' },
  { suffix: 'meet.google.com', platform: 'meet' },
];

/**
 * Classify a meeting join URL. Matches on the URL's real hostname (parsed, not
 * substring-searched) so a lookalike like `zoom.us.evil.example` can never be
 * mistaken for Zoom. Anything that parses as a URL but matches no known host is
 * `'other'`; anything that isn't a URL (or is empty) is `'none'`.
 */
export function detectPlatform(joinUrl: string | undefined | null): NoticeCardPlatform {
  const raw = (joinUrl ?? '').trim();
  if (!raw) return 'none';
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return 'none';
  }
  if (!host) return 'none';
  for (const { suffix, platform } of HOST_SUFFIXES) {
    // Real suffix match: exact host, or a dotted subdomain of it. This rejects
    // `zoom.us.evil.example` (host doesn't END with `zoom.us`) and
    // `notzoom.us` (not a dotted subdomain of `zoom.us`).
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return platform;
    }
  }
  return 'other';
}

const DEFAULT_NAME_TEMPLATE = '⏺ Recording Notice — {advisor}';

/**
 * Build the guest display name shown in the participant list. The `{advisor}`
 * token is replaced with the advisor's first name; a blank template falls back
 * to the honest default. The result is trimmed to the platform's length guard,
 * preserving the leading "⏺ Recording Notice" signal (the message that matters
 * even when the tile is a sliver in speaker view).
 */
export function buildDisplayName(
  template: string,
  advisorFirstName: string,
  platform: NoticeCardPlatform,
): string {
  const tmpl = template.trim() || DEFAULT_NAME_TEMPLATE;
  const advisor = advisorFirstName.trim();
  let name = tmpl.replace(/\{advisor\}/g, advisor).trim();
  // Collapse a dangling separator left by an empty advisor name
  // (e.g. "Recording Notice — " → "Recording Notice").
  name = name.replace(/[—\-·:]\s*$/u, '').trim();
  if (!name) name = 'Recording Notice';
  const max = PLATFORM_NAME_MAX[platform];
  if (name.length > max) {
    name = name.slice(0, max).trimEnd();
  }
  return name;
}
