/**
 * friendlyErrorMessage — mode- and stage-aware Ask error copy (UX-29).
 *
 * The old catch-all said "check your key" for ANY unmatched error — even when
 * the provider returned 200 OK (the real cause was the local search index) and
 * even in Local-only mode where there is no key at all. The message must:
 *   - say "key" ONLY for a genuine auth (401) error,
 *   - tell a Local-only user their data stayed on the machine,
 *   - name the real cause (searching your files / index) when the AI was never
 *     reached, and
 *   - always offer the "search by keyword instead" fallback.
 */
import { describe, it, expect } from 'vitest';
import { friendlyErrorMessage } from '@/features/ask/askHelpers';

describe('friendlyErrorMessage', () => {
  it('mentions the key ONLY for a genuine auth error (cloud)', () => {
    const msg = friendlyErrorMessage('401 Unauthorized: invalid_api_key', {
      mode: 'direct',
      reachedProvider: true,
    });
    expect(msg).toMatch(/\bkey\b/i);
    expect(msg).toMatch(/settings/i);
  });

  it('never blames the key in Local-only mode (there is no key)', () => {
    // Even an auth-shaped raw string must not tell a private-mode user to "check
    // your key" — the most damaging contradiction for the privacy persona.
    const msg = friendlyErrorMessage('401 unauthorized', {
      mode: 'local-only',
      reachedProvider: true,
    });
    expect(msg).not.toMatch(/\bkey\b/i);
    expect(msg).toMatch(/your machine|on your computer/i);
  });

  it('does NOT say "key" when the AI was never reached (index/search stage)', () => {
    // The exact bug: provider returned OK, but retrieval failed before the call.
    const msg = friendlyErrorMessage('index not ready', {
      mode: 'direct',
      reachedProvider: false,
    });
    expect(msg).not.toMatch(/\bkey\b/i);
    expect(msg).toMatch(/search your files|still be setting up/i);
    expect(msg).toMatch(/keyword/i);
  });

  it('does NOT blame the key for an auth-shaped error if the AI was never reached (Codex review)', () => {
    // A 401-shaped string can surface from a pre-provider stage; with
    // reachedProvider=false it must be treated as a search-stage failure.
    const msg = friendlyErrorMessage('401 unauthorized', {
      mode: 'direct',
      reachedProvider: false,
    });
    expect(msg).not.toMatch(/\bkey\b/i);
    expect(msg).toMatch(/search your files|still be setting up/i);
  });

  it('offers a "search by keyword instead" fallback on a generic cloud failure', () => {
    const msg = friendlyErrorMessage('socket hang up', {
      mode: 'direct',
      reachedProvider: true,
    });
    expect(msg).not.toMatch(/\bkey\b/i);
    expect(msg).toMatch(/keyword/i);
  });

  it('reassures a Local-only user their data stayed on the machine on a generic failure', () => {
    const msg = friendlyErrorMessage('model crashed', {
      mode: 'local-only',
      reachedProvider: true,
    });
    expect(msg).not.toMatch(/\bkey\b/i);
    expect(msg).toMatch(/your machine|on your computer/i);
  });

  it('keeps the rate-limit and context-length buckets', () => {
    expect(friendlyErrorMessage('429 rate limit', { mode: 'direct' })).toMatch(/usage limit|wait/i);
    expect(friendlyErrorMessage('maximum context length exceeded', { mode: 'direct' })).toMatch(/too long/i);
  });

  it('still works with no options (back-compat) and does not falsely blame the key', () => {
    const msg = friendlyErrorMessage('something odd');
    expect(msg).not.toMatch(/check your key/i);
  });
});
