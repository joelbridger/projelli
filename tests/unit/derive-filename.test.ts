/**
 * Unit test for UX-28's `deriveFilenameFromMessage` helper.
 *
 * The drag-to-tree flow in AIChatViewer → FileTree sends the message
 * content through this function to pick a filename. It has to be stable
 * against markdown headings, naked text, empty strings, and non-ASCII
 * characters — all reasonable inputs for a chat response.
 */

import { describe, expect, it } from 'vitest';
import { deriveFilenameFromMessage } from '../../src/utils/fileDrop';

describe('deriveFilenameFromMessage', () => {
  it('uses a leading markdown heading when present', () => {
    const content = '# Quarterly Plan\n\nSome body text.';
    expect(deriveFilenameFromMessage(content)).toBe('quarterly-plan.md');
  });

  it('uses a sub-heading when that is the first heading', () => {
    const content = '## Pricing ideas\nbody...';
    expect(deriveFilenameFromMessage(content)).toBe('pricing-ideas.md');
  });

  it('falls back to the first non-empty line for naked text', () => {
    const content = '\n\nbuild a go-to-market plan for Keepance\n\ndetails...';
    expect(deriveFilenameFromMessage(content)).toBe(
      'build-a-go-to-market-plan-for-keepance.md'
    );
  });

  it('kebab-cases and strips non-ASCII alphanumerics', () => {
    const content = '# Hello, World! (v2)  — final';
    expect(deriveFilenameFromMessage(content)).toBe('hello-world-v2-final.md');
  });

  it('clips long headings to 60 slug chars', () => {
    const content =
      '# This is an absurdly long heading that keeps rambling and really should be chopped';
    const derived = deriveFilenameFromMessage(content);
    expect(derived.endsWith('.md')).toBe(true);
    expect(derived.length).toBeLessThanOrEqual(63); // 60 + ".md"
  });

  it('falls back to chat-message.md when content is empty', () => {
    expect(deriveFilenameFromMessage('')).toBe('chat-message.md');
    expect(deriveFilenameFromMessage('   \n\n  \n')).toBe('chat-message.md');
  });

  it('falls back to chat-message.md when slug is entirely non-ASCII', () => {
    // A heading that's only non-ASCII characters produces an empty slug.
    // The helper should detect the empty result and use the fallback.
    expect(deriveFilenameFromMessage('# ••••')).toBe('chat-message.md');
  });
});
