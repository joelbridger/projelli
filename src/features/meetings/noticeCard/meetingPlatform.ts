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

/**
 * Rewrite a Teams meeting join URL to the direct web-client route so the
 * companion webview skips Teams' "Continue on this browser / Join on the Teams
 * app?" launcher chooser entirely (QA-91c, layered fix — this is layer A).
 *
 * The cookieless companion webview (a desktop-style WebView2 UA) always lands on
 * `teams.live.com/dl/launcher/launcher.html` and never clicks through it, so the
 * join stalls. The launcher only appears for the "open the app?" entry routes
 * (`/meet/<id>` on teams.live.com, `/l/meetup-join/...` on teams.microsoft.com).
 * The `/v2/?meetingjoin=true#/...` route loads the web client directly and does
 * not show the chooser. We also carry `anon=true` (anonymous guest join) and
 * `webjoin=true` (layer B — the launcher script honors it if any redirect still
 * bounces through the launcher) inside the hash route.
 *
 * Confidence per the pre-fix research: medium-high, but it relies on a private
 * Teams route, so it is a best-effort PRE-STEP — the adapter's launcher
 * click-through (layer C) remains the guaranteed safety net. Anything this can't
 * confidently rewrite (already-`/v2/`, non-Teams, unparseable, unknown Teams
 * path) is returned UNCHANGED so we never produce a worse URL than we got.
 */
export function rewriteTeamsJoinUrl(joinUrl: string | undefined | null): string {
  const raw = (joinUrl ?? '').trim();
  if (!raw) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw; // not a URL — leave it exactly as-is
  }
  const host = u.hostname.toLowerCase();
  const isLive = host === 'teams.live.com' || host.endsWith('.teams.live.com');
  const isBiz =
    host === 'teams.microsoft.com' ||
    host.endsWith('.teams.microsoft.com') ||
    host === 'teams.microsoft.us' ||
    host.endsWith('.teams.microsoft.us');
  if (!isLive && !isBiz) return raw; // Zoom / Meet / anything else — untouched

  // Already on the direct web route (with or without a hash) — nothing to do.
  if (u.pathname === '/v2/' || u.pathname === '/v2' || u.pathname.startsWith('/v2/')) {
    return raw;
  }

  // Only the two known launcher-triggering entry routes are rewritten.
  const isLiveMeet = isLive && u.pathname.startsWith('/meet/');
  const isBizMeetup = isBiz && u.pathname.startsWith('/l/meetup-join/');
  if (!isLiveMeet && !isBizMeetup) return raw;

  // Merge the original query values into the hash route and add anon/webjoin.
  const params = new URLSearchParams(u.search);
  if (!params.has('anon')) params.set('anon', 'true');
  if (!params.has('webjoin')) params.set('webjoin', 'true');
  const query = params.toString();
  const route = query ? `${u.pathname}?${query}` : u.pathname;
  return `${u.origin}/v2/?meetingjoin=true#${route}`;
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
