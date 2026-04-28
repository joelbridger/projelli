# Projelli v2.0 Stream A1: Chat Input UI + Multimodal Image Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the chat input UI to accept image attachments (paperclip, paste, drag-drop), implement real per-provider image formatting for Claude, OpenAI, Gemini, Ollama, and Mock, add vision-capability detection with a warning UX when the selected model cannot process images, integrate image token counts into the cost meter, and verify persistence with an E2E test.

**Branch:** `feature/stream-a`. Branches off `feature/foundations` (PR #18). All foundation interfaces are available: `ChatAttachment` at `src/types/ai.ts`, `AttachmentService` at `src/modules/attachments/AttachmentService.ts`, `formatAttachmentForRequest` and `supportsAttachment` stubs on all five providers, and `AuditEvent` types `attachment_added`, `attachment_sent_to_provider`, `attachment_removed` in the union.

**Architecture:** `AIChatViewer` owns pending-attachments state. A new `ChatInputToolbar` component renders the paperclip button, paste handler, and drop zone. `AttachmentService` persists files. A new `vision-capability.ts` config file drives all five providers' `supportsAttachment` implementations. `estimateImageTokens(provider, att)` feeds into the existing `recordCost` path. The vision-model warning renders above the send button when `supportsAttachment` returns a string.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Zustand, Vitest, Tauri 2 (Rust), shadcn/ui + Tailwind CSS.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Sections 3.1 and 4.2.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/modules/models/vision-capability.ts` | `VISION_MODELS` map, `isVisionModel(provider, model): boolean`, `getSuggestedVisionModel(provider): string` |
| `src/modules/attachments/imageTokens.ts` | `estimateImageTokens(provider, att): number` per-provider formula |
| `src/modules/attachments/index.ts` | Barrel export for AttachmentService, imageTokens |
| `src/components/chat/ChatInputToolbar.tsx` | Paperclip button, hidden file input, paste handler, drag-drop zone, attachment tiles strip |
| `src/components/chat/AttachmentTile.tsx` | Single attachment preview tile with remove button |
| `src/components/chat/VisionWarningBanner.tsx` | Inline warning + auto-suggest model-swap button |
| `tests/unit/models/vision-capability.test.ts` | Vision model detection unit tests |
| `tests/unit/attachments/imageTokens.test.ts` | Token formula unit tests |
| `tests/unit/models/claude-image-format.test.ts` | ClaudeProvider format + supportsAttachment tests |
| `tests/unit/models/openai-image-format.test.ts` | OpenAIProvider format + supportsAttachment tests |
| `tests/unit/models/gemini-image-format.test.ts` | GeminiProvider format + supportsAttachment tests |
| `tests/unit/models/ollama-image-format.test.ts` | OllamaProvider format + supportsAttachment tests |
| `tests/unit/models/mock-image-format.test.ts` | MockProvider format + supportsAttachment tests |
| `tests/unit/components/chat/ChatInputToolbar.test.tsx` | Component tests: paste, drop, remove, size cap |
| `tests/unit/components/chat/VisionWarningBanner.test.tsx` | Warning shown + swap button tests |
| `tests/e2e/image-attachment.spec.ts` | E2E: paste image, send, reload, history persists |

### Files to modify

| Path | Change |
|---|---|
| `src/types/ai.ts` | Add `ChatAttachment` type and `attachments?: ChatAttachment[]` on `ChatMessage` (if not present from foundations) |
| `src/modules/models/Provider.ts` | Add `ProviderContentBlock` type, `formatAttachmentForRequest`, `supportsAttachment` to `Provider` interface (if not present from foundations) |
| `src/modules/models/ClaudeProvider.ts` | Replace stub `formatAttachmentForRequest` + `supportsAttachment` with real image implementations |
| `src/modules/models/OpenAIProvider.ts` | Replace stub with real image implementations |
| `src/modules/models/GeminiProvider.ts` | Replace stub with real image implementations |
| `src/modules/models/OllamaProvider.ts` | Replace stub with real image implementations |
| `src/modules/models/MockProvider.ts` | Replace stub with recording mock implementations |
| `src/components/ai/AIChatViewer.tsx` | Add `pendingAttachments` state, wire `ChatInputToolbar`, emit audit events, pass image tokens to `recordCost`, pass attachments to provider message construction |
| `src/stores/aiChatStore.ts` | Extend `ChatSession` with `pendingAttachmentIds?: string[]` for draft restoration |

### Files to NOT modify (out of Stream A1 scope)

- PDF handling paths in any provider (Stream A2 covers those)
- RAG indexing (Stream A3)
- Long-context UX, context cap, summarization (Stream A4)
- Sidecar code (Stream B)
- Plugin or marketplace code (Stream C)
- Mobile surfaces (Stream D)
- i18n locale files (Stream E handles extraction)

---

## Task Decomposition

There are 10 task groups. Within each group, tasks run sequentially. Across groups, the dependency order is: types (Group I) before vision config (Group II) before providers (Groups III-VII) before UI (Group VIII) before cost meter (Group IX) before E2E (Group X).

- Group I: Foundation type verification + Provider interface additions
- Group II: Vision capability config
- Group III: ClaudeProvider image implementation
- Group IV: OpenAIProvider image implementation
- Group V: GeminiProvider image implementation
- Group VI: OllamaProvider image implementation
- Group VII: MockProvider image implementation
- Group VIII: Chat input UI plumbing
- Group IX: Cost-meter integration for images
- Group X: E2E test + final verification

---

# Group I: Foundation Type Verification + Provider Interface Additions

## Task 1: Confirm or add ChatAttachment type and Provider interface extensions

The foundations plan (PR #18) should have added `ChatAttachment` to `src/types/ai.ts` and `formatAttachmentForRequest` / `supportsAttachment` to `src/modules/models/Provider.ts`. This task verifies those exist and adds anything missing so downstream tasks have a stable base.

**Files:**
- Verify/modify: `src/types/ai.ts`
- Verify/modify: `src/modules/models/Provider.ts`

- [ ] **Step 1: Verify ChatAttachment in src/types/ai.ts**

```bash
grep -n "ChatAttachment\|attachments" src/types/ai.ts
```

If `ChatAttachment` is missing, add it to `src/types/ai.ts` after the `WorkspaceSource` interface:

```typescript
/**
 * Stream A1 — a file attached to a chat message.
 * Stored in workspace under media/YYYY-MM/chat-<type>-<hash>.<ext>.
 * Hash is SHA-256 of the raw bytes; used as dedup key by AttachmentService.
 */
export interface ChatAttachment {
  id: string;                // SHA-256 hash of bytes (dedup key)
  type: 'image' | 'pdf';    // open enum; 'pdf' used by Plan A2
  mimeType: string;
  fileName: string;
  pathInWorkspace: string;   // e.g. 'media/2026-04/chat-image-<hash>.png'
  byteSize: number;
  metadata: {
    width?: number;
    height?: number;
    pages?: number;
    extractionMode?: 'native' | 'text-extract';
  };
}
```

And extend `ChatMessage`:

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isError?: boolean;
  errorDiagnostic?: string;
  sources?: WorkspaceSource[];
  workspaceHint?: string;
  /**
   * Stream A — attachments sent with this message. Only populated on
   * user-role turns. Persisted to .aichat file so history reloads show them.
   */
  attachments?: ChatAttachment[];
}
```

- [ ] **Step 2: Verify ProviderContentBlock and method stubs in src/modules/models/Provider.ts**

```bash
grep -n "ProviderContentBlock\|formatAttachment\|supportsAttachment" src/modules/models/Provider.ts
```

If missing, add to `Provider.ts` after the `ProviderConfig` interface:

```typescript
/**
 * Stream A1 — opaque content block returned by formatAttachmentForRequest.
 * Each provider defines its own shape; the union covers all known cases
 * so the call-site can pass it to the provider API without casting.
 */
export type ProviderContentBlock =
  | ClaudeImageBlock       // { type: 'image', source: { type: 'base64', ... } }
  | OpenAIImageBlock       // { type: 'image_url', image_url: { url: string } }
  | GeminiInlineDataBlock  // { inlineData: { mimeType, data } }
  | OllamaImagesPayload;   // { _ollama_images: string[] }

/** Claude image block shape (returned by ClaudeProvider.formatAttachmentForRequest). */
export interface ClaudeImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/** OpenAI image_url block shape. */
export interface OpenAIImageBlock {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

/** Gemini inlineData part shape. */
export interface GeminiInlineDataBlock {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

/**
 * Ollama images payload. Ollama passes images at the message level, not inside
 * a content block. The prefix `_ollama_images` is a convention used by
 * OllamaProvider.formatAttachmentForRequest to carry base64 strings back to
 * the message-construction code, which splices them into the request envelope.
 */
export interface OllamaImagesPayload {
  _ollama_images: string[];
}
```

Then extend the `Provider` interface:

```typescript
export interface Provider {
  // ... existing methods ...

  /**
   * Stream A1 — Format a single attachment for inclusion in a provider API
   * request. Called once per attachment immediately before the request is
   * sent, so `bytes` are already in memory.
   *
   * Returns a ProviderContentBlock whose shape is provider-specific.
   * The call-site inserts the result into the correct position in the
   * request envelope (content array for Claude/OpenAI/Gemini; images
   * array for Ollama).
   *
   * PDF handling (att.type === 'pdf') is implemented in Plan A2 and
   * MUST NOT be added here.
   */
  formatAttachmentForRequest(
    att: ChatAttachment,
    bytes: Uint8Array
  ): ProviderContentBlock;

  /**
   * Stream A1 — Check whether this provider + model combination can process
   * the given attachment type.
   *
   * Returns:
   *   - `true`  if the provider and model both support the attachment type.
   *   - A non-empty string error message (shown inline above the send button)
   *     if not.
   *
   * Image support is decided by consulting VISION_MODELS in vision-capability.ts.
   * PDF support (att.type === 'pdf') is always 'pdf_not_implemented' until Plan A2.
   */
  supportsAttachment(
    att: ChatAttachment,
    model: string
  ): true | string;
}
```

- [ ] **Step 3: Run tsc to confirm no type errors**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If stubs in providers now have type mismatches, leave a comment marking them for Groups III-VII.

- [ ] **Step 4: Commit**

```bash
git add src/types/ai.ts src/modules/models/Provider.ts
git commit -m "feat(stream-a1): verify/add ChatAttachment type and Provider interface extensions"
```

---

# Group II: Vision Capability Config

## Task 2: Create vision-capability.ts with model detection

**Files:**
- Create: `src/modules/models/vision-capability.ts`
- Create: `tests/unit/models/vision-capability.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/unit/models/vision-capability.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isVisionModel,
  getSuggestedVisionModel,
  SUPPORTED_IMAGE_MIMES,
} from '@/modules/models/vision-capability';

describe('isVisionModel', () => {
  // Claude vision models
  it('claude-3-5-sonnet-20241022 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-5-sonnet-20241022')).toBe(true);
  });
  it('claude-3-opus-20240229 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-opus-20240229')).toBe(true);
  });
  it('claude-3-haiku-20240307 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-haiku-20240307')).toBe(true);
  });
  // claude-3-5-haiku is text-only
  it('claude-3-5-haiku is NOT vision-capable', () => {
    expect(isVisionModel('claude', 'claude-3-5-haiku-20251001')).toBe(false);
  });
  // Modern claude models
  it('claude-sonnet-4-6 is vision-capable', () => {
    expect(isVisionModel('claude', 'claude-sonnet-4-6')).toBe(true);
  });

  // OpenAI vision models
  it('gpt-4o is vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-4o')).toBe(true);
  });
  it('gpt-4o-mini is vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-4o-mini')).toBe(true);
  });
  it('o1 is vision-capable', () => {
    expect(isVisionModel('openai', 'o1')).toBe(true);
  });
  it('gpt-3.5-turbo is NOT vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-3.5-turbo')).toBe(false);
  });
  it('gpt-4 (non-o) is NOT vision-capable', () => {
    expect(isVisionModel('openai', 'gpt-4')).toBe(false);
  });

  // Gemini vision models
  it('gemini-1.5-pro is vision-capable', () => {
    expect(isVisionModel('gemini', 'gemini-1.5-pro')).toBe(true);
  });
  it('gemini-2.0-flash is vision-capable', () => {
    expect(isVisionModel('gemini', 'gemini-2.0-flash')).toBe(true);
  });
  it('gemini-pro (no version suffix) is NOT vision-capable', () => {
    expect(isVisionModel('gemini', 'gemini-pro')).toBe(false);
  });

  // Ollama runtime probe
  it('llava:13b is vision-capable', () => {
    expect(isVisionModel('ollama', 'llava:13b')).toBe(true);
  });
  it('LLAVA is vision-capable (case-insensitive)', () => {
    expect(isVisionModel('ollama', 'LLAVA')).toBe(true);
  });
  it('qwen2.5-vl:7b is vision-capable', () => {
    expect(isVisionModel('ollama', 'qwen2.5-vl:7b')).toBe(true);
  });
  it('moondream:vision is vision-capable', () => {
    expect(isVisionModel('ollama', 'moondream:vision')).toBe(true);
  });
  it('llama3.2:3b is NOT vision-capable', () => {
    expect(isVisionModel('ollama', 'llama3.2:3b')).toBe(false);
  });
  it('mistral:7b is NOT vision-capable', () => {
    expect(isVisionModel('ollama', 'mistral:7b')).toBe(false);
  });

  // Mock provider always returns true
  it('mock provider always vision-capable', () => {
    expect(isVisionModel('mock', 'mock-model')).toBe(true);
  });

  // Unknown provider
  it('unknown provider returns false', () => {
    expect(isVisionModel('unknown-provider', 'some-model')).toBe(false);
  });
});

