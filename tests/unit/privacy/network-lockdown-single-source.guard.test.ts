import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path)) {
      files.push(path);
    }
  }
  return files;
}

describe('FINDING-20 Network Lockdown single-source guard', () => {
  it('fails if a second renderer store for enforced lockdown is introduced', () => {
    const authority = join(ROOT, 'src/platform/privacy/offlineMode.ts');
    const bridge = join(ROOT, 'src/platform/privacy/nativeNetworkLockdownBridge.ts');
    const authoritySource = readFileSync(authority, 'utf8');
    const bridgeSource = readFileSync(bridge, 'utf8');

    expect(authoritySource.match(/create<OfflineModeState>/g)).toHaveLength(1);
    expect(bridgeSource).toContain('useOfflineModeStore');
    expect(bridgeSource).not.toMatch(/from ['"]zustand['"]/);
    expect(bridgeSource).not.toMatch(/create\s*</);

    const duplicateStores = sourceFiles(join(ROOT, 'src'))
      .filter((path) => path !== authority)
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8');
        return /create<[^>]*(?:Offline|Lockdown)[^>]*>/.test(source)
          ? [relative(ROOT, path)]
          : [];
      });
    expect(
      duplicateStores,
      'Rust NetworkPolicy may have only one renderer projection: offlineMode.ts.',
    ).toEqual([]);
  });

  it('fails if CRM display or command guards read the saved privacy choice', () => {
    const guardedFiles = [
      'src/platform/connectors/crm/WealthboxConnect.tsx',
      'src/platform/connectors/crm/SalesforceConnect.tsx',
      'src/platform/connectors/crm/RedtailConnect.tsx',
      'src/platform/utils/wealthbox-commands.ts',
    ];
    const violations = guardedFiles.filter((path) =>
      /(?:get|use)PrivilegedMatterMode/.test(readFileSync(join(ROOT, path), 'utf8')),
    );

    expect(
      violations,
      'CRM must render and pre-check Rust enforcement, never the saved requested choice.',
    ).toEqual([]);
  });

  it('fails if core UI or MCP scope claims the saved choice was enforced', () => {
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    const settings = readFileSync(
      join(ROOT, 'src/features/settings/ConfidentialityModeSettings.tsx'),
      'utf8',
    );
    const statusBar = readFileSync(join(ROOT, 'src/app/shell/layout/StatusBar.tsx'), 'utf8');

    expect(app).toContain('networkLockdown: enforcedNetworkLockdown.blocked');
    expect(app).not.toMatch(/networkLockdown:\s*requestedNetworkLockdown/);
    expect(settings).toContain("nativeLockdown.status === 'on'");
    expect(settings).toContain('aria-checked={lockdownStatusKnown ? enforcedLockdownOn : undefined}');
    expect(statusBar).toContain("enforcedNetworkLockdown.status === 'on'");
  });

  it('keeps native status and remote enforcement on the same Rust state helper', () => {
    const rust = readFileSync(join(ROOT, 'src-tauri/src/network_policy.rs'), 'utf8');
    expect(rust).toMatch(/fn remote_egress_is_blocked\(state: u8\)/);
    expect(rust.match(/Self::remote_egress_is_blocked/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(rust).toMatch(/offline_mode: Self::remote_egress_is_blocked\(state\)/);
  });
});
