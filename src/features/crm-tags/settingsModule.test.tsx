import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagCatalog, FirmTagStore } from './contract';
import { universalTagsSettingsPanel } from './settingsModuleDescriptor';

function inMemoryStore(): FirmTagStore {
  let catalog: FirmTagCatalog = { version: 1, tags: [] };
  return {
    list: () => Promise.resolve(catalog),
    create: ({ name, color }) => {
      catalog = {
        version: 1,
        tags: [
          ...catalog.tags,
          { id: 'tag:test', name: name.trim(), color, status: 'active' },
        ],
      };
      return Promise.resolve(catalog);
    },
    rename: (id, name) => {
      catalog = {
        version: 1,
        tags: catalog.tags.map((tag) =>
          tag.id === id ? { ...tag, name: name.trim() } : tag
        ),
      };
      return Promise.resolve(catalog);
    },
    setColor: (id, color) => {
      catalog = {
        version: 1,
        tags: catalog.tags.map((tag) =>
          tag.id === id ? { ...tag, color } : tag
        ),
      };
      return Promise.resolve(catalog);
    },
    retire: (id) => {
      catalog = {
        version: 1,
        tags: catalog.tags.map((tag) =>
          tag.id === id ? { ...tag, status: 'retired' } : tag
        ),
      };
      return Promise.resolve(catalog);
    },
  };
}

describe('UniversalTagsSettingsMount', () => {
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

  it('does no CRM loading while the flag is off', async () => {
    const createStore = vi.fn(inMemoryStore);
    vi.doMock('@/platform/flags', () => ({ isEnabled: () => false }));
    const { UniversalTagsSettingsMount } = await import('./settingsModule');

    const { container } = render(
      <UniversalTagsSettingsMount createStore={createStore} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(createStore).not.toHaveBeenCalled();
  });

  it('awaits the async store to create, rename, recolor, and retire a tag', async () => {
    const store = inMemoryStore();
    vi.doMock('@/platform/flags', () => ({ isEnabled: () => true }));
    const { UniversalTagsSettingsMount } = await import('./settingsModule');

    render(<UniversalTagsSettingsMount createStore={() => store} />);
    fireEvent.change(screen.getByTestId('firm-tag-new-name'), {
      target: { value: 'Planning' },
    });
    fireEvent.change(screen.getByTestId('firm-tag-new-color'), {
      target: { value: '#15803d' },
    });
    fireEvent.click(screen.getByTestId('firm-tag-add'));
    await screen.findByTestId('firm-tag-row-tag:test');

    fireEvent.change(screen.getByTestId('firm-tag-name-tag:test'), {
      target: { value: 'Financial planning' },
    });
    fireEvent.click(screen.getByTestId('firm-tag-save-name-tag:test'));
    fireEvent.change(screen.getByTestId('firm-tag-color-tag:test'), {
      target: { value: '#7e22ce' },
    });
    await waitFor(async () => {
      await expect(store.list()).resolves.toEqual({
        version: 1,
        tags: [
          {
            id: 'tag:test',
            name: 'Financial planning',
            color: '#7e22ce',
            status: 'active',
          },
        ],
      });
    });

    fireEvent.click(screen.getByTestId('firm-tag-retire-tag:test'));
    fireEvent.click(screen.getByTestId('firm-tag-confirm-retire-tag:test'));
    await waitFor(() => {
      expect(screen.getByTestId('firm-tag-status-tag:test')).toHaveTextContent(
        'Retired'
      );
    });
  });
});
