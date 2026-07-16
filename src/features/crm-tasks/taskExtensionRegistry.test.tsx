/* eslint-disable lantern-i18n/no-hardcoded-string -- Dummy labels are test-only registry mounts. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CrmTask, CrmWorkflowWorkItem } from '@/features/crm-home';
import type { TaskActionDescriptor } from '@/features/crm-tasks';
import {
  getTaskActions,
  getTaskFields,
  getTaskTemplates,
  mountTaskActions,
  mountTaskFields,
  mountTaskTemplates,
  validateTaskActionDescriptors,
  validateTaskFieldDescriptors,
  validateTaskTemplateDescriptors,
  type TaskFieldDescriptor,
  type TaskTemplateDescriptor,
} from './taskExtensionRegistry';

declare module './taskExtensionRegistry' {
  interface TaskFieldIdMap {
    'test.dummy-field': true;
  }
  interface TaskActionIdMap {
    'test.dummy-action': true;
  }
  interface TaskTemplateIdMap {
    'test.dummy-template': true;
  }
}

const task: CrmTask = {
  id: 'task-1',
  title: 'Review plan',
  assigneeUserId: null,
  status: 'open',
  priority: 'normal',
  tagIds: [],
};

const workflowWorkItem: CrmWorkflowWorkItem = {
  id: 'workflow-work-1',
  instanceId: 'workflow-instance-1',
  stepId: 'workflow-step-1',
  title: 'Prepare workflow review',
  householdId: 'household-1',
  householdLabel: 'Morgan household',
  assigneeUserId: null,
  status: 'open',
  priority: 'normal',
  tagIds: ['tag:review'],
};

describe('task extension registries', () => {
  it('keeps compatibility descriptors in stable order', () => {
    expect(getTaskFields().map(({ id }) => id)).toEqual(['legacy.core-fields']);
    expect(getTaskActions().map(({ id }) => id)).toEqual([
      'legacy.save-view',
      'capacity-triage.toolbar',
    ]);
    expect(getTaskTemplates().map(({ id }) => id)).toEqual([
      'legacy.blank-task',
      'task-create-v1.composer',
      'templates.library',
    ]);
  });

  it('mounts a field, action, and template without a shell switch edit', () => {
    const field: TaskFieldDescriptor = {
      id: 'test.dummy-field',
      order: 20,
      mount: () => <span>Dummy task field</span>,
    };
    const action: TaskActionDescriptor = {
      id: 'test.dummy-action',
      order: 20,
      mount: () => <span>Dummy task action</span>,
    };
    const template: TaskTemplateDescriptor = {
      id: 'test.dummy-template',
      order: 20,
      mount: () => <span>Dummy task template</span>,
    };

    render(
      <>
        {mountTaskFields(
          {
            task,
            updateTask: vi.fn(),
            households: [],
            firmMembers: [],
            compatibilityMount: null,
          },
          [field]
        )}
        {mountTaskActions(
          {
            tasks: [task],
            workflowWorkItems: [workflowWorkItem],
            compatibilityMount: null,
          },
          [action]
        )}
        {mountTaskTemplates({ onCreate: vi.fn() }, [template])}
      </>
    );

    expect(screen.getByText('Dummy task field')).toBeInTheDocument();
    expect(screen.getByText('Dummy task action')).toBeInTheDocument();
    expect(screen.getByText('Dummy task template')).toBeInTheDocument();
  });

  it('rejects duplicate ids and malformed descriptors clearly', () => {
    const field = getTaskFields()[0];
    const action = getTaskActions()[0];
    const template = getTaskTemplates()[0];
    if (!field || !action || !template) {
      throw new Error('Expected compatibility descriptors');
    }

    expect(() => {
      validateTaskFieldDescriptors([field, field]);
    }).toThrow('duplicate id: legacy.core-fields');
    expect(() => {
      validateTaskActionDescriptors([action, action]);
    }).toThrow('duplicate id: legacy.save-view');
    expect(() => {
      validateTaskTemplateDescriptors([template, template]);
    }).toThrow('duplicate id: legacy.blank-task');
    expect(() => {
      validateTaskFieldDescriptors([{ ...field, order: Number.NaN }]);
    }).toThrow('order must be finite: legacy.core-fields');
    expect(() => {
      validateTaskActionDescriptors([{ ...action, mount: null as never }]);
    }).toThrow('mount must be a function: legacy.save-view');
    expect(() => {
      validateTaskTemplateDescriptors([{ ...template, create: null as never }]);
    }).toThrow('create must be a function: legacy.blank-task');
  });

  it('keeps misspelled ids out at type-check time', () => {
    const invalid: TaskFieldDescriptor = {
      // @ts-expect-error This id is not registered through module augmentation.
      id: 'test.dummy-feld',
      order: 10,
      mount: () => null,
    };
    expect(invalid.id).toBe('test.dummy-feld');
  });
});
