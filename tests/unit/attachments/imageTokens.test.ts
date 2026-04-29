import { describe, it, expect } from 'vitest';
import { estimateImageTokens } from '@/modules/attachments/imageTokens';
import type { ChatAttachment } from '@/types/ai';

function att(width: number, height: number): ChatAttachment {
  return {
    id: 'x',
    type: 'image',
    mimeType: 'image/png',
    fileName: 'img.png',
    pathInWorkspace: 'media/2026-04/chat-image-x.png',
    byteSize: width * height * 3,
    metadata: { width, height },
  };
}

describe('estimateImageTokens', () => {
  it('Claude: 512x512 image = 85 tokens', () => {
    expect(estimateImageTokens('claude', att(512, 512))).toBe(85);
  });

  it('Claude: 1024x1024 image = 340 tokens (4 tiles)', () => {
    // 4 tiles of 512x512 = 4 * 85 = 340
    expect(estimateImageTokens('claude', att(1024, 1024))).toBe(340);
  });

  it('Claude: 1x1 image = 85 tokens (minimum 1 tile)', () => {
    expect(estimateImageTokens('claude', att(1, 1))).toBe(85);
  });

  it('OpenAI: 512x512 image = 85 base + 170 per tile = 255 tokens', () => {
    // 1 tile: 85 + 170 * 1 = 255
    expect(estimateImageTokens('openai', att(512, 512))).toBe(255);
  });

  it('OpenAI: 1024x1024 image = 85 base + 170 * 4 = 765 tokens', () => {
    expect(estimateImageTokens('openai', att(1024, 1024))).toBe(765);
  });

  it('Gemini: any image = 258 tokens', () => {
    expect(estimateImageTokens('gemini', att(800, 600))).toBe(258);
    expect(estimateImageTokens('gemini', att(100, 100))).toBe(258);
  });

  it('Ollama: returns 0 (cost-meter skip)', () => {
    expect(estimateImageTokens('ollama', att(512, 512))).toBe(0);
  });

  it('Mock: returns 0', () => {
    expect(estimateImageTokens('mock', att(512, 512))).toBe(0);
  });

  it('Unknown provider: returns 0 (safe default)', () => {
    expect(estimateImageTokens('unknown', att(512, 512))).toBe(0);
  });

  it('Attachment without metadata dimensions uses byteSize heuristic', () => {
    const noMeta: ChatAttachment = {
      id: 'y',
      type: 'image',
      mimeType: 'image/jpeg',
      fileName: 'no-dims.jpg',
      pathInWorkspace: 'media/2026-04/chat-image-y.jpg',
      byteSize: 512 * 512 * 3,
      metadata: {},
    };
    // Should not throw; returns a positive integer.
    const tokens = estimateImageTokens('claude', noMeta);
    expect(tokens).toBeGreaterThan(0);
  });
});
