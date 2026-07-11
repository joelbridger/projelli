import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContradictionDetector } from './ContradictionDetector';
import { SECRET_SCRUB_FIXTURES } from '@/platform/privacy/promptPreparation.fixtures';
import { setPromptDecisionBroker } from '@/platform/privacy/promptPreparation';
import type { Provider } from '@/platform/providers/Provider';

function makeProvider(structuredOutput = vi.fn(() => Promise.resolve({
  contradictions: [], agreementScore: 1, keyDisagreements: [], keyAgreements: [],
}))): Provider {
  return {
    getMetadata: () => ({ providerId: 'anthropic', model: 'test-model' }),
    sendMessage: vi.fn(),
    structuredOutput,
    formatAttachmentForRequest: vi.fn(),
    supportsAttachment: vi.fn(() => false),
  } as unknown as Provider;
}

afterEach(() => { setPromptDecisionBroker(); });

describe('ContradictionDetector prompt preparation', () => {
  it('sends only the redacted answer and records its category', async () => {
    const structuredOutput = vi.fn(() => Promise.resolve({
      contradictions: [], agreementScore: 1, keyDisagreements: [], keyAgreements: [],
    }));
    const audit = vi.fn();
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));

    await new ContradictionDetector(makeProvider(structuredOutput), audit).detect(
      SECRET_SCRUB_FIXTURES.urls,
      'Claude',
      'A safe second answer.',
      'OpenAI',
    );

    expect(structuredOutput).toHaveBeenCalledTimes(1);
    expect((structuredOutput.mock.calls as unknown[][])[0]?.[0]).not.toContain('intake-secret');
    const auditText = JSON.stringify(audit.mock.calls);
    expect(auditText).toContain('prompt_preparation');
    expect(auditText).toContain('redacted_by_user');
    expect(auditText).toContain('intake_link_secret');
    expect(auditText).toContain('"count":1');
  });

  it('does not call the provider when private-link review is cancelled', async () => {
    const structuredOutput = vi.fn();
    setPromptDecisionBroker(() => Promise.resolve('cancel'));

    await expect(new ContradictionDetector(makeProvider(structuredOutput)).detect(
      SECRET_SCRUB_FIXTURES.urls,
      'Claude',
      'A safe second answer.',
      'OpenAI',
    )).rejects.toThrow('prompt_send_cancelled');

    expect(structuredOutput).not.toHaveBeenCalled();
  });
});
