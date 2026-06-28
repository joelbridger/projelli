import { describe, it, expect } from 'vitest';
import { matterLabel } from '@/platform/rag/matterResolver';
import type { Matter } from '@/platform/types/matter';

// matterLabel only reads name/client/id; cast a minimal object for this pure-fn test.
const m = (name: string, client: string, id = 'matter_x'): Matter =>
  ({ id, name, client }) as unknown as Matter;

describe('matterLabel', () => {
  it('does NOT duplicate when name === client (the CRM household case)', () => {
    // BUG3: CRM connectors set name === client === household.name, which used to
    // render "Name - Name". It must show the name once.
    expect(
      matterLabel(m('Ellison, Robert & Margaret', 'Ellison, Robert & Margaret'))
    ).toBe('Ellison, Robert & Margaret');
    // whitespace-only difference is still a duplicate
    expect(matterLabel(m('  Hollings Family  ', 'Hollings Family'))).toBe('Hollings Family');
  });

  it('joins "client - name" only when they genuinely differ', () => {
    expect(matterLabel(m('Estate Plan', 'Ellison'))).toBe('Ellison - Estate Plan');
  });

  it('falls back to whichever field exists, then the id', () => {
    expect(matterLabel(m('Just Name', ''))).toBe('Just Name');
    expect(matterLabel(m('', 'Just Client'))).toBe('Just Client');
    expect(matterLabel(m('', '', 'matter_z'))).toBe('matter_z');
  });
});
