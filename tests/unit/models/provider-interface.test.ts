import { describe, it, expect } from 'vitest';
import type { Provider, ProviderContentBlock } from '@/platform/providers/Provider';
import type { ChatAttachment } from '@/types/ai';

describe('Provider interface extension', () => {
  it('declares formatAttachmentForRequest method', () => {
    type T = Provider['formatAttachmentForRequest'];
    const probe: T = (() => {}) as unknown as T;
    expect(probe).toBeDefined();
  });

  it('declares supportsAttachment method', () => {
    type T = Provider['supportsAttachment'];
    const probe: T = (() => {}) as unknown as T;
    expect(probe).toBeDefined();
  });

  it('supportsAttachment returns boolean or string', () => {
    type RT = ReturnType<Provider['supportsAttachment']>;
    const a: RT = true;
    const b: RT = 'reason';
    const c: RT = false;
    expect(a).toBe(true);
    expect(b).toBe('reason');
    expect(c).toBe(false);
  });

  it('ProviderContentBlock is exported', () => {
    type T = ProviderContentBlock;
    const probe: T = {} as T;
    expect(probe).toBeDefined();
  });
});