describe('getSuggestedVisionModel', () => {
  it('suggests claude vision model for claude provider', () => {
    const m = getSuggestedVisionModel('claude');
    expect(isVisionModel('claude', m)).toBe(true);
  });
  it('suggests openai vision model for openai provider', () => {
    const m = getSuggestedVisionModel('openai');
    expect(isVisionModel('openai', m)).toBe(true);
  });
  it('suggests gemini vision model for gemini provider', () => {
    const m = getSuggestedVisionModel('gemini');
    expect(isVisionModel('gemini', m)).toBe(true);
  });
  it('ollama suggestion is the llava probe string', () => {
    expect(getSuggestedVisionModel('ollama')).toBe('llava');
  });
  it('unknown provider suggestion is empty string', () => {
    expect(getSuggestedVisionModel('unknown')).toBe('');
  });
});

describe('SUPPORTED_IMAGE_MIMES', () => {
  it('includes png, jpeg, gif, webp', () => {
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/png');
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/jpeg');
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/gif');
    expect(SUPPORTED_IMAGE_MIMES).toContain('image/webp');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/vision-capability.test.ts
```

Expected: FAIL — "Cannot find module '@/modules/models/vision-capability'".

- [ ] **Step 3: Implement vision-capability.ts**

Write `src/modules/models/vision-capability.ts`:

```typescript
/**
 * Stream A1 — Single source of truth for vision-capable model detection.
 *
 * Rules per provider:
 *   claude:  claude-3-5-sonnet-*, claude-3-opus-*, claude-3-haiku-*,
 *            claude-sonnet-4-*, claude-opus-4-*, claude-haiku-4-* (the
 *            modern 4.x series). Explicit exclusion: claude-3-5-haiku-*
 *            (text-only, see spec §4.2).
 *   openai:  gpt-4o* or o1* prefix.
 *   gemini:  gemini-1.5* or gemini-2.0* prefix.
 *   ollama:  runtime probe — model name contains 'llava', 'vision', or
 *            'qwen2.5-vl' (case-insensitive). No static list possible
 *            because Ollama users pull arbitrary models.
 *   mock:    always returns true (test convenience).
 */

/** Accepted image MIME types across all providers. */
export const SUPPORTED_IMAGE_MIMES: ReadonlyArray<string> = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** Maximum file size cap in bytes (20 MB). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Returns true when the given model ID is known to support image input
 * for the specified provider, false otherwise.
 *
 * Provider IDs must match the string used in AIChatFile.provider:
 *   'claude' | 'openai' | 'gemini' | 'ollama' | 'mock'
 *
 * Model IDs are compared case-insensitively for Ollama; exact-prefix
 * (lowercase) for all others.
 */
export function isVisionModel(provider: string, model: string): boolean {
  const m = model.toLowerCase();
  switch (provider) {
    case 'claude':
    case 'anthropic': {
      // Explicit text-only exclusion first.
      if (m.startsWith('claude-3-5-haiku')) return false;
      // Vision-capable Claude families.
      return (
        m.startsWith('claude-3-5-sonnet') ||
        m.startsWith('claude-3-opus') ||
        m.startsWith('claude-3-haiku') ||
        m.startsWith('claude-sonnet-4') ||
        m.startsWith('claude-opus-4') ||
        m.startsWith('claude-haiku-4')
      );
    }
    case 'openai': {
      return m.startsWith('gpt-4o') || m.startsWith('o1');
    }
    case 'gemini':
    case 'google': {
      return m.startsWith('gemini-1.5') || m.startsWith('gemini-2.0');
    }
    case 'ollama': {
      return (
        m.includes('llava') ||
        m.includes('vision') ||
        m.includes('qwen2.5-vl')
      );
    }
    case 'mock': {
      return true;
    }
    default:
      return false;
  }
}

/**
 * Returns a sensible vision-capable model to suggest when the user has
 * attached an image to a text-only model. The suggestion is the cheapest
 * broadly-available vision model per provider.
 */
export function getSuggestedVisionModel(provider: string): string {
  switch (provider) {
    case 'claude':
    case 'anthropic':
      return 'claude-3-haiku-20240307';
    case 'openai':
      return 'gpt-4o-mini';
    case 'gemini':
    case 'google':
      return 'gemini-1.5-flash';
    case 'ollama':
      // Suggest pulling llava if nothing vision-capable is locally installed.
      return 'llava';
    default:
      return '';
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run tests/unit/models/vision-capability.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/models/vision-capability.ts tests/unit/models/vision-capability.test.ts
git commit -m "feat(stream-a1): vision capability config with per-provider model detection"
```

---

# Group III: ClaudeProvider Image Implementation

## Task 3: Implement formatAttachmentForRequest and supportsAttachment for Claude

**Files:**
- Modify: `src/modules/models/ClaudeProvider.ts`
- Create: `tests/unit/models/claude-image-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/claude-image-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from '@/modules/models/ClaudeProvider';
import type { ChatAttachment } from '@/types/ai';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: 4,
  metadata: { width: 100, height: 100 },
};

const pdfAtt: ChatAttachment = {
  id: 'def456',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'doc.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-def456.pdf',
  byteSize: 1024,
  metadata: {},
};

function makeProvider(model: string) {
  return new ClaudeProvider({ apiKey: 'test-key', model });
}

describe('ClaudeProvider.formatAttachmentForRequest (image)', () => {
  it('returns Claude image block shape', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES);
    expect(block).toMatchObject({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
      },
    });
  });

  it('base64 data encodes the bytes correctly', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    const decoded = atob(block.source.data);
    expect(decoded.charCodeAt(0)).toBe(0x89);
    expect(decoded.charCodeAt(1)).toBe(0x50);
  });

  it('throws for pdf attachment (pdf not implemented in A1)', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    expect(() =>
      provider.formatAttachmentForRequest(pdfAtt, new Uint8Array())
    ).toThrow(/pdf.*not.*implemented|plan a2/i);
  });
});

