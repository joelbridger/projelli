import type { SchwabAccountType, SchwabFieldKey } from '../mapping';

export interface SchwabPacketReceipt {
  id: string;
  householdId: string;
  accountType: SchwabAccountType;
  approvedAt: string;
  fieldCount: number;
  outputHash: string;
  auditEntryId: string;
  label: 'Schwab prep packet';
}
export interface SchwabPrepPacket {
  receipt: SchwabPacketReceipt;
  values: Readonly<
    Record<
      Exclude<SchwabFieldKey, 'ownerSsn' | 'jointOwnerSsn' | 'custodianSsn'>,
      string
    >
  >;
}
const packetKey = 'lantern:schwab-prep-packets';
function hash(value: string): string {
  let output = 2166136261;
  for (const char of value) {
    output ^= char.charCodeAt(0);
    output = Math.imul(output, 16777619);
  }
  return `sp_${(output >>> 0).toString(16)}`;
}
function read(): SchwabPrepPacket[] {
  try {
    const stored = localStorage.getItem(packetKey);
    return stored ? (JSON.parse(stored) as SchwabPrepPacket[]) : [];
  } catch {
    return [];
  }
}
function write(packets: readonly SchwabPrepPacket[]): void {
  localStorage.setItem(packetKey, JSON.stringify(packets));
}
export function saveApprovedSchwabPacket(input: {
  householdId: string;
  accountType: SchwabAccountType;
  values: Readonly<Record<SchwabFieldKey, string>>;
  auditEntryId: string;
  now?: string;
}): SchwabPrepPacket {
  const values = Object.fromEntries(
    Object.entries(input.values).filter(
      ([key]) => !['ownerSsn', 'jointOwnerSsn', 'custodianSsn'].includes(key)
    )
  ) as SchwabPrepPacket['values'];
  const approvedAt = input.now ?? new Date().toISOString();
  const outputHash = hash(
    JSON.stringify({
      householdId: input.householdId,
      accountType: input.accountType,
      values,
      approvedAt,
    })
  );
  const packet: SchwabPrepPacket = {
    values,
    receipt: {
      id: `schwab-packet-${outputHash}`,
      householdId: input.householdId,
      accountType: input.accountType,
      approvedAt,
      fieldCount: Object.keys(values).length,
      outputHash,
      auditEntryId: input.auditEntryId,
      label: 'Schwab prep packet',
    },
  };
  write([...read(), packet]);
  return packet;
}
export function findSchwabPacketReceipt(
  householdId: string
): SchwabPacketReceipt | undefined {
  return read().find((packet) => packet.receipt.householdId === householdId)
    ?.receipt;
}
