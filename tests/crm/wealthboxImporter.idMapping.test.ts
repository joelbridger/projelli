import { describe, it } from 'vitest';

// EXAM-BLOCKED: B8 has no exported Northcrest simulator/importer seam in the merged tree.
describe.skip('Wealthbox importer id mapping (EXAM-BLOCKED: importer seam)', () => {
  it('maps the provider/sourceType/sourceId/scope four-part external-ref key to one entity id', () => {});
  it('creates zero records on the second identical 80-household Northcrest import', () => {});
  it('updates a modified imported record in place instead of forking it', () => {});
  it('imports 40 households then all 80 as exactly 80 households', () => {});
  it('attaches every generated Person to its fabricated Household with zero orphans (fast-check)', () => {});
});
