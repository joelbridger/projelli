import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildApprovedSchwabPacket,
  findSchwabPacketReceipt,
  saveApprovedSchwabPacket,
} from './index';

beforeEach(() => {
  localStorage.clear();
});
describe('Schwab prep packets', () => {
  it('persists a redacted approved receipt across reload lookup', () => {
    const prepared = buildApprovedSchwabPacket({
      householdId: 'h1',
      accountType: 'individual',
      now: '2026-07-16T00:00:00.000Z',
      values: {
        ownerName: 'Alex',
        ownerDob: '1980-01-01',
        ownerSsn: '123-45-6789',
        jointOwnerName: '',
        jointOwnerDob: '',
        jointOwnerSsn: '',
        address: '1 Main',
        email: 'alex@example.test',
        phone: '555',
        fundingSource: 'cash',
        beneficiaries: '',
        iraContributionYear: '',
        decedentName: '',
        decedentDob: '',
        trustName: '',
        trustDate: '',
        trusteeName: '',
        trusteeEmail: '',
        minorName: '',
        minorDob: '',
        custodianName: '',
        custodianSsn: '',
      },
    });
    const packet = saveApprovedSchwabPacket(prepared, 'audit-1');
    expect(JSON.stringify(localStorage)).not.toContain('123-45-6789');
    expect(findSchwabPacketReceipt('h1', 'individual')).toEqual(packet.receipt);
    expect(packet.values).not.toHaveProperty('ownerSsn');
  });
  it('keeps a separate receipt for each account type in one household', () => {
    const values = {
      ownerName: 'Alex',
      ownerDob: '',
      ownerSsn: '',
      jointOwnerName: '',
      jointOwnerDob: '',
      jointOwnerSsn: '',
      address: '',
      email: '',
      phone: '',
      fundingSource: '',
      beneficiaries: '',
      iraContributionYear: '',
      decedentName: '',
      decedentDob: '',
      trustName: '',
      trustDate: '',
      trusteeName: '',
      trusteeEmail: '',
      minorName: '',
      minorDob: '',
      custodianName: '',
      custodianSsn: '',
    };
    const individual = saveApprovedSchwabPacket(
      buildApprovedSchwabPacket({
        householdId: 'h1',
        accountType: 'individual',
        values,
      }),
      'audit-individual'
    );
    const roth = saveApprovedSchwabPacket(
      buildApprovedSchwabPacket({
        householdId: 'h1',
        accountType: 'roth-ira',
        values,
      }),
      'audit-roth'
    );
    expect(findSchwabPacketReceipt('h1', 'individual')).toEqual(
      individual.receipt
    );
    expect(findSchwabPacketReceipt('h1', 'roth-ira')).toEqual(roth.receipt);
  });
});
