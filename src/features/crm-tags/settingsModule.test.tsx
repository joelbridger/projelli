import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirmTagStore } from './index';
import { universalTagsSettingsPanel } from './settingsModuleDescriptor';

describe('UniversalTagsSettingsMount', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.doUnmock('@/platform/flags');
    vi.resetModules();
  });

  it('is registered as one dark Organization settings panel', () => {
    expect(universalTagsSettingsPanel).toEqual(
      expect.objectContaining({
        id: 'universal-tags',
        section: 'organization',
        flagId: 'universal-tags',
      })
    );
  });

  it('does no persistence loading while the flag is off', async () => {
    const createStore = vi.fn(() => createFirmTagStore());
    vi.doMock('@/platform/flags', () => ({ isEnabled: () => false }));
    const { UniversalTagsSettingsMount } = await import('./settingsModule');

    const { container } = render(
      <UniversalTagsSettingsMount createStore={createStore} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(createStore).not.toHaveBeenCalled();
  });

  it('lets a firm create, rename, recolor, and retire a tag when enabled', async () => {
    vi.doMock('@/platform/flags', () => ({ isEnabled: () => true }));
    const { UniversalTagsSettingsMount } = await import('./settingsModule');

    render(<UniversalTagsSettingsMount createStore={createFirmTagStore} />);
    fireEvent.change(screen.getByTestId('firm-tag-new-name'), {
      target: { value: 'Planning' },
    });
    fireEvent.change(screen.getByTestId('firm-tag-new-color'), {
      target: { value: 'green' },
    });
    fireEvent.click(screen.getByTestId('firm-tag-add'));
    expect(screen.getByTestId('firm-tag-row-planning')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('firm-tag-name-planning'), {
      target: { value: 'Financial planning' },
    });
    fireEvent.click(screen.getByTestId('firm-tag-save-name-planning'));
    fireEvent.change(screen.getByTestId('firm-tag-color-planning'), {
      target: { value: 'purple' },
    });
    expect(createFirmTagStore().list().tags[0]).toEqual({
      id: 'planning',
      name: 'Financial planning',
      color: 'purple',
      status: 'active',
    });

    fireEvent.click(screen.getByTestId('firm-tag-retire-planning'));
    fireEvent.click(screen.getByTestId('firm-tag-confirm-retire-planning'));
    expect(screen.getByTestId('firm-tag-status-planning')).toHaveTextContent(
      'Retired'
    );
  });
});
