import { describe, expect, it } from 'vitest';
import { buildNetworkEgressReceipt } from '@/platform/privacy/networkEgressReceipt';
import { EGRESS_OPERATIONS, getEgressOperation } from '@/platform/privacy/egressRegistry';

describe('network egress receipts', () => {
  it('records required safe fields for an allowed network action', () => {
    const operation = getEgressOperation('cloud-ai');
    expect(operation).toBeDefined();
    const receipt = buildNetworkEgressReceipt(
      operation!,
      new URL('https://api.openai.com/v1/chat/completions'),
      7,
      false,
      'completed',
    );
    expect(receipt).toMatchObject({
      version: 1,
      policyGeneration: 7,
      operationId: 'cloud-ai',
      operationLabel: 'cloud AI',
      destinationClass: 'cloud-ai',
      destination: 'api.openai.com',
      result: 'completed',
      offlineMode: false,
      dataClasses: { content: true, metadata: true, credential: true, binaryDownload: false },
    });
    expect(JSON.stringify(receipt)).not.toContain('/v1/chat/completions');
  });

  it('records a safe blocked-before-network result without request content', () => {
    const operation = getEgressOperation('telemetry');
    const receipt = buildNetworkEgressReceipt(
      operation!,
      new URL('https://forms.lanternplatform.app/api/forms/secret'),
      8,
      true,
      'blocked-before-network',
      Object.assign(new Error('secret server response'), { name: 'OfflineModeBlockedError' }),
    );
    expect(receipt).toMatchObject({
      result: 'blocked-before-network',
      offlineMode: true,
      failureCode: 'OFFLINE_MODE_BLOCKED',
      destination: 'forms.lanternplatform.app',
    });
    expect(JSON.stringify(receipt)).not.toContain('secret');
  });

  it('can make a safe receipt for every renderer registry operation', () => {
    for (const operation of EGRESS_OPERATIONS.values()) {
      // Navigation destinations are chosen by the advisor at click time, so
      // the registry deliberately has no static host for this operation.
      const host = operation.allowedHosts[0] ?? 'advisor.example';
      const destination = new URL(
        host === '::1' ? 'http://[::1]/not-in-receipt' : `https://${host}/not-in-receipt`
      );
      const receipt = buildNetworkEgressReceipt(
        operation,
        destination,
        99,
        false,
        'completed'
      );
      expect(receipt).toMatchObject({
        operationId: operation.id,
        operationLabel: operation.receiptLabel,
        destination: host,
      });
      expect(JSON.stringify(receipt)).not.toContain('not-in-receipt');
    }
  });

  it('records an absent synthetic destination as null, never the string "undefined"', () => {
    const operation = getEgressOperation('external-navigation');
    const receipt = buildNetworkEgressReceipt(operation!, undefined, 99, false, 'blocked-before-network');

    expect(receipt.destination).toBeNull();
    expect(JSON.stringify(receipt)).not.toContain('undefined');
  });
});
