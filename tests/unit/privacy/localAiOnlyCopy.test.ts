import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VISIBLE_PRIVACY_SURFACES = [
  'src/features/settings/ConfidentialityModeSettings.tsx',
  'src/platform/settings/schema.ts',
  'src/platform/privacy/egress.ts',
  'src/app/shell/layout/TrustBar.tsx',
  'src/platform/privacy/ui/EgressIndicator.tsx',
  'src/platform/privacy/ui/DataMapDialog.tsx',
  'src/features/privacy/FirmSecurityPack.tsx',
  'src/features/privacy/privacyCenterOverviewExport.ts',
  'src/platform/privacy/confidentialityReport.ts',
  'src/platform/privacy/ui/ConfidentialityReportDialog.tsx',
] as const;

describe('Local AI only facade copy', () => {
  it('does not leave the retired visible name in privacy settings, reports, or status copy', () => {
    for (const file of VISIBLE_PRIVACY_SURFACES) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/On this computer only|Local-only|Local only/);
    }
  });

  it('keeps the deliberately supported old search phrase, alongside the new name', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/settings/settingsContentHelpers.ts'),
      'utf8',
    );
    expect(source).toContain("'local ai only'");
    expect(source).toContain("'local only'");
  });
});
