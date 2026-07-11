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
  private readonly seenEventIds = new Set<string>();
  private readonly seenNonces = new Set<string>();

  putLaunch(intakeId: string, ciphertextB64: string): void {
    this.launches.set(intakeId, ciphertextB64);
  }

  getLaunch(intakeId: string): string | null {
    return this.launches.get(intakeId) ?? null;
  }

  deleteLaunch(intakeId: string): void {
    this.launches.delete(intakeId);
  }

  hasSeen(eventId: string, nonce: string): boolean {
    return this.seenEventIds.has(eventId) || this.seenNonces.has(nonce);
  }

  enqueueWakeup(record: SignatureWakeupRecord, nonce: string): boolean {
    if (this.hasSeen(record.event_id, nonce) || isDuplicateSignatureWakeup(this.wakeups.values(), record)) return false;
    this.seenEventIds.add(record.event_id);
    this.seenNonces.add(nonce);
    this.wakeups.set(record.event_id, record);
    return true;
  }

  listWakeups(): SignatureWakeupRecord[] {
    return [...this.wakeups.values()];
  }

  consumeWakeups(eventIds: readonly string[]): number {
    let consumed = 0;
    for (const eventId of eventIds) if (this.wakeups.delete(eventId)) consumed++;
    return consumed;
  }
}
