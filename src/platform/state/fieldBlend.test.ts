/**
 * fieldBlend.ts — Task 9c: field-level blended CRM updates.
 *
 * Pure blend composer consumed by crmWriteQueueStore when a `kind: 'field'`
 * item is enqueued. Two field shapes:
 *   - scalar (numbers, dates, single-choice): finalValue = newValue, verbatim
 *     replace, no AI call.
 *   - narrative (free text, e.g. Wealthbox's `background_information`):
 *     finalValue = an AI-composed merge that keeps every existing fact and
 *     folds in the new information, via a caller-supplied Provider; a
 *     deterministic `existing + "\n\n" + new` fallback when no provider is
 *     configured, so the store never silently drops content for lack of a
 *     configured AI key.
 *
 * NOT tested here: the real egress-audit entry (resolveEgress + AuditService,
 * per DraftFollowUpModal.tsx's pattern) — that's the CALLER's responsibility.
 * This module only guarantees the SEAM exists (`onBeforeProviderCall` fires
 * before any provider.sendMessage), so the real wiring can hook in without
 * this pure function reaching into React hooks / global confidentiality state.
 */

import { describe, expect, it, vi } from 'vitest';
import { composeFieldBlend, isNarrativeField, WEALTHBOX_NARRATIVE_FIELDS } from './fieldBlend';
import type { Provider } from '@/platform/providers/Provider';

// Returns the mock alongside the provider (rather than letting callers pull
// `provider.sendMessage` back off the object) — referencing a vi.fn() as an
// object METHOD trips @typescript-eslint/unbound-method on every assertion.
function fakeProvider(response: string) {
  const sendMessage = vi.fn().mockResolvedValue({ content: response });
  const provider = {
    getMetadata: () => ({ id: 'fake', name: 'Fake', model: 'fake-model' }) as never,
    sendMessage,
  } as unknown as Provider;
  return { provider, sendMessage };
}

describe('isNarrativeField', () => {
  it('treats background_information as narrative (Wealthbox allowlist)', () => {
    expect(isNarrativeField('background_information')).toBe(true);
  });

  it('treats an unlisted field as scalar (not narrative) by default', () => {
    expect(isNarrativeField('next_review_date')).toBe(false);
    expect(isNarrativeField('risk_tolerance')).toBe(false);
  });

  it('exposes the allowlist so the review card / tests can enumerate it', () => {
    expect(WEALTHBOX_NARRATIVE_FIELDS).toContain('background_information');
  });
});

describe('composeFieldBlend — scalar fields', () => {
  it('replaces outright with the new value, never calling a provider', async () => {
    const { provider, sendMessage } = fakeProvider('should not be used');
    const onBeforeProviderCall = vi.fn();
    const finalValue = await composeFieldBlend({
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      provider,
      onBeforeProviderCall,
    });
    expect(finalValue).toBe('Aggressive');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onBeforeProviderCall).not.toHaveBeenCalled();
  });

  it('replaces outright even when no provider is configured', async () => {
    const finalValue = await composeFieldBlend({
      field: 'next_review_date',
      existingValue: '2026-01-01',
      newValue: '2026-07-01',
    });
    expect(finalValue).toBe('2026-07-01');
  });
});

describe('composeFieldBlend — narrative fields, provider configured', () => {
  it('sends a merge instruction to the provider and returns its response verbatim', async () => {
    const { provider, sendMessage } = fakeProvider('Robert owns a rental property. Retiring spring 2027.');
    const finalValue = await composeFieldBlend({
      field: 'background_information',
      existingValue: 'Robert owns a rental property.',
      newValue: 'Retiring spring 2027.',
      provider,
      onBeforeProviderCall: vi.fn(),
    });
    expect(finalValue).toBe('Robert owns a rental property. Retiring spring 2027.');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const call = sendMessage.mock.calls[0];
    expect(call).toBeDefined();
    const prompt: string = typeof call?.[0] === 'string' ? call[0] : '';
    expect(prompt).toContain('Merge the new information into the existing text');
    expect(prompt).toContain('Keep every existing fact');
    expect(prompt).toContain('Robert owns a rental property.');
    expect(prompt).toContain('Retiring spring 2027.');
  });

  it('calls onBeforeProviderCall before provider.sendMessage (egress-audit seam)', async () => {
    const order: string[] = [];
    const { provider, sendMessage } = fakeProvider('merged');
    sendMessage.mockImplementation(() => {
      order.push('sendMessage');
      return Promise.resolve({ content: 'merged' } as never);
    });
    await composeFieldBlend({
      field: 'background_information',
      existingValue: 'A',
      newValue: 'B',
      provider,
      onBeforeProviderCall: () => { order.push('onBeforeProviderCall'); },
    });
    expect(order).toEqual(['onBeforeProviderCall', 'sendMessage']);
  });

  it('does not call onBeforeProviderCall for a scalar field (no provider call happens)', async () => {
    const onBeforeProviderCall = vi.fn();
    const { provider } = fakeProvider('unused');
    await composeFieldBlend({
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      provider,
      onBeforeProviderCall,
    });
    expect(onBeforeProviderCall).not.toHaveBeenCalled();
  });
});

describe('composeFieldBlend — narrative fields, no provider configured', () => {
  it('falls back to a deterministic existing + blank-line + new concatenation', async () => {
    const finalValue = await composeFieldBlend({
      field: 'background_information',
      existingValue: 'Robert owns a rental property.',
      newValue: 'Retiring spring 2027.',
    });
    expect(finalValue).toBe('Robert owns a rental property.\n\nRetiring spring 2027.');
  });

  it('the fallback is empty-existing-safe (no leading blank line when existing is blank)', async () => {
    const finalValue = await composeFieldBlend({
      field: 'background_information',
      existingValue: '',
      newValue: 'Retiring spring 2027.',
    });
    expect(finalValue).toBe('Retiring spring 2027.');
  });
});

// Codex review catch (P2): the type requires onBeforeProviderCall whenever a
// provider is passed, but Tauri invoke args (and any other JS boundary) are
// NOT type-checked at runtime — the seam that stops an unlogged AI action
// from sending confidential CRM text must fail closed, not just rely on TS.
describe('composeFieldBlend — fails closed if the audit hook is bypassed at runtime', () => {
  it('throws rather than call the provider when onBeforeProviderCall is missing at runtime', async () => {
    const { provider, sendMessage } = fakeProvider('should never be sent');
    const bypassed = { field: 'background_information', existingValue: 'A', newValue: 'B', provider };
    await expect(composeFieldBlend(bypassed as unknown as Parameters<typeof composeFieldBlend>[0])).rejects.toThrow(
      /onBeforeProviderCall is required/,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
