import { describe, it, expect } from 'vitest';
import { AttachmentService } from '@/modules/attachments';

describe('AttachmentService barrel export', () => {
  it('exports AttachmentService class via index', () => {
    expect(AttachmentService).toBeDefined();
    expect(typeof AttachmentService).toBe('function');
  });
});
