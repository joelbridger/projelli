import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';
import brandConfig from '../../brand/brand.config.json';

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
  'src/platform/intake/advisorIntakeLink.ts': ['https://forms.lanternplatform.app'],
  'src/platform/privacy/egressModules/assuredInference.ts': ['api.lanternplatform.app'],
  'src/platform/privacy/egressModules/offlineModeSinks.ts': [
    'licenses.lanternplatform.app',
    'api.lanternplatform.app',
    'forms.lanternplatform.app',
  ],
  // The stored value remains a mailbox lookup key for existing advisors. The
  // input renders DISPLAY_DEFAULT_FOLDER_NAME instead, never this identifier.
  'src/features/crm-connectors/EmailDropboxSurface.tsx': ['Lantern Dropbox'],
};

const RUST_VISIBLE_COPY_FILES = [
  'src-tauri/src/generated_brand.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/commands/crm/importer/export.rs',
  'src-tauri/src/commands/crm/importer/fidelity.rs',
  'src-tauri/src/commands/crm/importer/pipeline.rs',
  'src-tauri/src/commands/crm/migration_commands.rs',
  'src-tauri/src/commands/writeback/engine.rs',
  'src-tauri/crates/lantern-docx/src/generated_brand.rs',
  'src-tauri/crates/lantern-docx/src/scrub.rs',
] as const;

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

function collectRustStringLiterals(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...source.matchAll(/(?:r#*|b)?"(?:\\.|[^"\\])*"#*/g)]
    .map(([literal]) => literal)
    .filter(containsLegacyCopy);
}

function htmlTitle(file: string): string | undefined {
  return /<title>([^<]*)<\/title>/.exec(fs.readFileSync(file, 'utf8'))?.[1];
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

  it('keeps static HTML titles and NSIS installer copy on the public brand', () => {
    expect(htmlTitle(path.join(ROOT, 'index.html'))).toBe(BRAND.name);
    expect(htmlTitle(path.join(ROOT, 'index.demo.html'))).toBe(`${BRAND.name} Demo`);
    expect(htmlTitle(path.join(ROOT, 'intake-page/index.html'))).toBe(`${BRAND.name} secure intake`);

    const installerFiles = walk(path.join(ROOT, 'src-tauri/windows'), (file) => /\.(nsh|nsi)$/.test(file));
    const leaks = installerFiles.flatMap((file) =>
      fs.readFileSync(file, 'utf8')
        .replace(/^\s*;.*$/gm, '')
        .split('\n')
        .filter(containsLegacyCopy)
        .map((line) => `${path.relative(ROOT, file)}: ${line.trim()}`),
    );
    expect(leaks).toEqual([]);
  });

  it('keeps native exports, generated document metadata, and public trust documents free of the internal name', () => {
    const nativeLeaks = RUST_VISIBLE_COPY_FILES.flatMap((relative) =>
      collectRustStringLiterals(path.join(ROOT, relative)).map((value) => `${relative}: ${value}`),
    );
    // Trust-network documents deliberately publish the locked service domains
    // for an IT firewall review. They must never publish the old product name.
    const trustLeaks = walk(path.join(ROOT, 'docs/trust'), (file) => file.endsWith('.md'))
      .filter((file) => LEGACY_PRODUCT_NAME.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));

    expect(nativeLeaks).toEqual([]);
    expect(trustLeaks).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, 'src-tauri/crates/lantern-docx/src/scrub.rs'), 'utf8'))
      .toContain('crate::generated_brand::PRODUCT_NAME');
  });

  it('exposes every public identity and support link through BRAND', () => {
    const { urls } = brandConfig;
    const publicUrlKeys = [
      'domain',
      'site',
      'repository',
      'licenseUrl',
      'supportUrl',
      'supportEmail',
    ] as const;

    for (const key of publicUrlKeys) {
      expect(typeof urls[key]).toBe('string');
      expect(BRAND.urls[key]).toBe(urls[key]);
    }
  });

  it('keeps internal service endpoints out of every UI module', () => {
    const uiModules = walk(SOURCE_ROOT, (file) => file.endsWith('.tsx'));
    const internalBrandFields = /\b(?:formsBugReport|formsAiSetupHelp|formsTelemetry|formsDiagnostics|licenseApi|firmApi)\b/;
    const leaks = uiModules
      .filter((file) => internalBrandFields.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));

    expect(leaks).toEqual([]);
  });
});
