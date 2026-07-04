import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideWholePracticeSend,
  getRememberedWholePracticeConsent,
  setRememberedWholePracticeConsent,
  REMEMBERED_WHOLE_PRACTICE_KEY,
} from './wholePracticeSendGate';

describe('decideWholePracticeSend (R6 — whole-practice pre-send truth)', () => {
  it('asks for confirmation before a cloud send, with the real client count and provider', () => {
    const d = decideWholePracticeSend({ provider: 'anthropic', clientCount: 12, remembered: false });
    expect(d.needsConfirm).toBe(true);
    expect(d.clientCount).toBe(12);
    expect(d.providerName).toBe('Anthropic');
  });

  it('reports the real provider name for OpenAI', () => {
    expect(decideWholePracticeSend({ provider: 'openai', clientCount: 3, remembered: false }).providerName).toBe('OpenAI');
  });

  it('does NOT confirm in local-only mode (nothing leaves the machine)', () => {
    expect(decideWholePracticeSend({ provider: 'ollama', clientCount: 40, remembered: false }).needsConfirm).toBe(false);
    expect(decideWholePracticeSend({ provider: 'keepance-local', clientCount: 40, remembered: false }).needsConfirm).toBe(false);
  });

  it('does NOT confirm when nothing would be sent (no clients with facts)', () => {
    expect(decideWholePracticeSend({ provider: 'anthropic', clientCount: 0, remembered: false }).needsConfirm).toBe(false);
  });

  it('skips the confirm once the advisor has chosen to remember', () => {
    expect(decideWholePracticeSend({ provider: 'anthropic', clientCount: 5, remembered: true }).needsConfirm).toBe(false);
  });

  it('still confirms (provider name unknown) when the cloud provider is not yet resolved', () => {
    const d = decideWholePracticeSend({ provider: null, clientCount: 5, remembered: false });
    expect(d.needsConfirm).toBe(true);
    expect(d.providerName).toBeNull();
  });
});

describe('remembered whole-practice consent (persisted, default ask)', () => {
  beforeEach(() => { localStorage.removeItem(REMEMBERED_WHOLE_PRACTICE_KEY); });

  it('defaults to ask (not remembered)', () => {
    expect(getRememberedWholePracticeConsent()).toBe(false);
  });

  it('remembers when set, and clears when unset', () => {
    setRememberedWholePracticeConsent(true);
    expect(getRememberedWholePracticeConsent()).toBe(true);
    setRememberedWholePracticeConsent(false);
    expect(getRememberedWholePracticeConsent()).toBe(false);
  });
});
