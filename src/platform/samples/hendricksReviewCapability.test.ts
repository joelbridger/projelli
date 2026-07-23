import { describe, expect, it } from 'vitest';
import {
  HENDRICKS_REVIEW_CAPABILITY,
  isExactHendricksReviewCapability,
  isHendricksReviewIdentity,
} from './hendricksReviewCapability';

describe('Hendricks review capability data', () => {
  it('contains exactly one unassigned Task and one one-field CRM change', () => {
    expect(HENDRICKS_REVIEW_CAPABILITY.task.ownerRef).toBeNull();
    expect(HENDRICKS_REVIEW_CAPABILITY.task.dueDate).toBeNull();
    expect(HENDRICKS_REVIEW_CAPABILITY.crm.field).toBe('annualReviewNote');
    expect(HENDRICKS_REVIEW_CAPABILITY.crm.valueType).toBe('text');
  });

  it('refuses shortened or wrong-client copies', () => {
    expect(isExactHendricksReviewCapability(HENDRICKS_REVIEW_CAPABILITY)).toBe(true);
    expect(isExactHendricksReviewCapability({
      ...HENDRICKS_REVIEW_CAPABILITY,
      task: { ...HENDRICKS_REVIEW_CAPABILITY.task, detail: 'shortened' },
    })).toBe(false);
    expect(isHendricksReviewIdentity({
      matterId: 'other-matter',
      householdRef: HENDRICKS_REVIEW_CAPABILITY.householdRef,
      meetingId: HENDRICKS_REVIEW_CAPABILITY.meeting.id,
    })).toBe(false);
  });
});
