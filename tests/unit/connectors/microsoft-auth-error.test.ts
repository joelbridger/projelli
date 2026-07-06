/**
 * Fix 4 (connect-flow demo hardening): an expired Microsoft sign-in surfaces
 * through Tauri as one of a handful of Rust sentinel strings
 * (mail/connect.rs, onedrive/commands.rs, mail/graph.rs) — never meant for a
 * screen. isMicrosoftSignInExpiredError recognizes them so MailConnect and
 * OneDriveConnect can show one honest plain-language message instead of the
 * raw string.
 */
import { describe, it, expect } from 'vitest';
import {
  isMicrosoftSignInExpiredError,
  MICROSOFT_SIGNIN_EXPIRED_MESSAGE,
} from '@/platform/connectors/microsoft/microsoftAuthError';

describe('isMicrosoftSignInExpiredError', () => {
  it('recognizes scope_upgrade_required (mail/connect.rs, onedrive/commands.rs)', () => {
    expect(isMicrosoftSignInExpiredError('scope_upgrade_required')).toBe(true);
  });

  it('recognizes a raw invalid_grant from the OAuth exchange', () => {
    expect(isMicrosoftSignInExpiredError('invalid_grant')).toBe(true);
  });

  it('recognizes a "refresh failed: ..." wrapped error (connect.rs, graph.rs)', () => {
    expect(isMicrosoftSignInExpiredError('refresh failed: invalid_grant')).toBe(true);
    expect(
      isMicrosoftSignInExpiredError('Microsoft Graph access token expired and refresh failed: oauth error'),
    ).toBe(true);
  });

  it('recognizes "not connected" (connect.rs / onedrive/commands.rs read failure)', () => {
    expect(isMicrosoftSignInExpiredError('not connected')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMicrosoftSignInExpiredError('SCOPE_UPGRADE_REQUIRED')).toBe(true);
  });

  it('does NOT match an unrelated sync failure', () => {
    expect(isMicrosoftSignInExpiredError('Wealthbox request failed (HTTP 503)')).toBe(false);
    expect(isMicrosoftSignInExpiredError('network timeout')).toBe(false);
    expect(isMicrosoftSignInExpiredError('')).toBe(false);
  });

  it('exports a plain-language, actionable message', () => {
    expect(MICROSOFT_SIGNIN_EXPIRED_MESSAGE).toMatch(/microsoft/i);
    expect(MICROSOFT_SIGNIN_EXPIRED_MESSAGE).toMatch(/reconnect/i);
    expect(MICROSOFT_SIGNIN_EXPIRED_MESSAGE).not.toMatch(/scope_upgrade|invalid_grant|refresh failed/i);
  });
});
