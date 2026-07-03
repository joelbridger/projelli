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

function fakeProvider(response: string): Provider {
  return {
    getMetadata: () => ({ id: 'fake', name: 'Fake', model: 'fake-model' }) as never,
    sendMessage: vi.fn().mockResolvedValue({ content: response }),
  } as unknown as Provider;
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
    const provider = fakeProvider('should not be used');
    const finalValue = await composeFieldBlend({
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      provider,
    });
    expect(finalValue).toBe('Aggressive');
    expect(provider.sendMessage).not.toHaveBeenCalled();
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
    const provider = fakeProvider('Robert owns a rental property. Retiring spring 2027.');
    const finalValue = await composeFieldBlend({
      field: 'background_information',
      existingValue: 'Robert owns a rental property.',
      newValue: 'Retiring spring 2027.',
      provider,
    });
    expect(finalValue).toBe('Robert owns a rental property. Retiring spring 2027.');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(provider.sendMessage).mock.calls[0]![0];
    expect(prompt).toContain('Merge the new information into the existing text');
    expect(prompt).toContain('Keep every existing fact');
    expect(prompt).toContain('Robert owns a rental property.');
    expect(prompt).toContain('Retiring spring 2027.');
  });

  it('calls onBeforeProviderCall before provider.sendMessage (egress-audit seam)', async () => {
    const order: string[] = [];
    const provider = fakeProvider('merged');
    vi.mocked(provider.sendMessage).mockImplementation(async () => {
      order.push('sendMessage');
      return { content: 'merged' } as never;
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
    await composeFieldBlend({
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      provider: fakeProvider('unused'),
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
