import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/flags/router', () => ({
  isEnabled: (id: string) => id === 'teams-roles',
}));

describe('teams and roles Settings mount', () => {
  it('adds Organization to Settings only while its flag is enabled', async () => {
    const { getSettingsModuleDescriptors } =
      await import('@/features/settings/registry/settingsModuleRegistry');
    expect(
      getSettingsModuleDescriptors().map((descriptor) => descriptor.id)
    ).toContain('organization');
  });
});
