import { describe, expect, it } from 'vitest';
import { taskTemplatesAdminSettingsPanel } from './settingsModuleDescriptor';

describe('task template administration Settings mount', () => {
  it('describes one dark Organization panel through the public Settings contract', () => {
    expect(taskTemplatesAdminSettingsPanel).toEqual(
      expect.objectContaining({
        id: 'task-templates-admin',
        section: 'organization',
        labelKey: 'task-templates-admin.settings-label',
        flagId: 'task-templates-admin',
      }),
    );
    expect(taskTemplatesAdminSettingsPanel.order).toBe(50);
  });
});
