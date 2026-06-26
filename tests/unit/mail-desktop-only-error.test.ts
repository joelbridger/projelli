/**
 * isDesktopOnlyMailError (UX-22).
 *
 * In the web preview the mail wrappers throw "... only available in the desktop
 * app." That is an EXPECTED limitation, not a failure, so the UI must render it
 * as a calm info note rather than a red "Something went wrong" alarm. Only a
 * genuine error keeps the alarm styling.
 */
import { describe, it, expect } from 'vitest';
import { isDesktopOnlyMailError } from '@/platform/utils/mail-commands';

describe('isDesktopOnlyMailError', () => {
  it('classifies the desktop-only connect/sync limitation as an expected (info) state', () => {
    expect(isDesktopOnlyMailError('Email connect is only available in the desktop app.')).toBe(true);
    expect(isDesktopOnlyMailError('Email sync is only available in the desktop app.')).toBe(true);
  });

  it('treats a genuine error as a real error (keeps the alarm tone)', () => {
    expect(isDesktopOnlyMailError('Could not connect. Please try again.')).toBe(false);
    expect(isDesktopOnlyMailError('network timeout')).toBe(false);
  });

  it('handles null/empty defensively', () => {
    expect(isDesktopOnlyMailError(null)).toBe(false);
    expect(isDesktopOnlyMailError('')).toBe(false);
  });
});
