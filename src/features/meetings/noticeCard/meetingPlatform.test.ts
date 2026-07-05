import { describe, it, expect } from 'vitest';
import { detectPlatform, buildDisplayName, PLATFORM_NAME_MAX } from './meetingPlatform';

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
    expect(detectPlatform('https://whereby.com/keepance-room')).toBe('other');
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
    const template = 'Recording Notice for {advisor} from Keepance Advisory Group LLC';
    const teams = buildDisplayName(template, longName, 'teams');
    const zoom = buildDisplayName(template, longName, 'zoom');
    expect(teams.length).toBeLessThanOrEqual(PLATFORM_NAME_MAX.teams);
    expect(zoom.length).toBeLessThanOrEqual(PLATFORM_NAME_MAX.zoom);
  });

  it('never emits an empty name even with empty advisor + template', () => {
    expect(buildDisplayName('', '', 'other').length).toBeGreaterThan(0);
  });
});
