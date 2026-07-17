export type CrossContextLoad = 'success' | 'failure';

export interface CrossContextIdentity {
  readonly contextA: string;
  readonly contextB: string;
  readonly sameRecordId: string;
  readonly sameFieldId: string;
}

export interface CrossContextProbeValues {
  readonly typedA: string;
  readonly loadedA: readonly string[];
}

export interface CrossContextIsolationInput {
  readonly name: string;
  readonly identity: CrossContextIdentity;
  readonly renderSurface: () => void | Promise<void>;
  readonly typeIntoField: () => CrossContextProbeValues | Promise<CrossContextProbeValues>;
  readonly reseedSameContext: () => void | Promise<void>;
  readonly switchContext: (load: CrossContextLoad) => void | Promise<void>;
  readonly waitForBSuccess: () => void | Promise<void>;
  readonly waitForBFailure: () => void | Promise<void>;
  readonly assertATypedValueVisible: (a: CrossContextProbeValues) => void | Promise<void>;
  readonly assertWithinContextEditPreserved: (a: CrossContextProbeValues) => void | Promise<void>;
  readonly assertBSuccessLoaded: (a: CrossContextProbeValues) => void | Promise<void>;
  readonly assertBFailureIsFailClosed: (a: CrossContextProbeValues) => void | Promise<void>;
  readonly assertNoAContentInFields: (a: CrossContextProbeValues) => void | Promise<void>;
  readonly assertNoAContentInUnderlyingState: (a: CrossContextProbeValues) => void | Promise<void>;
  readonly resolveLateAWrite?: () => void | Promise<void>;
}

function assertValidIdentity({ contextA, contextB, sameRecordId, sameFieldId }: CrossContextIdentity): void {
  if (!contextA.trim() || !contextB.trim() || contextA === contextB) {
    throw new Error('Cross-context isolation requires two different non-empty contexts.');
  }
  if (!sameRecordId.trim() || !sameFieldId.trim()) {
    throw new Error('Cross-context isolation requires deliberately reused record and field IDs.');
  }
}

async function at<T>(name: string, phase: string, callback: () => T | Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: ${phase}: ${reason}`);
  }
}

async function assertNoA(input: CrossContextIsolationInput, values: CrossContextProbeValues, phase: string): Promise<void> {
  await at(input.name, phase, () => input.assertNoAContentInFields(values));
  await at(input.name, phase, () => input.assertNoAContentInUnderlyingState(values));
}

async function freshA(input: CrossContextIsolationInput, phase: string): Promise<CrossContextProbeValues> {
  await at(input.name, phase, input.renderSurface);
  const values = await at(input.name, phase, input.typeIntoField);
  await at(input.name, phase, () => input.assertATypedValueVisible(values));
  return values;
}

/**
 * The only supported cross-context probe for dirty drafts and async prefills.
 * It always proves same-context preservation, successful B isolation, and
 * failed-B fail-closed behaviour using deliberately reused record/field IDs.
 */
export async function assertCrossContextIsolation(input: CrossContextIsolationInput): Promise<void> {
  assertValidIdentity(input.identity);

  const sameContextA = await freshA(input, 'same-context re-seed');
  await at(input.name, 'same-context re-seed', input.reseedSameContext);
  await at(input.name, 'same-context re-seed', () => input.assertWithinContextEditPreserved(sameContextA));

  const successA = await freshA(input, 'B pending');
  await at(input.name, 'B pending', () => input.switchContext('success'));
  await assertNoA(input, successA, 'B pending');
  await at(input.name, 'B loaded', input.waitForBSuccess);
  await at(input.name, 'B loaded', () => input.assertBSuccessLoaded(successA));
  await assertNoA(input, successA, 'B loaded');
  if (input.resolveLateAWrite) {
    await at(input.name, 'late A writer', input.resolveLateAWrite);
    await assertNoA(input, successA, 'late A writer');
  }

  const failedA = await freshA(input, 'B failed');
  await at(input.name, 'B failed', () => input.switchContext('failure'));
  await assertNoA(input, failedA, 'B failed');
  await at(input.name, 'B failed', input.waitForBFailure);
  await at(input.name, 'B failed', () => input.assertBFailureIsFailClosed(failedA));
  await assertNoA(input, failedA, 'B failed');
  if (input.resolveLateAWrite) {
    await at(input.name, 'late A writer', input.resolveLateAWrite);
    await assertNoA(input, failedA, 'late A writer');
  }
}