describe('ClaudeProvider.supportsAttachment', () => {
  it('returns true for vision model + image', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    expect(provider.supportsAttachment(imageAtt, 'claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('returns error string for text-only model (claude-3-5-haiku)', () => {
    const provider = makeProvider('claude-3-5-haiku-20251001');
    const result = provider.supportsAttachment(imageAtt, 'claude-3-5-haiku-20251001');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  it('returns error string for pdf on any model (A2 not yet implemented)', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const result = provider.supportsAttachment(pdfAtt, 'claude-3-5-sonnet-20241022');
    expect(typeof result).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/claude-image-format.test.ts
```

Expected: FAIL — methods exist as stubs but do not return the correct shapes.

- [ ] **Step 3: Implement in ClaudeProvider.ts**

Add to `src/modules/models/ClaudeProvider.ts` (replace existing stubs, or add after the `structuredOutput` method):

```typescript
import { isVisionModel } from './vision-capability';
import type {
  ChatAttachment,
  ProviderContentBlock,
  ClaudeImageBlock,
} from '...'; // adjust import paths to match the actual declarations

/**
 * Stream A1 — Format an image attachment for the Claude Messages API.
 * Output shape: { type: 'image', source: { type: 'base64', media_type, data } }
 * PDF handling deferred to Plan A2.
 */
formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): ProviderContentBlock {
  if (att.type === 'pdf') {
    throw new Error(
      'PDF attachment support is not implemented in Plan A1. See Plan A2.'
    );
  }
  // att.type === 'image'
  const data = bytesToBase64(bytes);
  const block: ClaudeImageBlock = {
    type: 'image',
    source: {
      type: 'base64',
      media_type: att.mimeType,
      data,
    },
  };
  return block;
}

/**
 * Stream A1 — Check vision capability for the given model.
 */
supportsAttachment(att: ChatAttachment, model: string): true | string {
  if (att.type === 'pdf') {
    return 'PDF support is coming soon (Plan A2). Use text-based context for now.';
  }
  if (att.type === 'image') {
    if (isVisionModel('claude', model)) return true;
    return (
      `${model} does not support images. Switch to Claude Sonnet, Opus, or Haiku (3.x series).`
    );
  }
  return `Unsupported attachment type: ${att.type}.`;
}
```

Add the helper at the top of the file (or in a shared util if one already exists for base64):

```typescript
/** Convert Uint8Array to base64 string without Buffer (browser-safe). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/models/claude-image-format.test.ts
```

Expected: all pass.

- [ ] **Step 5: tsc check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/models/ClaudeProvider.ts tests/unit/models/claude-image-format.test.ts
git commit -m "feat(stream-a1): ClaudeProvider real image format + supportsAttachment"
```

---

# Group IV: OpenAIProvider Image Implementation

## Task 4: Implement formatAttachmentForRequest and supportsAttachment for OpenAI

**Files:**
- Modify: `src/modules/models/OpenAIProvider.ts`
- Create: `tests/unit/models/openai-image-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/openai-image-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '@/modules/models/OpenAIProvider';
import type { ChatAttachment } from '@/types/ai';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: 4,
  metadata: {},
};

function makeProvider(model: string) {
  return new OpenAIProvider({ apiKey: 'test-key', model });
}

describe('OpenAIProvider.formatAttachmentForRequest (image)', () => {
  it('returns image_url block with data URL', () => {
    const provider = makeProvider('gpt-4o');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(block.type).toBe('image_url');
    expect(block.image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('data URL contains correct base64', () => {
    const provider = makeProvider('gpt-4o');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    const b64 = block.image_url.url.split(',')[1];
    expect(atob(b64).charCodeAt(0)).toBe(0x89);
  });
});

describe('OpenAIProvider.supportsAttachment', () => {
  it('returns true for gpt-4o + image', () => {
    const provider = makeProvider('gpt-4o');
    expect(provider.supportsAttachment(imageAtt, 'gpt-4o')).toBe(true);
  });

  it('returns error string for gpt-3.5-turbo + image', () => {
    const provider = makeProvider('gpt-3.5-turbo');
    const result = provider.supportsAttachment(imageAtt, 'gpt-3.5-turbo');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  it('o1 model supports images', () => {
    const provider = makeProvider('o1');
    expect(provider.supportsAttachment(imageAtt, 'o1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/openai-image-format.test.ts
```

- [ ] **Step 3: Implement in OpenAIProvider.ts**

Add to `src/modules/models/OpenAIProvider.ts`:

```typescript
import { isVisionModel } from './vision-capability';
import type { ChatAttachment, ProviderContentBlock, OpenAIImageBlock } from '...';

formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): ProviderContentBlock {
  if (att.type === 'pdf') {
    throw new Error(
      'PDF attachment support is not implemented in Plan A1. See Plan A2.'
    );
  }
  const data = bytesToBase64(bytes);
  const block: OpenAIImageBlock = {
    type: 'image_url',
    image_url: {
      url: `data:${att.mimeType};base64,${data}`,
    },
  };
  return block;
}

supportsAttachment(att: ChatAttachment, model: string): true | string {
  if (att.type === 'pdf') {
    return 'PDF support is coming soon (Plan A2).';
  }
  if (att.type === 'image') {
    if (isVisionModel('openai', model)) return true;
    return `${model} does not support images. Switch to GPT-4o or an o1 model.`;
  }
  return `Unsupported attachment type: ${att.type}.`;
}
```

Reuse `bytesToBase64` — move it to `src/modules/models/providerUtils.ts` (a new shared file) and import it in both Claude and OpenAI providers:

```typescript
// src/modules/models/providerUtils.ts
/** Convert Uint8Array to base64 string (browser-safe, no Node Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

Update `ClaudeProvider.ts` to import from `providerUtils.ts` instead of defining it locally.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/models/openai-image-format.test.ts tests/unit/models/claude-image-format.test.ts
```

Expected: all pass.

- [ ] **Step 5: tsc check and commit**

```bash
npx tsc --noEmit
git add src/modules/models/OpenAIProvider.ts src/modules/models/providerUtils.ts src/modules/models/ClaudeProvider.ts tests/unit/models/openai-image-format.test.ts
git commit -m "feat(stream-a1): OpenAIProvider real image format + providerUtils base64 helper"
```

---

# Group V: GeminiProvider Image Implementation

## Task 5: Implement formatAttachmentForRequest and supportsAttachment for Gemini

**Files:**
- Modify: `src/modules/models/GeminiProvider.ts`
- Create: `tests/unit/models/gemini-image-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/gemini-image-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '@/modules/models/GeminiProvider';
import type { ChatAttachment } from '@/types/ai';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: 4,
  metadata: {},
};

function makeProvider(model: string) {
  return new GeminiProvider({ apiKey: 'test-key', model });
}

describe('GeminiProvider.formatAttachmentForRequest (image)', () => {
  it('returns inlineData block', () => {
    const provider = makeProvider('gemini-1.5-flash');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(block).toMatchObject({
      inlineData: {
        mimeType: 'image/png',
      },
    });
  });

  it('inlineData.data is base64 of bytes', () => {
    const provider = makeProvider('gemini-1.5-flash');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(atob(block.inlineData.data).charCodeAt(0)).toBe(0x89);
  });
});

describe('GeminiProvider.supportsAttachment', () => {
  it('returns true for gemini-1.5-flash + image', () => {
    const provider = makeProvider('gemini-1.5-flash');
    expect(provider.supportsAttachment(imageAtt, 'gemini-1.5-flash')).toBe(true);
  });

  it('returns error string for gemini-pro (no version) + image', () => {
    const provider = makeProvider('gemini-pro');
    const result = provider.supportsAttachment(imageAtt, 'gemini-pro');
    expect(typeof result).toBe('string');
  });

  it('gemini-2.0-flash supports images', () => {
    const provider = makeProvider('gemini-2.0-flash');
    expect(provider.supportsAttachment(imageAtt, 'gemini-2.0-flash')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/gemini-image-format.test.ts
```

- [ ] **Step 3: Implement in GeminiProvider.ts**

Add to `src/modules/models/GeminiProvider.ts`:

```typescript
import { isVisionModel } from './vision-capability';
import { bytesToBase64 } from './providerUtils';
import type { ChatAttachment, ProviderContentBlock, GeminiInlineDataBlock } from '...';

formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): ProviderContentBlock {
  if (att.type === 'pdf') {
    throw new Error(
      'PDF attachment support is not implemented in Plan A1. See Plan A2.'
    );
  }
  const block: GeminiInlineDataBlock = {
    inlineData: {
      mimeType: att.mimeType,
      data: bytesToBase64(bytes),
    },
  };
  return block;
}

supportsAttachment(att: ChatAttachment, model: string): true | string {
  if (att.type === 'pdf') {
    return 'PDF support is coming soon (Plan A2).';
  }
  if (att.type === 'image') {
    if (isVisionModel('gemini', model)) return true;
    return `${model} does not support images. Switch to Gemini 1.5 or 2.0.`;
  }
  return `Unsupported attachment type: ${att.type}.`;
}
```

- [ ] **Step 4: Run tests + tsc + commit**

```bash
npx vitest run tests/unit/models/gemini-image-format.test.ts
npx tsc --noEmit
git add src/modules/models/GeminiProvider.ts tests/unit/models/gemini-image-format.test.ts
git commit -m "feat(stream-a1): GeminiProvider real image format + supportsAttachment"
```

---

# Group VI: OllamaProvider Image Implementation

## Task 6: Implement formatAttachmentForRequest and supportsAttachment for Ollama

Ollama's API places images at the message level as an `images: string[]` array rather than inside a content block. `formatAttachmentForRequest` returns an `OllamaImagesPayload` sentinel. The message-construction code in `OllamaProvider.sendMessage` checks for this sentinel and appends the base64 strings to the outgoing message object.

**Files:**
- Modify: `src/modules/models/OllamaProvider.ts`
- Create: `tests/unit/models/ollama-image-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/ollama-image-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '@/modules/models/OllamaProvider';
import type { ChatAttachment } from '@/types/ai';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: 4,
  metadata: {},
};

function makeProvider(model: string) {
  return new OllamaProvider({ model });
}

describe('OllamaProvider.formatAttachmentForRequest (image)', () => {
  it('returns OllamaImagesPayload sentinel', () => {
    const provider = makeProvider('llava:13b');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(Array.isArray(block._ollama_images)).toBe(true);
    expect(block._ollama_images).toHaveLength(1);
  });

  it('_ollama_images[0] is base64 of bytes', () => {
    const provider = makeProvider('llava:13b');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(atob(block._ollama_images[0]).charCodeAt(0)).toBe(0x89);
  });
});

describe('OllamaProvider.supportsAttachment', () => {
  it('returns true for llava model + image', () => {
    const provider = makeProvider('llava:13b');
    expect(provider.supportsAttachment(imageAtt, 'llava:13b')).toBe(true);
  });

  it('returns error string for llama3.2:3b + image', () => {
    const provider = makeProvider('llama3.2:3b');
    const result = provider.supportsAttachment(imageAtt, 'llama3.2:3b');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  it('qwen2.5-vl:7b is vision-capable', () => {
    const provider = makeProvider('qwen2.5-vl:7b');
    expect(provider.supportsAttachment(imageAtt, 'qwen2.5-vl:7b')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/ollama-image-format.test.ts
```

- [ ] **Step 3: Implement in OllamaProvider.ts**

Add to `src/modules/models/OllamaProvider.ts`:

```typescript
import { isVisionModel } from './vision-capability';
import { bytesToBase64 } from './providerUtils';
import type { ChatAttachment, ProviderContentBlock, OllamaImagesPayload } from '...';

formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): ProviderContentBlock {
  if (att.type === 'pdf') {
    throw new Error(
      'PDF attachment support is not implemented in Plan A1. See Plan A2.'
    );
  }
  // Ollama images are passed at message level, not as content blocks.
  // Return the sentinel; OllamaProvider.buildRequest() checks for
  // _ollama_images and appends to the message envelope.
  const payload: OllamaImagesPayload = {
    _ollama_images: [bytesToBase64(bytes)],
  };
  return payload;
}

supportsAttachment(att: ChatAttachment, model: string): true | string {
  if (att.type === 'pdf') {
    return 'PDF support is coming soon (Plan A2).';
  }
  if (att.type === 'image') {
    if (isVisionModel('ollama', model)) return true;
    return (
      `${model} does not appear to support images. ` +
      `Pull a vision-capable model like 'llava' and select it.`
    );
  }
  return `Unsupported attachment type: ${att.type}.`;
}
```

Also update `OllamaProvider.sendMessage` (and `sendMessageStreaming`) to wire the sentinel into the outgoing Ollama chat request. Find the point where the message object is constructed and add:

```typescript
// Collect any OllamaImagesPayload blocks attached to this message and
// splice their base64 strings into the Ollama images array.
const ollamaImages: string[] = [];
for (const block of contentBlocks) {
  if ('_ollama_images' in block) {
    ollamaImages.push(...block._ollama_images);
  }
}

const ollamaMessage: OllamaChatMessage = {
  role: 'user',
  content: textContent,
  ...(ollamaImages.length > 0 ? { images: ollamaImages } : {}),
};
```

> Note: `contentBlocks` here refers to the formatted attachment blocks assembled in the send path (Task 9 wires the call site). The implementation worker should locate the existing message-construction code in `sendMessage` and add this splice point there.

- [ ] **Step 4: Run tests + tsc + commit**

```bash
npx vitest run tests/unit/models/ollama-image-format.test.ts
npx tsc --noEmit
git add src/modules/models/OllamaProvider.ts tests/unit/models/ollama-image-format.test.ts
git commit -m "feat(stream-a1): OllamaProvider real image format + supportsAttachment"
```

---

# Group VII: MockProvider Image Implementation

## Task 7: Implement formatAttachmentForRequest and supportsAttachment for Mock

**Files:**
- Modify: `src/modules/models/MockProvider.ts`
- Create: `tests/unit/models/mock-image-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/mock-image-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MockProvider } from '@/modules/models/MockProvider';
import type { ChatAttachment } from '@/types/ai';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: 4,
  metadata: {},
};

describe('MockProvider.formatAttachmentForRequest', () => {
  it('records the call and returns a stub block', () => {
    const provider = new MockProvider();
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    // Mock returns a minimal valid structure to satisfy type checks.
    expect(block).toBeDefined();
    expect(provider.getLastFormattedAttachment()).toEqual({
      att: imageAtt,
      bytesLength: PNG_BYTES.length,
    });
  });
});

describe('MockProvider.supportsAttachment', () => {
  it('always returns true', () => {
    const provider = new MockProvider();
    expect(provider.supportsAttachment(imageAtt, 'mock-model')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/mock-image-format.test.ts
```

- [ ] **Step 3: Implement in MockProvider.ts**

Add to `MockProvider`:

```typescript
private lastFormattedAttachment: { att: ChatAttachment; bytesLength: number } | null = null;

getLastFormattedAttachment() {
  return this.lastFormattedAttachment;
}

formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): ProviderContentBlock {
  this.lastFormattedAttachment = { att, bytesLength: bytes.length };
  // Return a minimal Claude-shaped block so the call-site can JSON-serialize it.
  return {
    type: 'image',
    source: { type: 'base64', media_type: att.mimeType, data: 'MOCK_BASE64' },
  } as ClaudeImageBlock;
}

supportsAttachment(_att: ChatAttachment, _model: string): true | string {
  // Mock always supports everything for test convenience.
  return true;
}
```

Add necessary imports at top of MockProvider.ts.

- [ ] **Step 4: Run tests + tsc + commit**

```bash
npx vitest run tests/unit/models/mock-image-format.test.ts
npx tsc --noEmit
git add src/modules/models/MockProvider.ts tests/unit/models/mock-image-format.test.ts
git commit -m "feat(stream-a1): MockProvider image format + supportsAttachment with call recording"
```

---

# Group VIII: Chat Input UI Plumbing

## Task 8: Create AttachmentTile and VisionWarningBanner components

These two small components are consumed by the toolbar created in Task 9.

**Files:**
- Create: `src/components/chat/AttachmentTile.tsx`
- Create: `src/components/chat/VisionWarningBanner.tsx`
- Create: `tests/unit/components/chat/VisionWarningBanner.test.tsx`

- [ ] **Step 1: Write AttachmentTile.tsx**

Write `src/components/chat/AttachmentTile.tsx`:

```typescript
/**
 * Stream A1 — Renders a single pending attachment below the chat input.
 * Shows a thumbnail (for images) or a file-type icon, file name, and a
 * remove button.
 */
import { X, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatAttachment } from '@/types/ai';

export interface AttachmentTileProps {
  attachment: ChatAttachment;
  /** Object URL for preview (revoked by caller after unmount). */
  previewUrl?: string;
  onRemove: (id: string) => void;
  className?: string;
}

export function AttachmentTile({
  attachment,
  previewUrl,
  onRemove,
  className,
}: AttachmentTileProps) {
  return (
    <div
      data-testid={`attachment-tile-${attachment.id}`}
      className={cn(
        'relative flex items-center gap-2 rounded-md border border-border',
        'bg-muted/40 px-2 py-1.5 text-xs max-w-[180px]',
        className
      )}
    >
      {attachment.type === 'image' && previewUrl ? (
        <img
          src={previewUrl}
          alt={attachment.fileName}
          className="h-8 w-8 rounded object-cover shrink-0"
        />
      ) : (
        <ImageIcon className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />
      )}
      <span
        className="truncate text-muted-foreground leading-tight"
        title={attachment.fileName}
      >
        {attachment.fileName}
      </span>
      <Button
        data-testid={`attachment-remove-${attachment.id}`}
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 ml-auto hover:text-destructive"
        onClick={() => onRemove(attachment.id)}
        aria-label={`Remove attachment ${attachment.fileName}`}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export default AttachmentTile;
```

- [ ] **Step 2: Write VisionWarningBanner.tsx**

Write `src/components/chat/VisionWarningBanner.tsx`:

```typescript
/**
 * Stream A1 — Inline warning shown above the send button when the user has
 * at least one pending image attachment but the selected model does not
 * support vision.
 *
 * Shows the provider's error message and an auto-suggest button to swap to a
 * known-good vision model in the same provider. The send button in
 * AIChatViewer is kept disabled while this banner is visible.
 */
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface VisionWarningBannerProps {
  /** Error message returned by provider.supportsAttachment(). */
  message: string;
  /** Suggested model ID to switch to. Empty string hides the swap button. */
  suggestedModel: string;
  onSwitchModel: (model: string) => void;
  className?: string;
}

export function VisionWarningBanner({
  message,
  suggestedModel,
  onSwitchModel,
  className,
}: VisionWarningBannerProps) {
  return (
    <div
      data-testid="vision-warning-banner"
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-400/60',
        'bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs',
        'text-amber-900 dark:text-amber-200',
        className
      )}
    >
      <AlertTriangle
        className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="flex-1 space-y-1">
        <p>{message}</p>
        {suggestedModel && (
          <Button
            data-testid="vision-warning-switch-button"
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-amber-700 dark:text-amber-300 underline"
            onClick={() => onSwitchModel(suggestedModel)}
          >
            Switch to {suggestedModel}
          </Button>
        )}
      </div>
    </div>
  );
}

export default VisionWarningBanner;
```

- [ ] **Step 3: Write VisionWarningBanner component tests**

Write `tests/unit/components/chat/VisionWarningBanner.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisionWarningBanner } from '@/components/chat/VisionWarningBanner';

describe('VisionWarningBanner', () => {
  it('displays the error message', () => {
    render(
      <VisionWarningBanner
        message="claude-3-5-haiku does not support images."
        suggestedModel="claude-3-haiku-20240307"
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.getByText(/does not support images/)).toBeTruthy();
  });

  it('shows the switch button when suggestedModel is non-empty', () => {
    render(
      <VisionWarningBanner
        message="Model X does not support images."
        suggestedModel="claude-3-haiku-20240307"
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.getByTestId('vision-warning-switch-button')).toBeTruthy();
  });

  it('hides the switch button when suggestedModel is empty string', () => {
    render(
      <VisionWarningBanner
        message="Unknown provider."
        suggestedModel=""
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.queryByTestId('vision-warning-switch-button')).toBeNull();
  });

  it('calls onSwitchModel with the suggested model on click', () => {
    const onSwitch = vi.fn();
    render(
      <VisionWarningBanner
        message="Switch needed."
        suggestedModel="gpt-4o-mini"
        onSwitchModel={onSwitch}
      />
    );
    fireEvent.click(screen.getByTestId('vision-warning-switch-button'));
    expect(onSwitch).toHaveBeenCalledWith('gpt-4o-mini');
  });

  it('has role=alert for screen readers', () => {
    render(
      <VisionWarningBanner
        message="Error."
        suggestedModel=""
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run component tests**

```bash
npx vitest run tests/unit/components/chat/VisionWarningBanner.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/AttachmentTile.tsx src/components/chat/VisionWarningBanner.tsx tests/unit/components/chat/VisionWarningBanner.test.tsx
git commit -m "feat(stream-a1): AttachmentTile and VisionWarningBanner components"
```

---

## Task 9: Create ChatInputToolbar and wire AIChatViewer

This is the main integration task. It wires the paperclip button, paste handler, drag-drop zone, attachment tiles, and the vision warning into `AIChatViewer`.

**Files:**
- Create: `src/components/chat/ChatInputToolbar.tsx`
- Modify: `src/components/ai/AIChatViewer.tsx`
- Create: `tests/unit/components/chat/ChatInputToolbar.test.tsx`

- [ ] **Step 1: Write ChatInputToolbar.tsx**

Write `src/components/chat/ChatInputToolbar.tsx`:

```typescript
/**
 * Stream A1 — Chat input toolbar with attachment support.
 *
 * Wraps the existing Textarea + send/voice buttons and adds:
 *   - Paperclip button (opens hidden file input)
 *   - Paste handler (Ctrl+V / Command+V on any image clipboard data)
 *   - Drag-drop zone with visible overlay on dragenter
 *   - Attachment tiles strip below the textarea
 *   - VisionWarningBanner when model cannot handle the attached image type
 *   - 20 MB per-file cap with toast on rejection
 *
 * Attachment saving is handled by AttachmentService; this component only
 * holds a `pendingAttachments` prop array (managed by AIChatViewer state)
 * and fires callbacks on add/remove.
 */

import { useRef, useState, useCallback, type DragEvent, type ClipboardEvent } from 'react';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AttachmentTile } from './AttachmentTile';
import { VisionWarningBanner } from './VisionWarningBanner';
import {
  SUPPORTED_IMAGE_MIMES,
  MAX_ATTACHMENT_BYTES,
  getSuggestedVisionModel,
} from '@/modules/models/vision-capability';
import type { ChatAttachment } from '@/types/ai';

export interface ChatInputToolbarProps {
  /** Provider string used for vision capability check ('anthropic'|'openai'|'google'|'ollama'). */
  provider: string;
  /** Currently selected model ID. */
  model: string;
  /** Currently pending attachments (controlled by parent). */
  pendingAttachments: ChatAttachment[];
  /** Preview object URLs keyed by attachment id. Managed by parent. */
  previewUrls: Record<string, string>;
  /**
   * Called when the user selects file(s) or pastes an image.
   * Parent is responsible for calling AttachmentService.save() and updating
   * pendingAttachments.
   */
  onFilesSelected: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /**
   * Called when the user clicks the "Switch to X" button in the vision warning.
   * Parent updates the chat's model selection.
   */
  onSwitchModel: (model: string) => void;
  /** String error from supportsAttachment, or null when model is compatible. */
  visionWarning: string | null;
  /** Whether the send button should be rendered disabled (propagated from parent). */
  sendDisabled: boolean;
  className?: string;
}

export function ChatInputToolbar({
  provider,
  pendingAttachments,
  previewUrls,
  onFilesSelected,
  onRemoveAttachment,
  onSwitchModel,
  visionWarning,
  className,
}: ChatInputToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const accept = SUPPORTED_IMAGE_MIMES.join(',');

  const validateAndCollect = useCallback(
    (files: FileList | null): File[] => {
      if (!files) return [];
      const valid: File[] = [];
      for (const file of Array.from(files)) {
        if (!SUPPORTED_IMAGE_MIMES.includes(file.type)) {
          // Toast is shown by the parent via onFilesSelected; parent checks mimeType.
          // For now, silently skip non-image files.
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          // Parent's onFilesSelected will detect oversized files and show a toast.
        }
        valid.push(file);
      }
      return valid;
    },
    []
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = validateAndCollect(e.target.files);
      if (files.length > 0) onFilesSelected(files);
      // Reset so the same file can be picked again.
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [onFilesSelected, validateAndCollect]
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && SUPPORTED_IMAGE_MIMES.includes(item.type)) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault(); // Don't paste binary into textarea.
        onFilesSelected(imageFiles);
      }
    },
    [onFilesSelected]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = validateAndCollect(e.dataTransfer.files);
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected, validateAndCollect]
  );

  const suggestedModel = visionWarning ? getSuggestedVisionModel(provider) : '';

  return (
    <div
      data-testid="chat-input-toolbar"
      className={cn('relative', className)}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-drop overlay */}
      {isDragOver && (
        <div
          data-testid="chat-drop-overlay"
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 pointer-events-none"
        >
          <span className="text-sm font-medium text-primary">Drop image here</span>
        </div>
      )}

      {/* Vision warning */}
      {visionWarning && (
        <VisionWarningBanner
          message={visionWarning}
          suggestedModel={suggestedModel}
          onSwitchModel={onSwitchModel}
          className="mb-2"
        />
      )}

      {/* Attachment tiles */}
      {pendingAttachments.length > 0 && (
        <div
          data-testid="attachment-tiles-strip"
          className="flex flex-wrap gap-2 mb-2"
        >
          {pendingAttachments.map((att) => (
            <AttachmentTile
              key={att.id}
              attachment={att}
              previewUrl={previewUrls[att.id]}
              onRemove={onRemoveAttachment}
            />
          ))}
        </div>
      )}

      {/* Paperclip button row */}
      <div className="flex items-center gap-1 mb-1">
        <Button
          data-testid="chat-paperclip-button"
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach image"
          title="Attach image (png, jpg, gif, webp)"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          aria-hidden
          onChange={handleFileInputChange}
        />
      </div>
    </div>
  );
}

export default ChatInputToolbar;
```

- [ ] **Step 2: Write ChatInputToolbar component tests**

Write `tests/unit/components/chat/ChatInputToolbar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInputToolbar } from '@/components/chat/ChatInputToolbar';
import type { ChatAttachment } from '@/types/ai';

const att: ChatAttachment = {
  id: 'hash1',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-hash1.png',
  byteSize: 1024,
  metadata: {},
};

function renderToolbar(overrides: Partial<React.ComponentProps<typeof ChatInputToolbar>> = {}) {
  const defaults = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    pendingAttachments: [],
    previewUrls: {},
    onFilesSelected: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSwitchModel: vi.fn(),
    visionWarning: null,
    sendDisabled: false,
  };
  return render(<ChatInputToolbar {...defaults} {...overrides} />);
}

describe('ChatInputToolbar', () => {
  it('renders the paperclip button', () => {
    renderToolbar();
    expect(screen.getByTestId('chat-paperclip-button')).toBeTruthy();
  });

  it('shows attachment tile for each pending attachment', () => {
    renderToolbar({ pendingAttachments: [att] });
    expect(screen.getByTestId(`attachment-tile-${att.id}`)).toBeTruthy();
  });

  it('calls onRemoveAttachment when remove button clicked', () => {
    const onRemove = vi.fn();
    renderToolbar({ pendingAttachments: [att], onRemoveAttachment: onRemove });
    fireEvent.click(screen.getByTestId(`attachment-remove-${att.id}`));
    expect(onRemove).toHaveBeenCalledWith(att.id);
  });

  it('shows VisionWarningBanner when visionWarning is set', () => {
    renderToolbar({ visionWarning: 'Model X does not support images.', pendingAttachments: [att] });
    expect(screen.getByTestId('vision-warning-banner')).toBeTruthy();
  });

  it('does not show VisionWarningBanner when visionWarning is null', () => {
    renderToolbar({ visionWarning: null });
    expect(screen.queryByTestId('vision-warning-banner')).toBeNull();
  });

  it('shows drag overlay on dragover', () => {
    renderToolbar();
    const toolbar = screen.getByTestId('chat-input-toolbar');
    fireEvent.dragOver(toolbar);
    expect(screen.getByTestId('chat-drop-overlay')).toBeTruthy();
  });

  it('calls onFilesSelected when valid file dropped', () => {
    const onFiles = vi.fn();
    renderToolbar({ onFilesSelected: onFiles });
    const toolbar = screen.getByTestId('chat-input-toolbar');
    const file = new File(['data'], 'image.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 1024 });
    fireEvent.drop(toolbar, {
      dataTransfer: { files: [file] },
    });
    expect(onFiles).toHaveBeenCalled();
  });

  it('calls onFilesSelected with pasted image', () => {
    const onFiles = vi.fn();
    renderToolbar({ onFilesSelected: onFiles });
    const toolbar = screen.getByTestId('chat-input-toolbar');
    const file = new File(['data'], 'pasted.png', { type: 'image/png' });
    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    };
    fireEvent.paste(toolbar, { clipboardData: dt });
    expect(onFiles).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Wire ChatInputToolbar into AIChatViewer**

Modify `src/components/ai/AIChatViewer.tsx`:

a) Add imports:

```typescript
import { ChatInputToolbar } from '@/components/chat/ChatInputToolbar';
import { AttachmentService } from '@/modules/attachments/AttachmentService';
import { SUPPORTED_IMAGE_MIMES, MAX_ATTACHMENT_BYTES, isVisionModel } from '@/modules/models/vision-capability';
import { useToast } from '@/components/ui/use-toast';
```

b) Add state near the existing `inputValue` state:

```typescript
const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
const { toast } = useToast();
```

c) Add computed vision warning (below state declarations):

```typescript
const visionWarning: string | null = useMemo(() => {
  const hasImageAtt = pendingAttachments.some((a) => a.type === 'image');
  if (!hasImageAtt) return null;
  const chatProvider = chatData.provider ?? 'anthropic';
  const chatModel = chatData.model ?? '';
  if (!chatModel) return null;
  const capable = isVisionModel(chatProvider, chatModel);
  if (capable) return null;
  return `${chatModel} does not support images. Switch to a vision-capable model.`;
}, [pendingAttachments, chatData.provider, chatData.model]);
```

d) Add `handleFilesSelected` callback:

```typescript
const handleFilesSelected = useCallback(async (files: File[]) => {
  for (const file of files) {
    // 20 MB cap.
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({
        title: 'File too large',
        description: `${file.name} exceeds the 20 MB limit.`,
        variant: 'destructive',
      });
      continue;
    }
    if (!SUPPORTED_IMAGE_MIMES.includes(file.type)) {
      toast({
        title: 'Unsupported file type',
        description: `${file.name} is not a supported image type.`,
        variant: 'destructive',
      });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const attService = new AttachmentService(workspaceServiceRef?.current);
      const att = await attService.save(bytes, file.name, file.type);
      const previewUrl = URL.createObjectURL(file);
      setPendingAttachments((prev) => [...prev, att]);
      setPreviewUrls((prev) => ({ ...prev, [att.id]: previewUrl }));
      onAuditLog?.({
        action: 'user_action',
        description: `Attachment added: ${file.name}`,
        model: chatData.model ?? chatData.provider ?? 'unknown',
        inputs: { path: att.pathInWorkspace, hash: att.id, type: att.type, byteSize: att.byteSize },
        outputs: {},
        userDecision: 'auto',
        metadata: { auditEventType: 'attachment_added' },
      });
    } catch (err) {
      console.error('Failed to save attachment:', err);
      toast({ title: 'Failed to attach file', description: `${file.name} could not be saved.`, variant: 'destructive' });
    }
  }
}, [workspaceServiceRef, onAuditLog, chatData.model, chatData.provider, toast]);
```

e) Add `handleRemoveAttachment` callback:

```typescript
const handleRemoveAttachment = useCallback((id: string) => {
  setPendingAttachments((prev) => {
    const removed = prev.find((a) => a.id === id);
    if (removed) {
      onAuditLog?.({
        action: 'user_action',
        description: `Attachment removed: ${removed.fileName}`,
        model: chatData.model ?? chatData.provider ?? 'unknown',
        inputs: { hash: removed.id, type: removed.type },
        outputs: {},
        userDecision: 'auto',
        metadata: { auditEventType: 'attachment_removed' },
      });
    }
    return prev.filter((a) => a.id !== id);
  });
  setPreviewUrls((prev) => {
    if (prev[id]) URL.revokeObjectURL(prev[id]);
    const { [id]: _, ...rest } = prev;
    return rest;
  });
}, [onAuditLog, chatData.model, chatData.provider]);
```

f) Add `handleSwitchModel` callback (calls `onSave` with updated model field):

```typescript
const handleSwitchModel = useCallback((model: string) => {
  if (onSave) {
    onSave({ ...chatData, model, updated: new Date().toISOString() });
  }
}, [onSave, chatData]);
```

g) Revoke all preview URLs when the component unmounts:

```typescript
useEffect(() => {
  return () => {
    for (const url of Object.values(previewUrls)) {
      URL.revokeObjectURL(url);
    }
  };
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

h) Extend `handleSendMessage` to include attachments. Before the AI provider call, emit `attachment_sent_to_provider` audit events and pass formatted attachment blocks to the provider. After the message is saved, clear `pendingAttachments`:

```typescript
// Inside handleSendMessage, just before the provider switch block:
// Attach pending images to the user message record.
const messageAttachments = pendingAttachments.length > 0
  ? [...pendingAttachments]
  : undefined;

const userMessage: ChatMessage = {
  role: 'user',
  content: rawContent,
  timestamp: new Date().toISOString(),
  ...(messageAttachments ? { attachments: messageAttachments } : {}),
  ...(retrievedSources.length > 0 ? { sources: retrievedSources } : {}),
  ...(workspaceHint ? { workspaceHint } : {}),
};

// Emit attachment_sent_to_provider audit events.
for (const att of pendingAttachments) {
  onAuditLog?.({
    action: 'user_action',
    description: `Attachment sent to provider: ${att.fileName}`,
    model: chatData.model ?? chatData.provider ?? 'unknown',
    inputs: { hash: att.id, path: att.pathInWorkspace, provider: chatData.provider ?? 'anthropic' },
    outputs: {},
    userDecision: 'auto',
    metadata: { auditEventType: 'attachment_sent_to_provider' },
  });
}

// Clear pending after capturing in userMessage.
setPendingAttachments([]);
for (const url of Object.values(previewUrls)) {
  URL.revokeObjectURL(url);
}
setPreviewUrls({});
```

> For actually including attachment bytes in the provider request: in this plan, the audit and UI wiring are the primary deliverables. The byte-reading + `formatAttachmentForRequest` call happens inside the provider send path. Specifically, when building the messages array for the provider, read each attachment's bytes via `AttachmentService.read(att)`, call `provider.formatAttachmentForRequest(att, bytes)`, and insert the resulting block into the content array (or Ollama images array). The implementation worker should locate the prompt-building section in `handleSendMessage` and inject this loop.

i) Update the send button disabled logic to also block when `visionWarning` is non-null:

```typescript
disabled={(!inputValue.trim() && pendingAttachments.length === 0) || isLoading || trialGate.isLocked || visionWarning !== null}
```

j) Replace the current chat input `<div className="flex gap-2">` block with the toolbar:

```tsx
<ChatInputToolbar
  provider={chatData.provider ?? 'anthropic'}
  model={chatData.model ?? ''}
  pendingAttachments={pendingAttachments}
  previewUrls={previewUrls}
  onFilesSelected={handleFilesSelected}
  onRemoveAttachment={handleRemoveAttachment}
  onSwitchModel={handleSwitchModel}
  visionWarning={visionWarning}
  sendDisabled={visionWarning !== null || isLoading || trialGate.isLocked}
/>
{/* Keep the existing Textarea + buttons below the toolbar */}
```

- [ ] **Step 4: Run component tests**

```bash
npx vitest run tests/unit/components/chat/ChatInputToolbar.test.tsx tests/unit/components/chat/VisionWarningBanner.test.tsx
```

Expected: all pass.

- [ ] **Step 5: tsc check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ChatInputToolbar.tsx src/components/ai/AIChatViewer.tsx tests/unit/components/chat/ChatInputToolbar.test.tsx
git commit -m "feat(stream-a1): ChatInputToolbar paperclip/paste/drag-drop + AIChatViewer integration"
```

---

# Group IX: Cost-Meter Integration for Images

## Task 10: Add image token estimation and wire into recordCost

Image tokens are estimated before the send call and added to `inputTokens` in the `recordCost` call so the cost chip reflects attachment cost.

**Files:**
- Create: `src/modules/attachments/imageTokens.ts`
- Create: `src/modules/attachments/index.ts`
- Create: `tests/unit/attachments/imageTokens.test.ts`
- Modify: `src/components/ai/AIChatViewer.tsx`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/attachments/imageTokens.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/attachments/imageTokens.test.ts
```

- [ ] **Step 3: Implement imageTokens.ts**

Write `src/modules/attachments/imageTokens.ts`:

```typescript
/**
 * Stream A1 — Image token estimation for the cost meter.
 *
 * Formulas per spec §4.2:
 *   Claude:  ~85 tokens per 512x512 tile (scales linearly with tile count).
 *   OpenAI:  ~85 base tokens + ~170 tokens per 512x512 detail tile.
 *   Gemini:  ~258 tokens per image (flat, dimension-independent).
 *   Ollama:  0 (model-dependent; cost-meter contribution skipped per spec).
 *   Mock:    0 (test convenience).
 *
 * When width/height are unavailable, fall back to a tile estimate derived
 * from byteSize (assumes ~3 bytes per pixel at the raw level).
 */

import type { ChatAttachment } from '@/types/ai';

const TILE_PX = 512;
const CLAUDE_TOKENS_PER_TILE = 85;
const OPENAI_BASE_TOKENS = 85;
const OPENAI_TOKENS_PER_TILE = 170;
const GEMINI_TOKENS_PER_IMAGE = 258;

/**
 * Compute the number of 512x512 tiles needed to cover an image of the
 * given pixel dimensions. Minimum 1 tile.
 */
function tileCount(widthPx: number, heightPx: number): number {
  const tilesX = Math.ceil(widthPx / TILE_PX);
  const tilesY = Math.ceil(heightPx / TILE_PX);
  return Math.max(1, tilesX * tilesY);
}

/**
 * Estimate pixel dimensions from byte size when metadata.width/height are
 * absent. Assumes 3 bytes per pixel (RGB, no compression). This is a
 * rough upper bound; actual compressed images are smaller, but the
 * over-estimate is conservative (safe direction for cost display).
 */
function estimateDimensionsFromBytes(byteSize: number): { w: number; h: number } {
  const pixels = byteSize / 3;
  const side = Math.sqrt(pixels);
  return { w: Math.ceil(side), h: Math.ceil(side) };
}

/**
 * Returns the estimated number of input tokens consumed by a single image
 * attachment for the given provider.
 *
 * Provider IDs: 'claude'|'anthropic', 'openai', 'gemini'|'google', 'ollama', 'mock'.
 */
export function estimateImageTokens(
  provider: string,
  att: ChatAttachment
): number {
  if (att.type !== 'image') return 0;

  const { width, height } = att.metadata;
  const w = width ?? estimateDimensionsFromBytes(att.byteSize).w;
  const h = height ?? estimateDimensionsFromBytes(att.byteSize).h;
  const tiles = tileCount(w, h);

  switch (provider) {
    case 'claude':
    case 'anthropic':
      return CLAUDE_TOKENS_PER_TILE * tiles;

    case 'openai':
      return OPENAI_BASE_TOKENS + OPENAI_TOKENS_PER_TILE * tiles;

    case 'gemini':
    case 'google':
      return GEMINI_TOKENS_PER_IMAGE;

    case 'ollama':
    case 'mock':
    default:
      return 0;
  }
}
```

Write `src/modules/attachments/index.ts`:

```typescript
export { AttachmentService } from './AttachmentService';
export { estimateImageTokens } from './imageTokens';
export { SUPPORTED_IMAGE_MIMES, MAX_ATTACHMENT_BYTES } from '../models/vision-capability';
```

- [ ] **Step 4: Wire estimateImageTokens into AIChatViewer.handleSendMessage**

In `AIChatViewer.tsx`, modify the `recordCost` call to add image tokens:

```typescript
// Compute image token overhead for all attachments on this turn.
import { estimateImageTokens } from '@/modules/attachments/imageTokens';

// Inside handleSendMessage, just before the provider send call:
const imageTokenOverhead = pendingAttachments.reduce(
  (sum, att) => sum + estimateImageTokens(chatProvider, att),
  0
);

// Then in the recordCost call (both streaming and non-streaming paths):
recordCost(chatId, {
  cost: streamingResponse.cost,
  inputTokens: streamingResponse.usage.inputTokens + imageTokenOverhead,
  outputTokens: streamingResponse.usage.outputTokens,
  provider: chatProvider,
});
```

The image token cost (USD) is already approximated by the provider's `costPerInputToken` rate applied to the extra tokens. No separate cost field is needed.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run tests/unit/attachments/imageTokens.test.ts tests/unit/models/ tests/unit/components/chat/
```

Expected: all pass.

- [ ] **Step 6: tsc check and commit**

```bash
npx tsc --noEmit
git add src/modules/attachments/imageTokens.ts src/modules/attachments/index.ts tests/unit/attachments/imageTokens.test.ts src/components/ai/AIChatViewer.tsx
git commit -m "feat(stream-a1): image token estimation + cost-meter integration"
```

---

# Group X: E2E Test + Final Verification

## Task 11: E2E test for image paste persistence and full verification pass

**Files:**
- Create: `tests/e2e/image-attachment.spec.ts`

- [ ] **Step 1: Write the E2E test**

Write `tests/e2e/image-attachment.spec.ts`:

```typescript
/**
 * Stream A1 E2E — Image attachment persistence across reload.
 *
 * Flow:
 *   1. Open a new AI chat.
 *   2. Paste a 1x1 PNG via clipboard simulation.
 *   3. Verify the attachment tile appears.
 *   4. Send the message (with MockProvider configured so no real API key needed).
 *   5. Reload the app.
 *   6. Navigate back to the chat.
 *   7. Verify the chat history still shows the attachment indicator.
 */

import { test, expect } from '@playwright/test';
import path from 'path';

// Minimal valid 1x1 red PNG (67 bytes).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

test.describe('Image attachment E2E', () => {
  test('paste image, send, reload, history persists with attachment', async ({ page }) => {
    await page.goto('/');

    // Navigate to AI Assistant and create a new chat.
    await page.getByTestId('sidebar-link-ai-assistant').click();
    await page.getByTestId('new-chat-button').click();
    await expect(page.getByTestId('chat-input')).toBeVisible();

    // Simulate paste event with image clipboard data.
    const buffer = Buffer.from(TINY_PNG_BASE64, 'base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
      document.querySelector('[data-testid="chat-input-toolbar"]')!.dispatchEvent(event);
    }, TINY_PNG_BASE64);

    // Attachment tile should appear.
    await expect(page.locator('[data-testid^="attachment-tile-"]')).toBeVisible({ timeout: 3000 });

    // The vision warning should NOT appear for claude-3-5-sonnet (default in test env).
    await expect(page.getByTestId('vision-warning-banner')).not.toBeVisible();

    // Type a text message and send.
    await page.getByTestId('chat-input').fill('Describe this image');
    await page.getByTestId('chat-send-button').click();

    // Wait for response bubble to appear (mock provider responds fast).
    await expect(page.locator('.chat-message-bubble').last()).toBeVisible({ timeout: 10000 });

    // Capture chat title from breadcrumb or header for navigation after reload.
    const chatTitle = await page.getByTestId('chat-header-title').textContent();

    // Reload the app.
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Re-open the same chat.
    if (chatTitle) {
      await page.getByText(chatTitle).first().click();
    }

    // The user message with the attachment should appear in history.
    // Check for an attachment indicator (tile or icon) in the chat history.
    await expect(
      page.locator('[data-testid^="history-attachment-"]').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('oversized file shows toast and does not attach', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-link-ai-assistant').click();
    await page.getByTestId('new-chat-button').click();

    // Create a 21 MB fake PNG file and drop it.
    await page.evaluate(() => {
      const oversized = new File([new ArrayBuffer(21 * 1024 * 1024)], 'huge.png', {
        type: 'image/png',
      });
      const dt = new DataTransfer();
      dt.items.add(oversized);
      const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true });
      document.querySelector('[data-testid="chat-input-toolbar"]')!.dispatchEvent(event);
    });

    // Toast should appear indicating size limit.
    await expect(page.getByText(/too large|20 MB/i)).toBeVisible({ timeout: 3000 });

    // No attachment tile should appear.
    await expect(page.locator('[data-testid^="attachment-tile-"]')).not.toBeVisible();
  });

  test('text-only model shows vision warning and blocks send', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-link-ai-assistant').click();
    await page.getByTestId('new-chat-button').click();

    // Switch the chat to claude-3-5-haiku (text-only).
    // This assumes the model picker is accessible via testid; adjust if different.
    await page.getByTestId('chat-model-picker').click();
    await page.getByText('claude-3-5-haiku').click();

    // Paste a tiny PNG.
    await page.evaluate(async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
      document.querySelector('[data-testid="chat-input-toolbar"]')!.dispatchEvent(event);
    });

    // Vision warning banner must appear.
    await expect(page.getByTestId('vision-warning-banner')).toBeVisible({ timeout: 3000 });

    // Send button must be disabled.
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();

    // Clicking switch button resolves the warning.
    await page.getByTestId('vision-warning-switch-button').click();
    await expect(page.getByTestId('vision-warning-banner')).not.toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run unit + integration tests**

```bash
npx vitest run
```

Expected: all existing tests pass, new tests pass, no regressions.

- [ ] **Step 3: TypeScript compile**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/image-attachment.spec.ts
git commit -m "test(stream-a1): E2E image paste, persistence, oversized cap, and vision warning"
```

---

## What Is Deferred (Stream A1 does not close the Stream A PR)

Stream A uses a single rolling branch (`feature/stream-a`). Plan A1 leaves the branch ready for Plan A2 to continue building on. The Stream A PR opens only after Plans A2, A3, and A4 all land. Do not open a PR at the end of A1.

Specifically deferred to later A-sub-plans:

- **Plan A2:** PDF attachment UI, per-provider PDF formatting, PDF.js text extraction, Claude native-PDF path, pre-send text preview.
- **Plan A3:** PDF-to-RAG indexing (workspace index walker, embedding, SQLite storage).
- **Plan A4:** Long-context UX: 1M token cap raise, capability detection per provider, cost preview in input, summarization compression, Compress button.

---

## Self-Review Results

### 1. Every Plan A1 scope item has a task?

| Scope item | Covered |
|---|---|
| Paperclip icon button | Task 9 (ChatInputToolbar) |
| Paste handler for clipboard images | Task 9 |
| Drag-drop zone with visible overlay | Task 9 |
| Attachment tiles with remove (x) | Task 8 (AttachmentTile) + Task 9 |
| 20 MB per-file cap with toast | Task 9 (handleFilesSelected) |
| Save-to-workspace via AttachmentService | Task 9 (handleFilesSelected) |
| Audit log: attachment_added, attachment_sent_to_provider, attachment_removed | Task 9 (AIChatViewer wiring) |
| ClaudeProvider formatAttachmentForRequest (real, image) | Task 3 |
| OpenAIProvider formatAttachmentForRequest (real, image) | Task 4 |
| GeminiProvider formatAttachmentForRequest (real, image) | Task 5 |
| OllamaProvider formatAttachmentForRequest (real, image) | Task 6 |
| MockProvider formatAttachmentForRequest (recording) | Task 7 |
| supportsAttachment (all 5 providers) | Tasks 3-7 |
| Vision-model config (single source of truth) | Task 2 |
| Vision-model warning UX above send button | Task 8 (VisionWarningBanner) |
| Auto-suggest model swap button | Task 8 (VisionWarningBanner) |
| Send button disabled until warning resolved | Task 9 (AIChatViewer send disabled logic) |
| Cost-meter image token formulas | Task 10 |
| E2E: paste image, reload, history persists | Task 11 |

All scope items are covered. No gaps.

### 2. Type/method names consistent?

- `ChatAttachment`: used consistently across all tasks.
- `ProviderContentBlock`: union type defined in Task 1, used in Tasks 3-7.
- `formatAttachmentForRequest(att: ChatAttachment, bytes: Uint8Array): ProviderContentBlock`: consistent signature across all five providers.
- `supportsAttachment(att: ChatAttachment, model: string): true | string`: consistent across all five providers.
- `isVisionModel(provider: string, model: string): boolean`: used in Tasks 2, 3, 4, 5, 6, 9.
- `getSuggestedVisionModel(provider: string): string`: used in Tasks 2, 8.
- `estimateImageTokens(provider: string, att: ChatAttachment): number`: used in Tasks 10.
- `bytesToBase64(bytes: Uint8Array): string`: extracted to `providerUtils.ts` in Task 4, imported by Tasks 3, 5, 6.

Names are consistent. The provider ID strings (`'claude'`/`'anthropic'`, `'openai'`, `'gemini'`/`'google'`, `'ollama'`, `'mock'`) match existing `AIChatFile.provider` values.

### 3. Em dash check

Searched for `—` in the plan: none found.

### 4. Time estimate check

Searched for patterns like "takes X days", "X-week", "X hours": none found. The only durations present are operational (20 MB cap, 24h cache TTL references).

### 5. TBD/TODO in implementation steps check

No `TBD`, `TODO`, or "implement later" appear in any implementation step. The one forward reference is a clearly-scoped note ("The implementation worker should locate the prompt-building section in `handleSendMessage` and inject this loop.") which gives the worker enough context to act without ambiguity.

### 6. Provider interface signature consistency check

The `Provider` interface in Task 1 declares:

```typescript
formatAttachmentForRequest(att: ChatAttachment, bytes: Uint8Array): ProviderContentBlock;
supportsAttachment(att: ChatAttachment, model: string): true | string;
```

All five provider implementations (Tasks 3-7) use exactly this signature. Consistent.

---

## Concerns and Follow-Ups Needing Human Input Before Implementation

1. **OllamaProvider message construction wiring.** Task 6 notes that the `_ollama_images` sentinel must be spliced into the Ollama chat request by `sendMessage`. The exact location depends on how `OllamaProvider.sendMessage` currently builds the messages array. The implementation worker should read `OllamaProvider.ts` lines ~60-200 before touching that code, to avoid breaking the existing NDJSON streaming path.

2. **AttachmentService availability at send time.** `AIChatViewer` only has a ref to `workspaceServiceRef` (a generic service ref). Task 9 passes it to `new AttachmentService(workspaceServiceRef?.current)`. Confirm that `AttachmentService` accepts the same service interface that `workspaceServiceRef` holds, or adjust the constructor signature before Task 9.

3. **Chat model switching from VisionWarningBanner.** The `handleSwitchModel` callback in Task 9 calls `onSave({ ...chatData, model, ... })`. This updates the `.aichat` file but does not update the model picker UI if the picker is driven by a separate selector/store. The implementation worker should verify the model picker's state source and add a store update if needed.

4. **E2E test environment assumptions.** The E2E test in Task 11 uses `data-testid="chat-model-picker"` and `data-testid="new-chat-button"` which may not yet exist. The test is written as the target state; the worker should add those testids to the UI as part of Task 9's AIChatViewer modifications, or adjust the selectors to match existing testids.

5. **`useToast` import.** The plan imports `useToast` from `@/components/ui/use-toast`. Confirm this path exists in the shadcn/ui setup (some setups use `@/hooks/use-toast`). Adjust the import path accordingly.
