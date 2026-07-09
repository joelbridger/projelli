import { describe, it, expect } from 'vitest';
import { ONB_COPY } from '@/features/onboarding/v2/copy';

describe('OnboardingV2 trust copy', () => {
  it('leads with the approved intro trust line', () => {
    expect(ONB_COPY.intro.trustLine).toBe(
      'Your files stay on your computer. Cloud AI goes straight to your own provider account, not through us.',
    );
  });

  it('explains why this can be used when public ChatGPT cannot', () => {
    expect(ONB_COPY.compliance.headline).toBe("Why you can use this when you can't use ChatGPT");
    expect(ONB_COPY.compliance.points.join(' ')).toContain('Your files stay on your computer');
    expect(ONB_COPY.compliance.points.join(' ')).toContain(
      'go straight to your own provider account',
    );
  });

  it('frames cloud and on-device AI as two private paths', () => {
    expect(ONB_COPY.ai.modeNote).toContain('your source files stay on your machine');
    expect(ONB_COPY.ai.modeNote).toContain(
      'Cloud AI sends your question and needed context to your own AI account',
    );
    expect(ONB_COPY.ai.modeNote).toContain('On-device AI keeps even the question on this computer');
  });
});
