import { describe, it, expect } from 'vitest';
import {
  validateTemplateManifest,
  checkMinAppVersion,
  compareSemver,
} from '@/features/workflows/marketplace/svc/manifestValidator';
import type { TemplateManifest } from '@/features/workflows/types/templateManifest';

const VALID: TemplateManifest = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  version: '1.0.0',
  apiVersion: '1.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  description: 'Monthly update template for early-stage investors',
  category: 'investor',
  tags: ['investor', 'update', 'monthly'],
  screenshots: ['preview.png'],
  files: [
    { path: 'template.md', type: 'markdown' },
    { path: 'questions.json', type: 'interview-questions' },
    { path: 'workflow.json', type: 'workflow-definition' },
  ],
  minAppVersion: '2.0.0',
};

describe('validateTemplateManifest', () => {
  it('accepts a fully populated valid manifest', () => {
    const res = validateTemplateManifest(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest.id).toBe('investor-update-v1');
      expect(res.manifest.files).toHaveLength(3);
    }
  });

  it('accepts a manifest without optional fields', () => {
    const minimal = {
      id: 'minimal',
      name: 'Minimal',
      version: '0.1.0',
      apiVersion: '1.0',
      author: { name: 'Anon' },
      description: 'desc',
      category: 'misc',
      tags: [],
      files: [{ path: 'template.md', type: 'markdown' }],
      minAppVersion: '2.0.0',
    };
    const res = validateTemplateManifest(minimal);
    expect(res.ok).toBe(true);
  });

  it('rejects a manifest missing a required field', () => {
    const bad = { ...VALID } as Partial<TemplateManifest>;
    delete bad.description;
    const res = validateTemplateManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('description'))).toBe(true);
    }
  });

  it('rejects a manifest where a required field has the wrong type', () => {
    const bad = { ...VALID, tags: 'not-an-array' };
    const res = validateTemplateManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('tags'))).toBe(true);
    }
  });

  it('rejects a file entry with an invalid type enum', () => {
    const bad = {
      ...VALID,
      files: [{ path: 'x.foo', type: 'binary-blob' }],
    };
    const res = validateTemplateManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.toLowerCase().includes('type'))).toBe(true);
    }
  });

  it('rejects a non-semver version string', () => {
    const bad = { ...VALID, version: 'one-point-zero' };
    const res = validateTemplateManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('version'))).toBe(true);
    }
  });

  it('rejects an empty files array', () => {
    const bad = { ...VALID, files: [] };
    const res = validateTemplateManifest(bad);
    expect(res.ok).toBe(false);
  });

  it('rejects an author without a name', () => {
    const bad = { ...VALID, author: { githubUser: 'x' } };
    const res = validateTemplateManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('author'))).toBe(true);
    }
  });

  it('rejects null and primitive inputs', () => {
    expect(validateTemplateManifest(null).ok).toBe(false);
    expect(validateTemplateManifest('string').ok).toBe(false);
    expect(validateTemplateManifest(42).ok).toBe(false);
  });
});

describe('checkMinAppVersion', () => {
  it('returns null when current app version equals min', () => {
    expect(checkMinAppVersion(VALID, '2.0.0')).toBeNull();
  });

  it('returns null when current app version exceeds min', () => {
    expect(checkMinAppVersion(VALID, '2.1.0')).toBeNull();
    expect(checkMinAppVersion(VALID, '3.0.0')).toBeNull();
  });

  it('returns an error string when manifest needs a future Keepance version', () => {
    const futureManifest = { ...VALID, minAppVersion: '99.0.0' };
    const err = checkMinAppVersion(futureManifest, '2.0.0');
    expect(err).not.toBeNull();
    expect(err).toContain('99.0.0');
    expect(err).toContain('2.0.0');
  });
});

describe('compareSemver', () => {
  it('orders versions correctly', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.10.0', '1.2.0')).toBe(1);
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBe(0);
  });
});
