import { describe, expect, it } from 'vitest';
import { HENDRICKS_REVIEW_CAPABILITY } from '@/platform/samples/hendricksReviewCapability';

describe('Hendricks native CRM bridge', () => {
  it('has one fixed local CRM target', () => {
    expect(HENDRICKS_REVIEW_CAPABILITY.crm).toMatchObject({ entityRef: 'sample-hendricks-household', field: 'annualReviewNote' });
  });
});
