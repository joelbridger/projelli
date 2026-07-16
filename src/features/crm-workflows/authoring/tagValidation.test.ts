import { describe, expect, it } from 'vitest';
import type { FirmTagCatalog } from '@/features/crm-tags';
import type { WorkflowTemplateRecord } from '@/features/crm-workflows';
import { validateWorkflowTemplateTags } from './tagValidation';

const catalog: FirmTagCatalog = {
  version: 1,
  tags: [
    {
      id: 'tag:planning',
      name: 'Planning',
      color: '#2563eb',
      status: 'active',
    },
    {
      id: 'tag:legacy',
      name: 'Legacy',
      color: '#475569',
      status: 'retired',
    },
  ],
};

const saved: WorkflowTemplateRecord = {
  id: 'template:one',
  name: 'Annual review',
  status: 'draft',
  tagIds: ['tag:legacy'],
  steps: [
    {
      id: 'step:one',
      title: 'Prepare',
      position: 0,
      tagIds: ['tag:legacy'],
    },
  ],
};

describe('workflow authoring tag validation', () => {
  it('keeps retired IDs already saved on the same template and step', () => {
    expect(() => {
      validateWorkflowTemplateTags(saved, catalog, saved);
    }).not.toThrow();
  });

  it('rejects a retired or unknown ID newly assigned to a workflow', () => {
    expect(() => {
      validateWorkflowTemplateTags(
        {
          tagIds: ['tag:legacy'],
          steps: [],
        },
        catalog
      );
    }).toThrow(expect.objectContaining({ code: 'retired' }));

    expect(() => {
      validateWorkflowTemplateTags(
        {
          tagIds: [],
          steps: [{ id: 'step:new', tagIds: ['tag:missing'] }],
        },
        catalog,
        saved
      );
    }).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
});
