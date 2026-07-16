import {
  intakeFactList,
  intakeFactReveal,
  type MaskedClientFact,
} from '@/platform/intake/factsStore';

/** Narrow, feature-owned façade: lists masked data and reveals one fact only on explicit advisor action. */
export interface SchwabPrivateFacts {
  listMasked(matterId: string): Promise<MaskedClientFact[]>;
  reveal(matterId: string, factId: string): Promise<string>;
}
export const schwabPrivateFacts: SchwabPrivateFacts = {
  listMasked: intakeFactList,
  async reveal(matterId, factId) {
    const fact = await intakeFactReveal(matterId, factId);
    return fact.value.t === 'string' || fact.value.t === 'date'
      ? fact.value.v
      : '';
  },
};
