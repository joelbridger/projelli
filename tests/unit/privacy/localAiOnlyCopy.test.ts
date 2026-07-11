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
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(source, file).not.toMatch(
        /['"`][^'"`]*(?:On this computer only|Local-only|Local only)[^'"`]*['"`]/,
      );
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

  it('keeps all three locale catalogs on the same keys', () => {
    const flatten = (value: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(value).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === 'object') {
          return flatten(child as Record<string, unknown>, path);
        }
        return key.endsWith('__sourceHash') || key.endsWith('__locked') ? [] : [path];
      });
    const keysFor = (locale: string) =>
      flatten(
        JSON.parse(
          readFileSync(resolve(process.cwd(), `src/locales/${locale}.json`), 'utf8'),
        ) as Record<string, unknown>,
      ).sort();
    const english = keysFor('en');
    expect(keysFor('de')).toEqual(english);
    expect(keysFor('es')).toEqual(english);
  });
});
