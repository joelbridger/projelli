import { describe, it, expect } from 'vitest';
import { ONB_COPY } from '@/features/onboarding/v2/copy';

describe('OnboardingV2 trust copy', () => {
  it('leads with the approved intro trust line', () => {
    expect(ONB_COPY.intro.trustLine).toBe(
      "Your client data never touches our servers, the cloud, or any AI's training. Ever.",
    );
  });

  it('explains why this can be used when public ChatGPT cannot', () => {
    expect(ONB_COPY.compliance.headline).toBe("Why you can use this when you can't use ChatGPT");
    expect(ONB_COPY.compliance.points.join(' ')).toContain('Your files stay on your computer');
    expect(ONB_COPY.compliance.points.join(' ')).toContain("provider doesn't train on it");
  });

  it('frames cloud and on-device AI as two private paths', () => {
    expect(ONB_COPY.ai.modeNote).toContain('your client files stay on your machine');
    expect(ONB_COPY.ai.modeNote).toContain('Cloud AI sends questions to your own AI account');
    expect(ONB_COPY.ai.modeNote).toContain('On-device AI keeps even the questions on this computer');
  });
});
