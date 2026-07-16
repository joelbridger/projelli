import type { SettingsPanelDescriptor } from '@/features/settings';
import { TaskTemplatesAdminSettingsMount } from './TaskTemplatesAdminSettings';

/** Organization panel mount; the Settings registry owns the real doorway. */
export const taskTemplatesAdminSettingsPanel = {
  id: 'task-templates-admin',
  section: 'organization',
  order: 50,
  labelKey: 'task-templates-admin.settings-label',
  flagId: 'task-templates-admin',
  searchTerms: ['task template', 'task templates', 'repeatable task'],
  render: () => <TaskTemplatesAdminSettingsMount />,
} as const satisfies SettingsPanelDescriptor;
