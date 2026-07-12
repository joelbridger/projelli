import { describe, expect, it } from 'vitest';
import { privacyCenterSecurityOverviewMarkdown } from '@/features/privacy/privacyCenterOverviewExport';

describe('Privacy Center security overview export', () => {
  it('includes the Intake secure-link boundary a reviewer needs', () => {
    const text = privacyCenterSecurityOverviewMarkdown();

    expect(text).toContain('## Intake / secure client links');
    expect(text).toContain('The relay can see');
    expect(text).toContain("cannot see a client's name");
    expect(text).toContain('Social Security numbers');
    expect(text).toContain('file names or file contents');
    expect(text).toContain('Email fallback is a separate channel');
    expect(text).toContain('## Intake reviewer checklist');
  });
});
