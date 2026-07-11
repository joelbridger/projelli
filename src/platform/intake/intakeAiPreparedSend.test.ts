import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const { runWithEgressAudit } = vi.hoisted(() => ({
  runWithEgressAudit: vi.fn(
    async <T>({ operation }: { operation: () => Promise<T> }): Promise<T> =>
      operation()
  ),
}));

vi.mock('@/platform/privacy/sendWithEgressAudit', () => ({
  runWithEgressAudit,
}));

import { sendPreparedStructuredWithEgressAudit } from './intakeAiPreparedSend';

const intakeDirectory = dirname(fileURLToPath(import.meta.url));

describe('Intake prepared AI send seam', () => {
  it('keeps the prepared structured-send contract while this branch passes through', async () => {
    const structuredOutput = vi.fn().mockResolvedValue({ answer: 'safe' });
    const provider = {
      getMetadata: () => ({ model: 'test-model' }),
      structuredOutput,
    } as never;
    const options = { schema: { type: 'object' as const, properties: {} } };

    await expect(
      sendPreparedStructuredWithEgressAudit({
        provider,
        providerId: 'test-provider',
        surface: 'intake_test',
        prompt: 'test prompt',
        background: true,
        options,
      })
    ).resolves.toEqual({ answer: 'safe' });

    expect(structuredOutput).toHaveBeenCalledWith('test prompt', options);
    expect(runWithEgressAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        providerId: 'test-provider',
        surface: 'intake_test',
        prompt: 'test prompt',
        background: true,
      })
    );
  });

  it.each([
    [
      'nudge rewrite',
      resolve(intakeDirectory, '../../features/intake/NudgeReviewModal.tsx'),
    ],
    [
      'email reply classification',
      resolve(intakeDirectory, 'useEmailReplyIngestion.ts'),
    ],
    [
      'document fact extraction',
      resolve(intakeDirectory, 'documentExtractionEngine.ts'),
    ],
  ])(
    '%s uses the seam instead of calling a provider directly',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');

      expect(source).toContain('sendPreparedStructuredWithEgressAudit');
      expect(source).not.toContain('runWithEgressAudit');
      expect(source).not.toMatch(/\.structuredOutput(?:<[^>]+>)?\s*\(/u);
    }
  );
});
