import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { sendPreparedStructuredWithEgressAudit as realSendPreparedStructuredWithEgressAudit } from '@/platform/privacy/promptPreparation';
import { sendPreparedStructuredWithEgressAudit } from './intakeAiPreparedSend';

const intakeDirectory = dirname(fileURLToPath(import.meta.url));

describe('Intake prepared AI send seam', () => {
  it('forwards to the real prompt-preparation export, not a local reimplementation', () => {
    // The seam's own pass-through was replaced at fold time (was previously
    // covered by its own contract test here, mocking runWithEgressAudit
    // directly - that behavior now lives in promptPreparation.ts and is
    // covered by its own dedicated test suite, promptPreparation.test.ts).
    // Reference equality is the strongest proof this file is a pure
    // re-export and not a drifted copy.
    expect(sendPreparedStructuredWithEgressAudit).toBe(realSendPreparedStructuredWithEgressAudit);
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
