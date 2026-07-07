import { describe, it, expect } from 'vitest';
import {
  detectPlatform,
  buildDisplayName,
  PLATFORM_NAME_MAX,
  rewriteTeamsJoinUrl,
} from './meetingPlatform';

describe('detectPlatform', () => {
  it('classifies Microsoft Teams URLs (consumer, work, GCC)', () => {
    for (const url of [
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0',
      'https://teams.live.com/meet/9876543210',
      'https://teams.microsoft.us/l/meetup-join/xyz', // GCC High
      'HTTPS://TEAMS.MICROSOFT.COM/L/MEETUP-JOIN/UPPER', // case-insensitive
    ]) {
      expect(detectPlatform(url), url).toBe('teams');
    }
  });

  it('classifies Zoom URLs (regular, vanity, gov)', () => {
    for (const url of [
      'https://zoom.us/j/1234567890?pwd=abcdef',
      'https://acme.zoom.us/j/98765?pwd=xyz',
      'https://us02web.zoom.us/w/1122334455',
      'https://zoomgov.com/j/5566778899',
    ]) {
      expect(detectPlatform(url), url).toBe('zoom');
    }
  });

  it('classifies Google Meet URLs', () => {
    expect(detectPlatform('https://meet.google.com/abc-defg-hij')).toBe('meet');
  });

  it('returns other for a URL it cannot classify', () => {
    expect(detectPlatform('https://whereby.com/lantern-room')).toBe('other');
    expect(detectPlatform('https://example.com/join/123')).toBe('other');
  });

  it('returns none for empty / missing / non-URL input', () => {
    expect(detectPlatform('')).toBe('none');
    expect(detectPlatform(undefined)).toBe('none');
    expect(detectPlatform('   ')).toBe('none');
    expect(detectPlatform('not a url at all')).toBe('none');
  });

  it('does not misclassify a lookalike hostname (phishing guard)', () => {
    // Substring of "zoom.us" inside another host must NOT count as Zoom.
    expect(detectPlatform('https://zoom.us.evil.example/j/1')).not.toBe('zoom');
    // The domain has to be zoom.us as a real registrable suffix.
    expect(detectPlatform('https://notzoom.us/j/1')).toBe('other');
  });
});

describe('buildDisplayName', () => {
  it('fills the {advisor} token with the advisor first name', () => {
    expect(buildDisplayName('⏺ Recording Notice — {advisor}', 'Sarah', 'teams')).toBe(
      '⏺ Recording Notice — Sarah',
    );
  });

  it('falls back to a sane default when the template is blank', () => {
    const name = buildDisplayName('', 'Sarah', 'teams');
    expect(name).toContain('Sarah');
    expect(name).toContain('Recording Notice');
  });

  it('trims to the per-platform length guard without cutting mid-token ugliness', () => {
    const longName = 'Bartholomew-Alexander';
    const template = 'Recording Notice for {advisor} from Lantern Advisory Group LLC';
    const teams = buildDisplayName(template, longName, 'teams');
    const zoom = buildDisplayName(template, longName, 'zoom');
    expect(teams.length).toBeLessThanOrEqual(PLATFORM_NAME_MAX.teams);
    expect(zoom.length).toBeLessThanOrEqual(PLATFORM_NAME_MAX.zoom);
  });

  it('never emits an empty name even with empty advisor + template', () => {
    expect(buildDisplayName('', '', 'other').length).toBeGreaterThan(0);
  });
});

describe('rewriteTeamsJoinUrl — skip the launcher chooser (QA-91c layer A/B)', () => {
  it('rewrites a teams.live.com /meet link (with passcode) to the direct /v2 web route', () => {
    const out = rewriteTeamsJoinUrl('https://teams.live.com/meet/9389551917420?p=8VYLFM69kqjm7i3oVW');
    expect(out).toBe(
      'https://teams.live.com/v2/?meetingjoin=true#/meet/9389551917420?p=8VYLFM69kqjm7i3oVW&anon=true&webjoin=true',
    );
    // sanity: still a valid URL and the passcode survives inside the hash route
    expect(new URL(out).hash).toContain('p=8VYLFM69kqjm7i3oVW');
  });

  it('rewrites a teams.live.com /meet link WITHOUT a passcode and still adds anon+webjoin', () => {
    const out = rewriteTeamsJoinUrl('https://teams.live.com/meet/9389551917420');
    expect(out).toBe(
      'https://teams.live.com/v2/?meetingjoin=true#/meet/9389551917420?anon=true&webjoin=true',
    );
  });

  it('rewrites a teams.microsoft.com /l/meetup-join business link, preserving context', () => {
    const out = rewriteTeamsJoinUrl(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7B%22Tid%22%3A%22x%22%7D',
    );
    expect(out.startsWith('https://teams.microsoft.com/v2/?meetingjoin=true#/l/meetup-join/')).toBe(true);
    expect(out).toContain('context=');
    expect(out).toContain('anon=true');
    expect(out).toContain('webjoin=true');
  });

  it('does not double-add anon / webjoin when they are already present', () => {
    const out = rewriteTeamsJoinUrl('https://teams.live.com/meet/123?anon=true&webjoin=true');
    expect(out).toBe('https://teams.live.com/v2/?meetingjoin=true#/meet/123?anon=true&webjoin=true');
    expect(out.match(/anon=true/g)).toHaveLength(1);
    expect(out.match(/webjoin=true/g)).toHaveLength(1);
  });

  it('passes an already-/v2/ direct link through unchanged (no double rewrite)', () => {
    const already = 'https://teams.live.com/v2/?meetingjoin=true#/meet/123?anon=true';
    expect(rewriteTeamsJoinUrl(already)).toBe(already);
  });

  it('leaves non-Teams links (Zoom, Meet) untouched', () => {
    const zoom = 'https://zoom.us/j/1234567890?pwd=abc';
    const meet = 'https://meet.google.com/abc-defg-hij';
    expect(rewriteTeamsJoinUrl(zoom)).toBe(zoom);
    expect(rewriteTeamsJoinUrl(meet)).toBe(meet);
  });

  it('leaves an unknown Teams path untouched (only /meet and /l/meetup-join are rewritten)', () => {
    const other = 'https://teams.live.com/dl/launcher/launcher.html?url=%2Fmeet%2F123';
    expect(rewriteTeamsJoinUrl(other)).toBe(other);
  });

  it('returns non-URL / empty input unchanged', () => {
    expect(rewriteTeamsJoinUrl('')).toBe('');
    expect(rewriteTeamsJoinUrl('   ')).toBe('');
    expect(rewriteTeamsJoinUrl('not a url')).toBe('not a url');
    expect(rewriteTeamsJoinUrl(null)).toBe('');
    expect(rewriteTeamsJoinUrl(undefined)).toBe('');
  });
});
