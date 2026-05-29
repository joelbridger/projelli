import { describe, it, expect } from 'vitest';
import {
  validatePluginManifest,
  checkMinKeepanceVersion,
  checkMaxKeepanceVersion,
  compareSemver,
} from '@/modules/plugins/PluginManifestSchema';
import type { PluginManifest } from '@/types/plugin';

const VALID: PluginManifest = {
  id: 'keepance-translator',
  name: 'Translator',
  version: '1.0.0',
  apiVersion: '1.0',
  author: { name: 'Jane Doe', githubUser: 'janedoe', url: 'https://janedoe.com' },
  description: 'Translate selected text using your AI provider',
  main: 'index.js',
  permissions: ['workspace:read', 'editor:selection', 'ai:invoke'],
  minKeepanceVersion: '2.0.0',
  category: 'writing',
  tags: ['translate', 'language', 'writing-tools'],
  screenshots: ['screenshot1.png'],
  homepage: 'https://github.com/janedoe/keepance-translator',
  license: 'MIT',
};

describe('validatePluginManifest', () => {
  it('accepts a fully populated valid manifest', () => {
    const res = validatePluginManifest(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest.id).toBe('keepance-translator');
      expect(res.manifest.permissions).toContain('ai:invoke');
      expect(res.manifest.main).toBe('index.js');
    }
  });

  it('accepts a manifest without optional fields', () => {
    const minimal = {
      id: 'minimal-plugin',
      name: 'Minimal',
      version: '0.1.0',
      apiVersion: '1.0',
      author: { name: 'Anon' },
      description: 'desc',
      main: 'index.js',
      permissions: [],
      minKeepanceVersion: '2.0.0',
      category: 'misc',
      tags: [],
    };
    const res = validatePluginManifest(minimal);
    expect(res.ok).toBe(true);
  });

  it('rejects a manifest missing the required main field', () => {
    const bad = { ...VALID } as Partial<PluginManifest>;
    delete bad.main;
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('main'))).toBe(true);
    }
  });

  it('rejects a manifest missing the required description field', () => {
    const bad = { ...VALID } as Partial<PluginManifest>;
    delete bad.description;
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('description'))).toBe(true);
    }
  });

  it('rejects an unknown permission literal', () => {
    const bad = {
      ...VALID,
      permissions: ['workspace:read', 'filesystem:nuke'],
    };
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('permissions'))).toBe(true);
    }
  });

  it('accepts every documented permission literal', () => {
    const allPerms = {
      ...VALID,
      permissions: [
        'workspace:read',
        'workspace:write',
        'editor:selection',
        'editor:write',
        'ai:invoke',
        'network',
      ],
    };
    const res = validatePluginManifest(allPerms);
    expect(res.ok).toBe(true);
  });

  it('rejects a non-semver version string', () => {
    const bad = { ...VALID, version: 'one-point-zero' };
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('version'))).toBe(true);
    }
  });

  it('rejects a manifest with bad apiVersion (empty string)', () => {
    const bad = { ...VALID, apiVersion: '' };
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('apiVersion'))).toBe(true);
    }
  });

  it('rejects a non-semver minKeepanceVersion', () => {
    const bad = { ...VALID, minKeepanceVersion: 'two' };
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('minKeepanceVersion'))).toBe(true);
    }
  });

  it('rejects an author without a name', () => {
    const bad = { ...VALID, author: { githubUser: 'x' } };
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('author'))).toBe(true);
    }
  });

  it('rejects a manifest where tags is the wrong shape', () => {
    const bad = { ...VALID, tags: 'translate, language' };
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('tags'))).toBe(true);
    }
  });

  it('rejects a non-URL homepage', () => {
    const bad = { ...VALID, homepage: 'not a url' };
    const res = validatePluginManifest(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('homepage'))).toBe(true);
    }
  });

  it('rejects null and primitive inputs', () => {
    expect(validatePluginManifest(null).ok).toBe(false);
    expect(validatePluginManifest('string').ok).toBe(false);
    expect(validatePluginManifest(42).ok).toBe(false);
  });

  it('rejects empty id and empty name', () => {
    expect(validatePluginManifest({ ...VALID, id: '' }).ok).toBe(false);
    expect(validatePluginManifest({ ...VALID, name: '' }).ok).toBe(false);
  });
});

describe('checkMinKeepanceVersion', () => {
  it('returns null when current app version equals min', () => {
    expect(checkMinKeepanceVersion(VALID, '2.0.0')).toBeNull();
  });

  it('returns null when current app version exceeds min', () => {
    expect(checkMinKeepanceVersion(VALID, '2.1.0')).toBeNull();
    expect(checkMinKeepanceVersion(VALID, '3.0.0')).toBeNull();
  });

  it('returns an error string when manifest needs a future Keepance version', () => {
    const futureManifest = { ...VALID, minKeepanceVersion: '99.0.0' };
    const err = checkMinKeepanceVersion(futureManifest, '2.0.0');
    expect(err).not.toBeNull();
    expect(err).toContain('99.0.0');
    expect(err).toContain('2.0.0');
  });
});

describe('checkMaxKeepanceVersion', () => {
  it('returns null when manifest has no max declared', () => {
    expect(checkMaxKeepanceVersion(VALID, '99.0.0')).toBeNull();
  });

  it('returns null when current is at or below max', () => {
    const m = { ...VALID, maxKeepanceVersion: '3.0.0' };
    expect(checkMaxKeepanceVersion(m, '2.5.0')).toBeNull();
    expect(checkMaxKeepanceVersion(m, '3.0.0')).toBeNull();
  });

  it('returns error when current exceeds max', () => {
    const m = { ...VALID, maxKeepanceVersion: '2.0.0' };
    const err = checkMaxKeepanceVersion(m, '3.0.0');
    expect(err).not.toBeNull();
    expect(err).toContain('2.0.0');
    expect(err).toContain('3.0.0');
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
