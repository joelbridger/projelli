import { describe, expect, it } from 'vitest';
import { buildNetworkEgressReceipt } from '@/platform/privacy/networkEgressReceipt';
import { getEgressOperation } from '@/platform/privacy/egressRegistry';

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
});
