import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { mergeCrmTaskRecord, projectCrmTask } from './liveTaskAdapter';

const canonical: LiveCrmRecord = {
  id: 'task-1',
  kind: 'task',
  matterId: 'firm_home',
  title: 'Prepare review',
  body: 'Original body',
  assigneeUserId: 'advisor-1',
  status: 'open',
  due: '2026-08-03',
  dueTime: '09:30',
  priority: 'high',
  category: 'Annual review',
  tagIds: ['tag:review'],
  householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
  contextRefs: [
    { kind: 'household', id: 'household-1', matterId: 'matter-1' },
    { kind: 'document', id: 'Clients/River/review.docx', matterId: 'matter-1', label: 'Review packet' },
  ],
  customFields: { risk: { value: 'high' } },
  connectorOwned: 'keep me',
};

describe('legacy live task adapter', () => {
  it('projects foundation metadata and merge-saves without erasing canonical fields or document links', () => {
    const projected = projectCrmTask(canonical, {
      householdLabel: 'River household',
      assigneeLabel: 'Maya',
    });

    expect(projected).toMatchObject({
      tagIds: ['tag:review'],
      category: 'Annual review',
      dueTime: '09:30',
      documentRefs: [{ kind: 'document', id: 'Clients/River/review.docx' }],
    });

    const saved = mergeCrmTaskRecord({
      ...projected,
      title: 'Prepare updated review',
      priority: 'normal',
    }, canonical);

    expect(saved).toMatchObject({
      title: 'Prepare updated review',
      priority: 'normal',
      tagIds: ['tag:review'],
      category: 'Annual review',
      dueTime: '09:30',
      connectorOwned: 'keep me',
      customFields: { risk: { value: 'high' } },
    });
    expect(saved['contextRefs']).toEqual(expect.arrayContaining([
      { kind: 'document', id: 'Clients/River/review.docx', matterId: 'matter-1', label: 'Review packet' },
    ]));
  });

  it('copies task metadata deliberately when creating the next recurring task', () => {
    const projected = projectCrmTask(canonical);
    const child = mergeCrmTaskRecord({
      ...projected,
      id: 'task-2',
      status: 'open',
    });

    expect(child).toMatchObject({
      id: 'task-2',
      category: 'Annual review',
      dueTime: '09:30',
      tagIds: ['tag:review'],
    });
    expect(child['contextRefs']).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'document', id: 'Clients/River/review.docx' }),
    ]));
  });
});
