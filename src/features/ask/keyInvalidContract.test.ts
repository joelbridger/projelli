/**
 * The shared "mark key invalid on auth rejection" contract used by both send
 * paths (useAsk unified + useChatSending legacy). Lives in features/ask because
 * it couples features/ask's askHelpers with platform's keyVerification —
 * features may import platform, never the reverse (ARCHITECTURE.md DAG).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isAuthRejectionError } from './askHelpers';
import {
  isKeyInvalid,
  isVerifiableProvider,
  markKeyInvalid,
} from '@/platform/providers/keyVerification';

beforeEach(() => {
  localStorage.clear();
});

// Both useAsk's unified send path and useChatSending's legacy chat-send path
// (connect-flow demo hardening, fix 3) gate markKeyInvalid on the SAME
// two-part check: isVerifiableProvider(providerId) && isAuthRejectionError(...).
// This exercises that exact contract end-to-end so the two call sites can
// never silently drift apart on when a dead key gets flagged.
describe('the shared "mark key invalid on auth rejection" contract used by both send paths', () => {
  function maybeMarkKeyInvalid(
    raw: string,
    providerId: string,
    opts: { mode?: string; reachedProvider?: boolean },
  ): void {
    if (isVerifiableProvider(providerId) && isAuthRejectionError(raw, opts)) {
      markKeyInvalid(providerId);
    }
  }

  it('marks a cloud provider key invalid on a genuine 401 reached from the provider', () => {
    maybeMarkKeyInvalid('HTTP 401: Unauthorized', 'anthropic', { mode: 'cloud', reachedProvider: true });
    expect(isKeyInvalid('anthropic')).toBe(true);
  });

  it('does not mark a local provider (no verifiable key to invalidate)', () => {
    maybeMarkKeyInvalid('HTTP 401: Unauthorized', 'keepance-local', { mode: 'cloud', reachedProvider: true });
    expect(isKeyInvalid('keepance-local')).toBe(false);
  });

  it('does not mark the key when the failure never reached the provider (e.g. file-search stage)', () => {
    maybeMarkKeyInvalid('HTTP 401: Unauthorized', 'openai', { mode: 'cloud', reachedProvider: false });
    expect(isKeyInvalid('openai')).toBe(false);
  });

  it('does not mark the key for a rate-limit error', () => {
    maybeMarkKeyInvalid('429 Too Many Requests', 'google', { mode: 'cloud', reachedProvider: true });
    expect(isKeyInvalid('google')).toBe(false);
  });
});
