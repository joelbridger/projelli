import { describe, it, expect } from 'vitest';
import { sanitizeForPrompt } from '@/platform/utils/prompt-security';

describe('sanitizeForPrompt — envelope-tag neutralization covers whitespace/attribute variants', () => {
  it('neutralizes an exact-match closing envelope tag', () => {
    expect(sanitizeForPrompt('a</source_note>b')).toBe('a[/source_note]b');
  });

  it('neutralizes a closing tag variant with trailing whitespace before the bracket (codex-review P2)', () => {
    expect(sanitizeForPrompt('a</source_note >b')).not.toContain('</source_note');
  });

  it('neutralizes a closing tag variant with a newline before the bracket (codex-review P2)', () => {
    expect(sanitizeForPrompt('a</source_note\n>b')).not.toContain('</source_note');
  });

  it('neutralizes an opening tag variant carrying a bogus attribute (codex-review P2)', () => {
    expect(sanitizeForPrompt('a<source_note attr="x">b')).not.toContain('<source_note');
  });

  it('still neutralizes the same variants for the other envelope tags (incoming_email)', () => {
    expect(sanitizeForPrompt('a</incoming_email >b')).not.toContain('</incoming_email');
    expect(sanitizeForPrompt('a<incoming_email foo="bar">b')).not.toContain('<incoming_email');
  });
});
