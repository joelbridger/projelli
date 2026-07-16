import { describe, expect, it } from 'vitest';
import {
  evaluateGrantedCapability,
  normalizeGrantedScopes,
  writeConsentScopeRequest,
} from './scopeEvaluation';

describe('writeConsentScopeRequest', () => {
  it('asks Outlook for calendar write plus the offline access needed to refresh', () => {
    const scopes = writeConsentScopeRequest('outlook');
    expect(scopes).toContain('Calendars.ReadWrite');
    expect(scopes).toContain('offline_access');
  });

  it('never asks Outlook for shared-calendar write, which SC-014 forbids', () => {
    expect(writeConsentScopeRequest('outlook')).not.toContain('Calendars.ReadWrite.Shared');
  });

  it('asks Google for event write while keeping the existing read scope', () => {
    const scopes = writeConsentScopeRequest('google');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events');
    // Upgrading must never silently narrow what already worked.
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
  });

  it('never asks Google for the full calendar-management scope', () => {
    // calendar.events is the least privilege that can create/update an event.
    expect(writeConsentScopeRequest('google')).not.toContain(
      'https://www.googleapis.com/auth/calendar',
    );
  });

  it('never asks either provider for mail or drive scopes', () => {
    const all = [...writeConsentScopeRequest('outlook'), ...writeConsentScopeRequest('google')];
    for (const scope of all) {
      expect(scope).not.toMatch(/Mail\.|Files\.|gmail\.|auth\/drive/);
    }
  });
});

describe('normalizeGrantedScopes', () => {
  it('accepts a space-delimited scope string as providers actually return it', () => {
    const scopes = normalizeGrantedScopes('outlook', 'openid Calendars.ReadWrite offline_access');
    expect(scopes).toContain('Calendars.ReadWrite');
  });

  it('strips the Graph resource prefix Microsoft sometimes echoes back', () => {
    const scopes = normalizeGrantedScopes('outlook', [
      'https://graph.microsoft.com/Calendars.ReadWrite',
    ]);
    expect(scopes).toContain('Calendars.ReadWrite');
  });

  it('matches Outlook scopes case-insensitively, as Entra treats them', () => {
    const scopes = normalizeGrantedScopes('outlook', ['calendars.readwrite']);
    expect(scopes).toContain('Calendars.ReadWrite');
  });

  it('drops any scope token it does not recognize', () => {
    // The provider response is untrusted input. Anything unrecognized is
    // dropped rather than carried into a grant or a receipt.
    const scopes = normalizeGrantedScopes('outlook', [
      'Calendars.ReadWrite',
      'Some.Unknown.Scope',
      'ya29.a0AfB_by-not-a-scope-but-a-token',
    ]);
    expect(scopes).toEqual(['Calendars.ReadWrite']);
  });

  it('returns nothing for an empty or absent grant', () => {
    expect(normalizeGrantedScopes('google', '')).toEqual([]);
    expect(normalizeGrantedScopes('google', [])).toEqual([]);
  });
});

describe('evaluateGrantedCapability', () => {
  it('reports write when Outlook granted calendar write', () => {
    expect(evaluateGrantedCapability('outlook', ['Calendars.ReadWrite'])).toBe('write');
  });

  it('reports write when Google granted event write', () => {
    expect(
      evaluateGrantedCapability('google', ['https://www.googleapis.com/auth/calendar.events']),
    ).toBe('write');
  });

  it('reports read when Outlook granted only calendar read', () => {
    expect(evaluateGrantedCapability('outlook', ['Calendars.Read'])).toBe('read');
  });

  it('does not mistake Calendars.ReadBasic for write', () => {
    expect(evaluateGrantedCapability('outlook', ['Calendars.ReadBasic'])).toBe('read');
  });

  it('does not mistake Google calendar.events.readonly for event write', () => {
    // The readonly scope string CONTAINS the write scope string. A substring
    // check here would hand out write on a read-only grant.
    expect(
      evaluateGrantedCapability('google', [
        'https://www.googleapis.com/auth/calendar.events.readonly',
      ]),
    ).toBe('read');
  });

  it('does not mistake Google calendar.readonly for write', () => {
    expect(
      evaluateGrantedCapability('google', ['https://www.googleapis.com/auth/calendar.readonly']),
    ).toBe('read');
  });

  it('fails closed to read when the provider reported no scopes at all', () => {
    expect(evaluateGrantedCapability('outlook', [])).toBe('read');
    expect(evaluateGrantedCapability('google', [])).toBe('read');
  });

  it('reports read when Google granted read but the user unchecked the write box', () => {
    // Google's incremental consent lets a person approve a subset.
    expect(
      evaluateGrantedCapability('google', [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.readonly',
      ]),
    ).toBe('read');
  });
});
