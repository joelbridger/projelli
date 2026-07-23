import { describe, expect, it } from 'vitest';
import { HENDRICKS_REVIEW_CAPABILITY } from '@/platform/samples/hendricksReviewCapability';

describe('Hendricks local Task contract', () => {
  it('keeps the one local task unassigned and without a due date', () => {
    expect(HENDRICKS_REVIEW_CAPABILITY.task.ownerRef).toBeNull();
    expect(HENDRICKS_REVIEW_CAPABILITY.task.dueDate).toBeNull();
  });
});
