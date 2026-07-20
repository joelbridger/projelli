import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

type BrandConfig = {
  urls: {
    domain: string;
    site: string;
    repository: string;
    licenseUrl: string;
    supportUrl: string;
    supportEmail: string;
  };
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOT = path.join(ROOT, 'src');
// Product-name text is capitalized in every locale. Domain checks remain
// case-insensitive, while lowercase identifier tokens such as `lantern:...`
// remain outside this copy guard's scope.
const LEGACY_PRODUCT_NAME = /\bLantern\b/;
const LEGACY_DOMAIN = /lantern\.com|lanternplatform\.app/i;

function containsLegacyCopy(value: string): boolean {
  return LEGACY_PRODUCT_NAME.test(value) || LEGACY_DOMAIN.test(value);
}

/**
 * These values identify app plumbing only: network allowlists and private
 * service endpoints. They are never rendered as product copy. Keeping this
 * list explicit means a new old-brand value in a UI string cannot hide here.
 */
const INTERNAL_IDENTIFIER_ALLOWLIST: Record<string, readonly string[]> = {
  'src/config/brand.ts': [
    'https://forms.lanternplatform.app/api/forms/lantern/bug-report',
    'https://forms.lanternplatform.app/api/forms/lantern/ai-setup-help',
    'https://forms.lanternplatform.app/api/forms/lantern/app-event',
    'https://forms.lanternplatform.app/api/forms/lantern/design-partner-event',
    'https://licenses.lanternplatform.app',
    'https://api.lanternplatform.app',
  ],
  'src/features/matters/MatterHub.tsx': ['https://forms.lanternplatform.app'],
  'src/features/matters/NewClientDialog.tsx': ['https://forms.lanternplatform.app'],
  'src/platform/intake/advisorIntakeLink.ts': ['https://forms.lanternplatform.app'],
  'src/platform/privacy/egressModules/assuredInference.ts': ['api.lanternplatform.app'],
  'src/platform/privacy/egressModules/offlineModeSinks.ts': [
    'licenses.lanternplatform.app',
    'api.lanternplatform.app',
    'forms.lanternplatform.app',
  ],
};

function walk(dir: string, predicate: (file: string) => boolean, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, predicate, files);
    else if (predicate(file)) files.push(file);
  }
  return files;
}

function collectVisibleLiterals(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const node = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const values: string[] = [];

  const visit = (child: ts.Node) => {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child) || ts.isJsxText(child)) {
      if (containsLegacyCopy(child.text)) values.push(child.text);
    } else if (ts.isTemplateExpression(child)) {
      const text = source.slice(child.getStart(node), child.end);
      if (containsLegacyCopy(text)) values.push(text);
      return;
    }
    ts.forEachChild(child, visit);
  };

  visit(node);
  return values;
}

describe('visible brand copy guard', () => {
  it('keeps all locale catalogs free of the internal name and domains', () => {
    const localeFiles = walk(SOURCE_ROOT, (file) => /\/locales\/[^/]+\.json$/.test(file));
    const leaks = localeFiles
      .filter((file) => containsLegacyCopy(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));

    expect(leaks).toEqual([]);
  });

  it('keeps UI, notification, export, and workflow copy sourced from the public brand', () => {
    const sourceFiles = walk(
      SOURCE_ROOT,
      (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file),
    );
    const leaks: string[] = [];

    for (const file of sourceFiles) {
      const relative = path.relative(ROOT, file);
      const allowed = INTERNAL_IDENTIFIER_ALLOWLIST[relative] ?? [];
      for (const value of collectVisibleLiterals(file)) {
        if (!allowed.includes(value)) leaks.push(`${relative}: ${value}`);
      }
    }

    expect(leaks).toEqual([]);
  });

  it('exposes every public identity and support link through BRAND', () => {
    const config: BrandConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand/brand.config.json'), 'utf8'));

    expect(config.urls).toMatchObject({
      domain: expect.any(String),
      site: expect.any(String),
      repository: expect.any(String),
      licenseUrl: expect.any(String),
      supportUrl: expect.any(String),
      supportEmail: expect.any(String),
    });
    expect(BRAND.urls.domain).toBe(config.urls.domain);
    expect(BRAND.urls.site).toBe(config.urls.site);
    expect(BRAND.urls.repository).toBe(config.urls.repository);
    expect(BRAND.urls.licenseUrl).toBe(config.urls.licenseUrl);
    expect(BRAND.urls.supportUrl).toBe(config.urls.supportUrl);
    expect(BRAND.urls.supportEmail).toBe(config.urls.supportEmail);
  });

  it('does not expose internal service endpoints from user-visible copy modules', () => {
    const visibleModules = [
      'src/platform/privacy/ui/DataMapDialog.tsx',
      'src/features/settings/locales/en.json',
      'src/features/settings/locales/es.json',
      'src/features/settings/locales/de.json',
    ];

    for (const relative of visibleModules) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      expect(source).not.toMatch(/forms[A-Za-z]+|licenseApi|firmApi/);
    }
  });
});
