/**
 * Dedicated in-memory broker state. It is intentionally not the intake Store:
 * launch ciphertext stays opaque and completion signals carry no client map or
 * document data. A restart safely drops volatile wake-ups; advisor direct
 * polling remains the durable recovery path.
 */

export const MAX_SIGNATURE_LAUNCH_BYTES = 64 * 1024;

export interface SignatureWakeupRecord {
  envelope_id: string;
  event_type: "completed";
  event_id: string;
  at: string;
}

export function isDuplicateSignatureWakeup(records: Iterable<SignatureWakeupRecord>, candidate: Pick<SignatureWakeupRecord, "event_id">): boolean {
  for (const record of records) if (record.event_id === candidate.event_id) return true;
  return false;
}

export class BlindSigningBrokerStore {
  private readonly launches = new Map<string, string>();
  private readonly wakeups = new Map<string, SignatureWakeupRecord>();
  private readonly envelopeOwners = new Map<string, string>();
  private readonly seenReplayKeys = new Set<string>();

  putLaunch(intakeId: string, ciphertextB64: string): void {
    this.launches.set(intakeId, ciphertextB64);
  }

  getLaunch(intakeId: string): string | null {
    return this.launches.get(intakeId) ?? null;
  }

  deleteLaunch(intakeId: string): void {
    this.launches.delete(intakeId);
  }

  /** Register only an opaque DocuSign envelope ID. No document or client data enters the broker. */
  registerEnvelope(intakeId: string, envelopeId: string): void {
    const existingOwner = this.envelopeOwners.get(envelopeId);
    if (existingOwner && existingOwner !== intakeId) throw new Error("envelope_already_registered");
    this.envelopeOwners.set(envelopeId, intakeId);
  }

  hasSeen(replayKey: string): boolean {
    return this.seenReplayKeys.has(replayKey);
  }

  enqueueWakeup(record: SignatureWakeupRecord, replayKey: string): boolean {
    if (this.hasSeen(replayKey) || isDuplicateSignatureWakeup(this.wakeups.values(), record)) return false;
    this.seenReplayKeys.add(replayKey);
    this.wakeups.set(record.event_id, record);
    return true;
  }

  listWakeups(intakeId: string): SignatureWakeupRecord[] {
    return [...this.wakeups.values()].filter((record) => this.envelopeOwners.get(record.envelope_id) === intakeId);
  }

  consumeWakeups(intakeId: string, eventIds: readonly string[]): number {
    let consumed = 0;
    for (const eventId of eventIds) {
      const wakeup = this.wakeups.get(eventId);
      if (wakeup && this.envelopeOwners.get(wakeup.envelope_id) === intakeId && this.wakeups.delete(eventId)) consumed++;
    }
    return consumed;
  }
}
