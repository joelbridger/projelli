import { describe, it, expect } from 'vitest';
import {
  supportsNativePdf,
  getPdfMode,
  SUPPORTED_PDF_MIME,
} from '@/modules/models/pdf-capability';

describe('supportsNativePdf', () => {
  // Claude - native PDF support on Sonnet and Opus families.
  it('claude-3-5-sonnet-20241022 supports native PDF', () => {
    expect(supportsNativePdf('claude', 'claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('claude-sonnet-4-6 supports native PDF', () => {
    expect(supportsNativePdf('claude', 'claude-sonnet-4-6')).toBe(true);
  });

  it('claude-opus-4-6 supports native PDF', () => {
    expect(supportsNativePdf('claude', 'claude-opus-4-6')).toBe(true);
  });

  it('claude-3-opus-20240229 supports native PDF', () => {
    expect(supportsNativePdf('claude', 'claude-3-opus-20240229')).toBe(true);
  });

  it('claude-3-haiku-20240307 does NOT support native PDF (Haiku 3.x is text-extract only)', () => {
    expect(supportsNativePdf('claude', 'claude-3-haiku-20240307')).toBe(false);
  });

  // Non-Claude providers always text-extract.
  it('openai gpt-4o does NOT support native PDF', () => {
    expect(supportsNativePdf('openai', 'gpt-4o')).toBe(false);
  });

  it('gemini-1.5-pro does NOT support native PDF', () => {
    expect(supportsNativePdf('gemini', 'gemini-1.5-pro')).toBe(false);
  });

  it('ollama llava does NOT support native PDF', () => {
    expect(supportsNativePdf('ollama', 'llava')).toBe(false);
  });

  it('mock provider does NOT support native PDF (uses text-extract for recording)', () => {
    expect(supportsNativePdf('mock', 'mock-model')).toBe(false);
  });
});

describe('getPdfMode', () => {
  it('returns native for Claude Sonnet', () => {
    expect(getPdfMode('claude', 'claude-3-5-sonnet-20241022')).toBe('native');
  });

  it('returns text-extract for Claude Haiku (no native PDF support)', () => {
    expect(getPdfMode('claude', 'claude-3-haiku-20240307')).toBe('text-extract');
  });

  it('returns text-extract for OpenAI', () => {
    expect(getPdfMode('openai', 'gpt-4o')).toBe('text-extract');
  });

  it('returns text-extract for Gemini', () => {
    expect(getPdfMode('gemini', 'gemini-1.5-pro')).toBe('text-extract');
  });

  it('returns text-extract for Ollama', () => {
    expect(getPdfMode('ollama', 'llama3.2:3b')).toBe('text-extract');
  });

  it('returns text-extract for Mock', () => {
    expect(getPdfMode('mock', 'mock-model')).toBe('text-extract');
  });
});

describe('SUPPORTED_PDF_MIME', () => {
  it('equals application/pdf', () => {
    expect(SUPPORTED_PDF_MIME).toBe('application/pdf');
  });
});
