import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFlagRouter } from './router';

const productionEnvironment = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env.production'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator < 1)
        throw new Error(`Invalid production flag line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
);

describe('production feature-flag matrix', () => {
  it('enables only the approved M1 shell and its already-live dependencies', () => {
    expect(productionEnvironment).toEqual({
      VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE: 'true',
      VITE_FLAG_MEETINGS_SHELL_V1: 'true',
      VITE_FLAG_SHARED_CLIENT_BAR: 'true',
      VITE_FLAG_V1_SHELL_FRAME: 'true',
    });

    const router = createFlagRouter({
      environment: productionEnvironment,
      isDevelopment: false,
      storage: undefined,
    });

    expect({
      crmShell: router.isEnabled('crm-shell-v1'),
      homeSurface: router.isEnabled('home-surface-v1'),
      meetingsShell: router.isEnabled('meetings-shell-v1'),
      selectionAuthority: router.isEnabled('selection-authority-boot-gate'),
      settingsShell: router.isEnabled('settings-shell-v1'),
      sharedClientBar: router.isEnabled('shared-client-bar'),
      v1ShellFrame: router.isEnabled('v1-shell-frame'),
    }).toEqual({
      crmShell: false,
      homeSurface: false,
      meetingsShell: true,
      selectionAuthority: true,
      settingsShell: false,
      sharedClientBar: true,
      v1ShellFrame: true,
    });
  });
});
