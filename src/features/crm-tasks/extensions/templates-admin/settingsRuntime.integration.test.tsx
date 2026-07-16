import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import { SettingsV1FrameEnabled } from '@/features/settings/v1-frame/SettingsV1FrameEnabled';
import type { SettingsV1Runtime } from '@/features/settings/v1-frame/runtime';

vi.mock('@/features/crm-tasks/extensions/templates', () => ({
  TaskTemplateError: class TaskTemplateError extends Error {},
  useTaskTemplateStore: () => ({
    recordSnapshot: [],
    list: () => Promise.resolve([]),
    create: vi.fn(),
    update: vi.fn(),
    retire: vi.fn(),
    apply: vi.fn(),
  }),
}));
vi.mock('@/features/crm-tags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tags')>()),
  useFirmTagStore: () => ({
    catalog: { version: 1, tags: [] },
    errorCode: null,
    list: () => Promise.resolve({ version: 1, tags: [] }),
  }),
}));

const runtime: SettingsV1Runtime = {
  legacy: { settings: () => <div data-testid="legacy-settings-body" /> },
  settings: {
    action: vi.fn(),
    restartOnboarding: vi.fn(),
    loadTemplates: () => [],
    extraSections: [],
  },
  audit: { entries: [] },
  workspace: { rootPath: '/workspace' },
};

describe('task template Settings runtime integration', () => {
  afterEach(() => {
    setDevFlagOverride('task-templates-admin', undefined);
  });

  it('renders through the real Organization doorway only while its panel flag is on', async () => {
    const off = render(<SettingsV1FrameEnabled runtime={runtime} />);
    expect(screen.queryByTestId('settings-v1-organization')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-templates-admin-settings')).not.toBeInTheDocument();
    off.unmount();

    setDevFlagOverride('task-templates-admin', true);
    render(<SettingsV1FrameEnabled runtime={runtime} />);
    fireEvent.pointerDown(screen.getByTestId('settings-v1-workspace-entry'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('settings-v1-workspace-organization'));

    expect(await screen.findByTestId('task-templates-admin-settings')).toBeInTheDocument();
    expect(screen.getByTestId('settings-v1-section-organization')).toHaveAttribute('aria-current', 'page');
  });
});
