import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contactSourcesSettingsPanel } from './settingsModuleDescriptor';

describe('contact sources settings registry mount', () => {
  it('registers exactly one flag-gated panel in the existing Organization section', () => {
    expect(contactSourcesSettingsPanel).toMatchObject({
      section: 'organization',
      flagId: 'contact-sources',
    });
    const registry = readFileSync(
      resolve(
        process.cwd(),
        'src/features/settings/registry/settingsModuleRegistry.ts'
      ),
      'utf8'
    );
    expect(registry.match(/contactSourcesSettingsPanel,/g)).toHaveLength(1);
    expect(registry).toContain(
      "import { contactSourcesSettingsPanel } from '@/features/crm-firm/contact-sources';"
    );
  });
});
