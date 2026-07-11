import { isDocusignCeremonyOutcome, type DocusignCeremonyOutcome } from './origins';

export const DOCUSIGN_SIGNING_MESSAGE_TYPE = 'lantern:docusign-signing-outcome';

export interface DocusignSigningMessage {
  type: typeof DOCUSIGN_SIGNING_MESSAGE_TYPE;
  outcome: DocusignCeremonyOutcome;
}

export function createDocusignSigningMessage(outcome: DocusignCeremonyOutcome): DocusignSigningMessage {
  return { type: DOCUSIGN_SIGNING_MESSAGE_TYPE, outcome };
}

/** Accept exactly the two keys we send. No client or envelope data may ride this handoff. */
export function isDocusignSigningMessage(value: unknown): value is DocusignSigningMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 2
    && keys.includes('type')
    && keys.includes('outcome')
    && record.type === DOCUSIGN_SIGNING_MESSAGE_TYPE
    && isDocusignCeremonyOutcome(record.outcome);
}
