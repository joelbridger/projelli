/**
 * fieldBlend.ts — Task 9c: field-level blended CRM updates.
 *
 * Pure blend composer consumed by crmWriteQueueStore when a `kind: 'field'`
 * item is enqueued. Two field shapes:
 *   - scalar (numbers, dates, single-choice): finalValue = newValue, verbatim
 *     replace, no AI call.
 *   - narrative (free text, e.g. Wealthbox's `background_information`):
 *     finalValue = an AI-composed merge that keeps every existing fact and
 *     folds in the new information, via a caller-supplied audited send
 *     function; a
 *     deterministic `existing + "\n\n" + new` fallback when no provider is
 *     configured, so the store never silently drops content for lack of a
 *     configured AI key.
 *
 * NOT tested here: the real egress-audit entry — that's the caller's
 * responsibility. This pure function only accepts an already-audited sender.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  composeFieldBlend,
  isNarrativeField,
  WEALTHBOX_NARRATIVE_FIELDS,
  type PreparedFieldBlendRequest,
} from './fieldBlend';

function fakeSender(response: string) {
  const requests: PreparedFieldBlendRequest[] = [];
  const send = vi.fn((request: PreparedFieldBlendRequest): Promise<string> => {
    requests.push(request);
    return Promise.resolve(response);
  });
  return { send, requests };
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
  it('replaces outright with the new value, never calling the sender', async () => {
    const { send } = fakeSender('should not be used');
    const finalValue = await composeFieldBlend({
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      send,
    });
    expect(finalValue).toBe('Aggressive');
    expect(send).not.toHaveBeenCalled();
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

describe('composeFieldBlend — narrative fields, audited sender configured', () => {
  it('sends a merge instruction to the audited sender and returns its response verbatim', async () => {
    const { send, requests } = fakeSender('Robert owns a rental property. Retiring spring 2027.');
    const finalValue = await composeFieldBlend({
      field: 'background_information',
      existingValue: 'Robert owns a rental property.',
      newValue: 'Retiring spring 2027.',
      send,
    });
    expect(finalValue).toBe('Robert owns a rental property. Retiring spring 2027.');
    expect(send).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request).toBeDefined();
    expect(request?.prompt).toContain('Merge the new information into the existing text');
    expect(request?.prompt).toContain('Keep every existing fact');
    expect(request?.prompt).toContain('Robert owns a rental property.');
    expect(request?.prompt).toContain('Retiring spring 2027.');
    expect(request).toMatchObject({ surface: 'crm_field_blend', background: true });
  });

  it('does not call the sender for a scalar field', async () => {
    const { send } = fakeSender('unused');
    await composeFieldBlend({
      field: 'risk_tolerance',
      existingValue: 'Moderate',
      newValue: 'Aggressive',
      send,
    });
    expect(send).not.toHaveBeenCalled();
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
