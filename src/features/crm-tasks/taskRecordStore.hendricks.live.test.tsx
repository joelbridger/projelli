import { describe, expect, it } from 'vitest';
import { HENDRICKS_TASK_ARTIFACT_ID } from '@/platform/samples/hendricksReviewCapability';

describe('Hendricks task delivery identity', () => {
  it('uses one stable task artifact identity', () => {
    expect(HENDRICKS_TASK_ARTIFACT_ID).toBe('hendricks-review-task-v1');
  });
});
