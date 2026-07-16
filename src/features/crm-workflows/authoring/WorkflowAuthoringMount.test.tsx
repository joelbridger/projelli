import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';

function tags(): FirmTagStore {
  return {
    catalog: {
      version: 1,
      tags: [
        {
          id: 'tag:planning',
          name: 'Planning',
          color: '#2563eb',
          status: 'active',
        },
      ],
    },
    errorCode: null,
    list: () =>
      Promise.resolve({
        version: 1,
        tags: [
          {
            id: 'tag:planning',
            name: 'Planning',
            color: '#2563eb',
            status: 'active' as const,
          },
        ],
      }),
    create: vi.fn(),
    rename: vi.fn(),
    setColor: vi.fn(),
    retire: vi.fn(),
  };
}

describe('WorkflowAuthoringRuleMount', () => {
  afterEach(() => vi.resetModules());

  it('does no authoring or tag loading while its flag is off', async () => {
    const createStore = vi.fn();
    const createTagStore = vi.fn(tags);
    vi.doMock('@/platform/flags', () => ({ isEnabled: () => false }));
    const { WorkflowAuthoringRuleMount } =
      await import('./WorkflowAuthoringMount');

    const { container } = render(
      <WorkflowAuthoringRuleMount
        templateId="legacy-template"
        createStore={createStore}
        createTagStore={createTagStore}
      />
    );
    expect(container).toBeEmptyDOMElement();
    expect(createStore).not.toHaveBeenCalled();
    expect(createTagStore).not.toHaveBeenCalled();
  });
});
