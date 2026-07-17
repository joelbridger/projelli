import { describe, expect, it, vi } from 'vitest';
import { assertCrossContextIsolation, type CrossContextIsolationInput } from './index';

function fixture(overrides: Partial<CrossContextIsolationInput> = {}): CrossContextIsolationInput {
  const phases: string[] = [];
  const values = { typedA: 'A typed marker', loadedA: ['A loaded marker'] };
  return {
    name: 'tiny fixture',
    identity: { contextA: 'A', contextB: 'B', sameRecordId: 'same-record', sameFieldId: 'same-field' },
    renderSurface: () => { phases.push('render'); },
    typeIntoField: () => { phases.push('type'); return values; },
    reseedSameContext: () => { phases.push('reseed'); },
    switchContext: (load) => { phases.push(`switch:${load}`); },
    waitForBSuccess: () => { phases.push('success'); },
    waitForBFailure: () => { phases.push('failure'); },
    assertATypedValueVisible: () => { phases.push('A visible'); },
    assertWithinContextEditPreserved: () => { phases.push('preserved'); },
    assertBSuccessLoaded: () => { phases.push('B loaded'); },
    assertBFailureIsFailClosed: () => { phases.push('B closed'); },
    assertNoAContentInFields: () => { phases.push('no fields'); },
    assertNoAContentInUnderlyingState: () => { phases.push('no state'); },
    ...overrides,
  };
}

describe('assertCrossContextIsolation', () => {
  it('runs the complete same-context, successful-B, and failed-B probe in order', async () => {
    const steps: string[] = [];
    const input = fixture();
    for (const [key, callback] of Object.entries(input)) {
      if (typeof callback === 'function') {
        (input as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
          steps.push(key === 'switchContext' ? `${key}:${String(args[0])}` : key);
          return Reflect.apply(callback, undefined, args);
        };
      }
    }
    await assertCrossContextIsolation(input);
    expect(steps).toEqual([
      'renderSurface', 'typeIntoField', 'assertATypedValueVisible', 'reseedSameContext', 'assertWithinContextEditPreserved',
      'renderSurface', 'typeIntoField', 'assertATypedValueVisible', 'switchContext:success', 'assertNoAContentInFields', 'assertNoAContentInUnderlyingState', 'waitForBSuccess', 'assertBSuccessLoaded', 'assertNoAContentInFields', 'assertNoAContentInUnderlyingState',
      'renderSurface', 'typeIntoField', 'assertATypedValueVisible', 'switchContext:failure', 'assertNoAContentInFields', 'assertNoAContentInUnderlyingState', 'waitForBFailure', 'assertBFailureIsFailClosed', 'assertNoAContentInFields', 'assertNoAContentInUnderlyingState',
    ]);
  });

  it('rejects each invalid adversarial identity before rendering', async () => {
    const renderSurface = vi.fn();
    await expect(assertCrossContextIsolation(fixture({ identity: { contextA: 'A', contextB: 'A', sameRecordId: 'same-record', sameFieldId: 'same-field' }, renderSurface }))).rejects.toThrow(/different non-empty contexts/i);
    await expect(assertCrossContextIsolation(fixture({ identity: { contextA: 'A', contextB: 'B', sameRecordId: '', sameFieldId: 'same-field' }, renderSurface }))).rejects.toThrow(/reused record and field IDs/i);
    await expect(assertCrossContextIsolation(fixture({ identity: { contextA: 'A', contextB: 'B', sameRecordId: 'same-record', sameFieldId: '' }, renderSurface }))).rejects.toThrow(/reused record and field IDs/i);
    expect(renderSurface).not.toHaveBeenCalled();
  });

  it('fails when A survives only in a live textarea value', async () => {
    const leaked = document.createElement('textarea');
    leaked.value = 'A typed marker';
    document.body.append(leaked);
    try {
      await expect(assertCrossContextIsolation(fixture())).rejects.toThrow(/B pending: A marker survived in live textarea value/i);
    } finally {
      leaked.remove();
    }
  });

  it('fails if successful B is empty rather than loaded', async () => {
    await expect(assertCrossContextIsolation(fixture({ assertBSuccessLoaded: () => { throw new Error('empty B'); } }))).rejects.toThrow(/B loaded: empty B/);
  });

  it('fails if A remains in B fields', async () => {
    let calls = 0;
    await expect(assertCrossContextIsolation(fixture({ assertNoAContentInFields: () => { calls += 1; if (calls === 1) throw new Error('A leaked into a control'); } }))).rejects.toThrow(/B pending: A leaked/);
  });

  it('fails if a hidden A draft remains after the DOM is clear', async () => {
    let calls = 0;
    await expect(assertCrossContextIsolation(fixture({ assertNoAContentInUnderlyingState: () => { calls += 1; if (calls === 1) throw new Error('A draft survived'); } }))).rejects.toThrow(/B pending: A draft survived/);
  });

  it('fails if failed B is not fail-closed', async () => {
    await expect(assertCrossContextIsolation(fixture({ assertBFailureIsFailClosed: () => { throw new Error('B still usable'); } }))).rejects.toThrow(/B failed: B still usable/);
  });
});
