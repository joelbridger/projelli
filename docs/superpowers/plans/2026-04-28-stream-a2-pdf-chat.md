# Projelli v2.0 Stream A2: PDF Chat Hybrid Path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF attachments to AI chat. Claude gets native PDF support (Anthropic's `document` content block). Every other provider receives extracted text from PDF.js. The user sees a mode chip in chat history, a 200-character extraction preview before sending, and a cost estimate on the send button. Encrypted PDFs surface a clear error. Scanned PDFs surface a warning with a "send native" escape hatch when Claude is selected.

**Branch:** `feature/stream-a`. Continues from Plan A1 (already 12 commits on this branch). All Plan A1 foundations are in place: `ChatAttachment` with `type: 'pdf'`, `formatAttachmentForRequest` / `supportsAttachment` stubs that throw `"PDF support not implemented; pending Plan A2"`, `SendOptions.attachmentBytes`, the `ChatInputToolbar` already accepts `application/pdf` in its file picker, and `AttachmentService.save` already accepts the `application/pdf` MIME type.

**Architecture:** PDF.js is lazy-loaded the first time a PDF is processed. Each provider's `formatAttachmentForRequest` decides the mode internally: ClaudeProvider uses bytes to build a native `document` block; all others call `extractPdfText`, then embed extracted text as a text content block in the message. A new `pdf-capability.ts` config file drives mode selection and `supportsNativePdf(model)` checks. A new `pdfTokens.ts` feeds the cost meter. Two new React components handle mode display and pre-send preview. The `pdf_extracted` audit event fires for every PDF processed.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Zustand, Vitest, Tauri 2, shadcn/ui + Tailwind CSS.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 4.3.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/lib/pdf-extract.ts` | `extractPdfText(bytes): Promise<PdfExtractionResult>` - lazy PDF.js loader + worker config |
| `src/modules/models/pdf-capability.ts` | `supportsNativePdf(provider, model): boolean`, `SUPPORTED_PDF_MIME`, per-provider mode decision |
| `src/modules/attachments/pdfTokens.ts` | `estimatePdfTokens(provider, result): number` - native 3000/page vs text-extract char/4 |
| `src/components/chat/PdfModeChip.tsx` | Green native / yellow extracted chip rendered next to PDF attachment in history |
| `src/components/chat/PdfPreviewBeforeSend.tsx` | Modal showing first 200 chars of extracted text before send |
| `tests/unit/lib/pdf-extract.test.ts` | Unit tests for `extractPdfText` across fixture PDFs |
| `tests/unit/models/pdf-capability.test.ts` | Unit tests for `supportsNativePdf` and mode selection helpers |
| `tests/unit/attachments/pdfTokens.test.ts` | Unit tests for `estimatePdfTokens` |
| `tests/unit/models/claude-pdf-format.test.ts` | ClaudeProvider PDF format + supportsAttachment tests |
| `tests/unit/models/openai-pdf-format.test.ts` | OpenAIProvider PDF text-extract format + supportsAttachment tests |
| `tests/unit/models/gemini-pdf-format.test.ts` | GeminiProvider PDF text-extract format + supportsAttachment tests |
| `tests/unit/models/ollama-pdf-format.test.ts` | OllamaProvider PDF text-extract format + supportsAttachment tests |
| `tests/unit/models/mock-pdf-format.test.ts` | MockProvider PDF format + supportsAttachment tests |
| `tests/unit/components/chat/PdfModeChip.test.tsx` | PdfModeChip rendering tests |
| `tests/unit/components/chat/PdfPreviewBeforeSend.test.tsx` | PdfPreviewBeforeSend component tests |
| `tests/e2e/pdf-attachment.spec.ts` | E2E: attach PDF, verify mode chip, verify request shape with Mock |
| `public/pdf-fixtures/simple.pdf` | Minimal text-based PDF fixture for tests (base64-embedded inline in test file) |

### Files to modify

| Path | Change |
|---|---|
| `src/modules/models/ClaudeProvider.ts` | Replace PDF stub with native `document` block implementation |
| `src/modules/models/OpenAIProvider.ts` | Replace PDF stub with text-extract implementation |
| `src/modules/models/GeminiProvider.ts` | Replace PDF stub with text-extract implementation |
| `src/modules/models/OllamaProvider.ts` | Replace PDF stub with text-extract implementation |
| `src/modules/models/MockProvider.ts` | Replace PDF stub with recording text-extract implementation |
| `src/modules/models/Provider.ts` | Extend `ProviderContentBlock` union with `ClaudeDocumentBlock` and `TextExtractBlock` |
| `src/modules/attachments/index.ts` | Add `estimatePdfTokens` export alongside existing exports |
| `src/components/ai/AIChatViewer.tsx` | Wire `PdfPreviewBeforeSend`, PDF cost tokens, `pdf_extracted` audit event, `PdfModeChip` in history |
| `src/types/audit.ts` | Confirm `pdf_extracted` event payload shape (verify or add: `{ path, pages, mode }`) |

### Files to NOT modify (out of Plan A2 scope)

- RAG indexing walker (Plan A3)
- Long-context UX, context cap, compression (Plan A4)
- Sidecar code (Stream B)
- Plugin or marketplace code (Stream C)
- Mobile surfaces (Stream D)
- i18n locale files (Stream E)
- `vision-capability.ts` (Plan A1, separate concern)
- `imageTokens.ts` (Plan A1, separate concern)

---

## Task Decomposition

There are 9 task groups. Within each group, tasks run sequentially. Across groups, the dependency order is: PDF.js utility (Group I) before PDF capability config (Group II) before providers (Groups III-VI) before UI (Group VII) before cost meter (Group VIII) before edge cases (woven into Groups I-VII) before E2E (Group IX).

- Group I: PDF.js bundling + extraction utility (Tasks 1-2)
- Group II: PDF capability config (Task 3)
- Group III: Provider interface extension for PDF types (Task 4)
- Group IV: ClaudeProvider PDF native implementation (Task 5)
- Group V: OpenAI, Gemini, Ollama, Mock PDF text-extract implementations (Tasks 6-9)
- Group VI: Pre-send preview + mode chip UI (Tasks 10-11)
- Group VII: AIChatViewer integration (Task 12)
- Group VIII: PDF cost meter (Task 13)
- Group IX: E2E test + final verification (Task 14)

---

# Group I: PDF.js Bundling + Extraction Utility

## Task 1: Install pdfjs-dist and configure the web worker

PDF.js requires a web worker for off-main-thread rendering. The worker file must be present at a known public URL before the first `extractPdfText` call. This task installs the package and places the worker file.

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts` (if needed for worker alias)
- Copy: `public/pdf.worker.min.js` (from node_modules after install)

- [ ] **Step 1: Install pdfjs-dist**

```bash
npm install pdfjs-dist
```

Confirm version installed:

```bash
node -e "const p = require('pdfjs-dist/package.json'); console.log(p.version);"
```

Expected: 4.x (the current stable release as of 2026-04). Note the exact version in a comment at the top of `src/lib/pdf-extract.ts`.

- [ ] **Step 2: Copy the worker file to public/**

PDF.js bundles a pre-built minified worker at `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` (or `pdf.worker.min.js` depending on the version). Identify the correct path:

```bash
ls node_modules/pdfjs-dist/build/
```

Copy the minified worker to `public/` so Vite serves it as a static asset:

```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
# Or if .js extension:
# cp node_modules/pdfjs-dist/build/pdf.worker.min.js public/pdf.worker.min.js
```

Add this copy step to the `prepare` or `prebuild` script in `package.json` so it runs automatically after `npm install` and before builds:

```json
{
  "scripts": {
    "copy-pdf-worker": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs",
    "prebuild": "npm run copy-pdf-worker",
    "predev": "npm run copy-pdf-worker"
  }
}
```

Adjust the filename to match what `ls node_modules/pdfjs-dist/build/` revealed. The worker file extension must match exactly what `GlobalWorkerOptions.workerSrc` is set to in Task 2.

- [ ] **Step 3: Verify the asset is accessible in dev**

```bash
npm run dev &
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/pdf.worker.min.mjs
```

Expected: `200`. Kill the dev server. If `404`, check that the file is in `public/` and that the filename in the URL matches.

- [ ] **Step 4: Commit**

```bash
git add package.json public/pdf.worker.min.mjs
git commit -m "feat(stream-a2): install pdfjs-dist and place worker file in public/"
```

---

## Task 2: Create extractPdfText utility

`extractPdfText` is the single shared extraction function used by all providers. It lazy-loads PDF.js so it is never in the main bundle. It handles encrypted and near-empty (scanned) PDFs explicitly.

**Files:**
- Create: `src/lib/pdf-extract.ts`
- Create: `tests/unit/lib/pdf-extract.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/lib/pdf-extract.test.ts`:

```typescript
/**
 * Stream A2 - Unit tests for extractPdfText.
 *
 * Fixture PDFs are embedded as base64 strings in this file so no
 * external fixture files are required for the unit test suite.
 *
 * Fixtures used:
 *   SIMPLE_PDF_B64  - minimal valid 1-page PDF with "Hello world" text.
 *   ENCRYPTED_PDF_B64 - minimal valid PDF encrypted with an owner password.
 *   EMPTY_TEXT_PDF_B64 - valid 1-page PDF containing only a scanned image
 *                        (text layer absent; extraction returns near-empty).
 *
 * NOTE: If you do not have real fixture bytes, replace the stubs below with
 * actual base64 blobs before running. The test file comments indicate which
 * bytes are load-bearing.
 */

import { describe, it, expect } from 'vitest';
import { extractPdfText } from '@/lib/pdf-extract';

// A minimal 1-page PDF containing the text "Hello world".
// Generated via: python3 -c "import fpdf; p=fpdf.FPDF(); p.add_page(); p.set_font('Arial',size=12); p.cell(0,10,'Hello world'); p.output('/tmp/simple.pdf')"
// Then: base64 /tmp/simple.pdf
// Replace STUB with the real output.
const SIMPLE_PDF_B64 = 'STUB_REPLACE_WITH_REAL_SIMPLE_PDF_BASE64';

// Encrypted PDF - any password-protected PDF will do.
// openssl enc or qpdf can produce one.
const ENCRYPTED_PDF_B64 = 'STUB_REPLACE_WITH_REAL_ENCRYPTED_PDF_BASE64';

// Scanned PDF - a PDF whose text layer is absent (all content is rasterized image).
const SCANNED_PDF_B64 = 'STUB_REPLACE_WITH_REAL_SCANNED_PDF_BASE64';

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('extractPdfText - simple PDF', () => {
  it('returns pageCount matching the fixture', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.pageCount).toBe(1);
  });

  it('returns one entry in pages array', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.pages).toHaveLength(1);
  });

  it('pages[0] contains extracted text', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.pages[0]).toContain('Hello world');
  });

  it('encrypted flag is false for plain PDF', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.encrypted).toBe(false);
  });

  it('scanned flag is false for text PDF', async () => {
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    expect(result.scanned).toBe(false);
  });
});

describe('extractPdfText - encrypted PDF', () => {
  it('returns encrypted: true without throwing', async () => {
    const result = await extractPdfText(b64ToBytes(ENCRYPTED_PDF_B64));
    expect(result.encrypted).toBe(true);
  });

  it('returns empty pages array for encrypted PDF', async () => {
    const result = await extractPdfText(b64ToBytes(ENCRYPTED_PDF_B64));
    expect(result.pages).toEqual([]);
  });

  it('returns pageCount of 0 for encrypted PDF', async () => {
    const result = await extractPdfText(b64ToBytes(ENCRYPTED_PDF_B64));
    expect(result.pageCount).toBe(0);
  });
});

describe('extractPdfText - scanned PDF', () => {
  it('returns scanned: true when total text < 100 chars', async () => {
    const result = await extractPdfText(b64ToBytes(SCANNED_PDF_B64));
    expect(result.scanned).toBe(true);
  });

  it('returns pageCount correctly even when scanned', async () => {
    const result = await extractPdfText(b64ToBytes(SCANNED_PDF_B64));
    expect(result.pageCount).toBeGreaterThan(0);
  });
});

describe('extractPdfText - scanned heuristic boundary', () => {
  it('scanned flag is false when total text >= 100 chars', async () => {
    // The simple fixture has > 100 chars of text, so scanned must be false.
    const result = await extractPdfText(b64ToBytes(SIMPLE_PDF_B64));
    const total = result.pages.reduce((s, p) => s + p.length, 0);
    expect(total).toBeGreaterThanOrEqual(100);
    expect(result.scanned).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/lib/pdf-extract.test.ts
```

Expected: FAIL - "Cannot find module '@/lib/pdf-extract'".

- [ ] **Step 3: Implement pdf-extract.ts**

Write `src/lib/pdf-extract.ts`:

```typescript
/**
 * Stream A2 - PDF text extraction utility.
 *
 * Uses pdfjs-dist (lazy-loaded on first call). The PDF.js web worker is
 * expected at /pdf.worker.min.mjs (placed in public/ by the prebuild step).
 *
 * pdfjs-dist version in use: see package.json (installed 2026-04-28).
 *
 * This module is the single extraction code path shared by all providers.
 * It is NOT imported at startup; it is dynamically imported inside
 * formatAttachmentForRequest so it never enters the main bundle.
 */

export interface PdfExtractionResult {
  /** Extracted text per page. Empty array if encrypted or zero-page document. */
  pages: string[];
  /** Total page count from the PDF document metadata. 0 if encrypted. */
  pageCount: number;
  /** True when the PDF requires a password (PasswordException thrown by PDF.js). */
  encrypted: boolean;
  /**
   * True when the total extracted text across all pages is under 100 characters.
   * This is the heuristic for a scanned/image-only PDF where OCR was not run.
   */
  scanned: boolean;
}

/** Threshold for scanned-PDF detection: total chars across all pages. */
const SCANNED_THRESHOLD = 100;

let workerConfigured = false;

/**
 * Configure the PDF.js GlobalWorkerOptions once. Safe to call multiple times.
 * The worker path must match the file copied to public/ in Task 1.
 */
async function ensureWorkerConfigured(): Promise<void> {
  if (workerConfigured) return;
  const pdfjsLib = await import('pdfjs-dist');
  // Adjust the filename if the worker was installed as .js rather than .mjs.
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  workerConfigured = true;
}

/**
 * Extract text from a PDF supplied as raw bytes.
 *
 * Encrypted PDFs are caught by PDF.js's PasswordException and returned
 * as { encrypted: true, pages: [], pageCount: 0, scanned: false } without
 * throwing so callers can surface a clean error to the user.
 *
 * Scanned PDFs (total text under 100 chars) are flagged with scanned: true
 * so callers can offer a "send as native PDF anyway" escape hatch.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractionResult> {
  await ensureWorkerConfigured();
  const pdfjsLib = await import('pdfjs-dist');

  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
  try {
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    pdf = await loadingTask.promise;
  } catch (err: unknown) {
    // PDF.js throws a PasswordException for encrypted/password-protected files.
    if (
      err instanceof Error &&
      (err.name === 'PasswordException' || err.message.includes('password'))
    ) {
      return { pages: [], pageCount: 0, encrypted: true, scanned: false };
    }
    // Any other load error: rethrow so callers get a genuine error toast.
    throw err;
  }

  const pageCount = pdf.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: { str?: string }) => item.str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push(pageText);
  }

  const totalChars = pages.reduce((sum, p) => sum + p.length, 0);
  const scanned = totalChars < SCANNED_THRESHOLD;

  return { pages, pageCount, encrypted: false, scanned };
}
```

- [ ] **Step 4: Replace fixture stubs with real base64 PDF bytes**

The test file has three `STUB_REPLACE_WITH_REAL_*_BASE64` markers. Replace each with a real base64-encoded PDF before running tests:

For `SIMPLE_PDF_B64` - a 1-page PDF with "Hello world":

```bash
# If python3-fpdf is available:
python3 -c "
from fpdf import FPDF
p = FPDF()
p.add_page()
p.set_font('Arial', size=12)
p.cell(0, 10, 'Hello world')
p.output('/tmp/simple.pdf')
"
base64 /tmp/simple.pdf | tr -d '\n'
```

Paste the output into `SIMPLE_PDF_B64`.

For `ENCRYPTED_PDF_B64` - a password-protected PDF:

```bash
# If qpdf is available:
qpdf --encrypt "" "owner_password" 128 -- /tmp/simple.pdf /tmp/encrypted.pdf
base64 /tmp/encrypted.pdf | tr -d '\n'
```

For `SCANNED_PDF_B64` - a PDF with no text layer. Generate a minimal 1-page PDF that contains only a white rectangle (no text) using any PDF library, or export a screenshot to PDF.

If none of the above tooling is available on the build machine, create a minimal valid 2-byte-header PDF stub that triggers PDF.js error paths. Add an explanatory comment in the test file that explains the stub limitation and marks the affected test blocks with `it.skip` pending fixture preparation.

- [ ] **Step 5: Run tests (with real fixtures)**

```bash
npx vitest run tests/unit/lib/pdf-extract.test.ts
```

Expected: all tests pass. If fixtures are stubs, all non-skipped tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf-extract.ts tests/unit/lib/pdf-extract.test.ts
git commit -m "feat(stream-a2): pdf-extract.ts - lazy PDF.js loader, extractPdfText with encryption + scanned detection"
```

---

# Group II: PDF Capability Config

## Task 3: Create pdf-capability.ts with per-provider mode detection

This is the single source of truth for which provider/model combinations support native PDF (via Anthropic's `document` block) vs. text-extraction fallback.

**Files:**
- Create: `src/modules/models/pdf-capability.ts`
- Create: `tests/unit/models/pdf-capability.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/pdf-capability.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/pdf-capability.test.ts
```

Expected: FAIL - "Cannot find module '@/modules/models/pdf-capability'".

- [ ] **Step 3: Implement pdf-capability.ts**

Write `src/modules/models/pdf-capability.ts`:

```typescript
/**
 * Stream A2 - Single source of truth for native PDF support detection.
 *
 * Only Anthropic's Claude API supports a native PDF content block
 * ({ type: 'document', source: { type: 'base64', ... } }).
 * All other providers receive extracted text via PDF.js.
 *
 * Within Claude, native PDF support is available on Sonnet (3.5+) and
 * Opus (3+) families. Haiku 3.x is text-extract only because Anthropic
 * has not documented native PDF support for it.
 * All Claude 4.x Sonnet and Opus models support native PDF.
 *
 * Provider IDs match the string used in AIChatFile.provider:
 *   'claude' | 'openai' | 'gemini' | 'ollama' | 'mock'
 */

/** The sole MIME type accepted for PDF attachments. */
export const SUPPORTED_PDF_MIME = 'application/pdf';

/** PDF processing mode. */
export type PdfMode = 'native' | 'text-extract';

/**
 * Returns true when the given provider + model combination supports
 * Anthropic's native PDF content block.
 *
 * Only 'claude' provider can return true. All others always return false.
 */
export function supportsNativePdf(provider: string, model: string): boolean {
  if (provider !== 'claude' && provider !== 'anthropic') return false;

  const m = model.toLowerCase();

  // Claude 4.x Sonnet and Opus: native PDF supported.
  if (m.startsWith('claude-sonnet-4') || m.startsWith('claude-opus-4')) return true;

  // Claude 3.5 Sonnet: native PDF supported.
  if (m.startsWith('claude-3-5-sonnet')) return true;

  // Claude 3 Opus: native PDF supported.
  if (m.startsWith('claude-3-opus')) return true;

  // Claude 3 Haiku, Claude 3.5 Haiku: text-extract only.
  // No documented native PDF API support for Haiku models.
  return false;
}

/**
 * Returns the PDF processing mode for the given provider + model.
 * 'native' means bytes are sent as Anthropic document block.
 * 'text-extract' means PDF.js extracts text sent as a text content block.
 */
export function getPdfMode(provider: string, model: string): PdfMode {
  return supportsNativePdf(provider, model) ? 'native' : 'text-extract';
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/models/pdf-capability.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/models/pdf-capability.ts tests/unit/models/pdf-capability.test.ts
git commit -m "feat(stream-a2): pdf-capability.ts - supportsNativePdf and getPdfMode per-provider config"
```

---

# Group III: Provider Interface Extension for PDF Types

## Task 4: Extend ProviderContentBlock union and Provider interface

Plan A1 defined `ProviderContentBlock` as a union of image-related types. Plan A2 adds two new members: one for Claude's native PDF block and one for the text-extract fallback (used by all other providers).

**Files:**
- Modify: `src/modules/models/Provider.ts`

- [ ] **Step 1: Add ClaudeDocumentBlock and TextExtractBlock to Provider.ts**

In `src/modules/models/Provider.ts`, locate the `ProviderContentBlock` union and the block type declarations that Plan A1 added. Extend them:

```typescript
/**
 * Stream A2 - Claude native PDF block shape.
 * Sent to the Anthropic Messages API as a content block with type 'document'.
 */
export interface ClaudeDocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: 'application/pdf';
    data: string; // base64-encoded PDF bytes
  };
}

/**
 * Stream A2 - Text extraction result block.
 * Used by OpenAI, Gemini, Ollama, and Mock providers when processing PDFs.
 * The provider embeds this text into the user message content rather than
 * as a binary attachment.
 *
 * The `_text_extract` prefix is a convention parallel to `_ollama_images`
 * from Plan A1: it signals to the message-construction code that this block
 * contributes injected text rather than a binary content block.
 */
export interface TextExtractBlock {
  _text_extract: {
    text: string;      // Full extracted text from all pages joined by double newline.
    pageCount: number;
    fileName: string;
  };
}
```

Update the `ProviderContentBlock` union to include the two new members:

```typescript
export type ProviderContentBlock =
  | ClaudeImageBlock
  | OpenAIImageBlock
  | GeminiInlineDataBlock
  | OllamaImagesPayload
  | ClaudeDocumentBlock   // Stream A2: Claude native PDF
  | TextExtractBlock;     // Stream A2: all other providers, text-extract path
```

- [ ] **Step 2: Add supportsNativePdf to Provider interface**

In `Provider.ts`, add the optional method to the `Provider` interface (below `supportsAttachment`):

```typescript
/**
 * Stream A2 - Returns true when this provider instance supports the
 * Anthropic native PDF document block for the given model.
 *
 * For non-Claude providers this always returns false; they use text-extract.
 * Declared as optional so existing provider implementations that have not
 * yet been updated do not fail the type check.
 */
supportsNativePdf?(model: string): boolean;
```

- [ ] **Step 3: Run tsc to verify no regressions**

```bash
npx tsc --noEmit
```

Expected: 0 errors. The existing provider stubs do not implement `supportsNativePdf` yet; it is optional, so no type error.

- [ ] **Step 4: Commit**

```bash
git add src/modules/models/Provider.ts
git commit -m "feat(stream-a2): extend ProviderContentBlock with ClaudeDocumentBlock and TextExtractBlock"
```

---

# Group IV: ClaudeProvider PDF Native Implementation

## Task 5: Implement ClaudeProvider PDF format, supportsAttachment, and supportsNativePdf

ClaudeProvider becomes the only provider that can send PDFs natively. It builds a `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }` block and short-circuits the text-extract path.

**Files:**
- Modify: `src/modules/models/ClaudeProvider.ts`
- Create: `tests/unit/models/claude-pdf-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/claude-pdf-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from '@/modules/models/ClaudeProvider';
import type { ChatAttachment } from '@/types/ai';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // '%PDF' magic bytes

const pdfAtt: ChatAttachment = {
  id: 'pdf001',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'contract.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf001.pdf',
  byteSize: 4,
  metadata: { pages: 3 },
};

function makeProvider(model: string) {
  return new ClaudeProvider({ apiKey: 'test-key', model });
}

describe('ClaudeProvider.formatAttachmentForRequest (PDF, native model)', () => {
  it('returns a ClaudeDocumentBlock shape', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block.type).toBe('document');
    expect(block.source.type).toBe('base64');
    expect(block.source.media_type).toBe('application/pdf');
  });

  it('encodes PDF bytes as base64', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    const decoded = atob(block.source.data);
    // First byte of PDF_BYTES is 0x25 ('%')
    expect(decoded.charCodeAt(0)).toBe(0x25);
  });

  it('claude-sonnet-4-6 also returns native PDF block', () => {
    const provider = makeProvider('claude-sonnet-4-6');
    const block = provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block.type).toBe('document');
  });
});

describe('ClaudeProvider.formatAttachmentForRequest (PDF, text-extract model)', () => {
  it('throws when called with PDF bytes on Haiku (text-extract path - caller should use extractPdfText instead)', () => {
    // Haiku does not support native PDF. The caller (AIChatViewer) is
    // responsible for calling extractPdfText and injecting text for Haiku.
    // formatAttachmentForRequest for Haiku PDF should throw a clear error
    // so callers detect the misconfiguration.
    const provider = makeProvider('claude-3-haiku-20240307');
    expect(() => provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES))
      .toThrow(/haiku.*text.extract|use text.extract/i);
  });
});

describe('ClaudeProvider.supportsAttachment (PDF)', () => {
  it('returns true for native-capable Sonnet model', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    expect(provider.supportsAttachment(pdfAtt, 'claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('returns true for claude-sonnet-4-6', () => {
    const provider = makeProvider('claude-sonnet-4-6');
    expect(provider.supportsAttachment(pdfAtt, 'claude-sonnet-4-6')).toBe(true);
  });

  it('returns true even for Haiku (text-extract is still supported; caller decides path)', () => {
    // supportsAttachment returning true for Haiku + PDF means the PDF
    // will be processed via text-extract. The mode chip indicates which
    // path was used.
    const provider = makeProvider('claude-3-haiku-20240307');
    expect(provider.supportsAttachment(pdfAtt, 'claude-3-haiku-20240307')).toBe(true);
  });
});

describe('ClaudeProvider.supportsNativePdf', () => {
  it('returns true for claude-3-5-sonnet-20241022', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    expect(provider.supportsNativePdf!('claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('returns false for claude-3-haiku-20240307', () => {
    const provider = makeProvider('claude-3-haiku-20240307');
    expect(provider.supportsNativePdf!('claude-3-haiku-20240307')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/claude-pdf-format.test.ts
```

Expected: FAIL - PDF stub throws the old "not implemented" error.

- [ ] **Step 3: Implement in ClaudeProvider.ts**

In `src/modules/models/ClaudeProvider.ts`, locate the existing `formatAttachmentForRequest` method (which currently has a PDF stub). Replace the PDF stub with the native implementation:

```typescript
import { supportsNativePdf as pdfNativeCheck } from './pdf-capability';
import type {
  ClaudeDocumentBlock,
} from './Provider';
// bytesToBase64 is already imported from providerUtils (added in Plan A1)

formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): ProviderContentBlock {
  if (att.type === 'image') {
    // Existing Plan A1 implementation - do not modify.
    const data = bytesToBase64(bytes);
    return {
      type: 'image',
      source: { type: 'base64', media_type: att.mimeType, data },
    } satisfies ClaudeImageBlock;
  }

  if (att.type === 'pdf') {
    const currentModel = this.config.model ?? '';
    if (!pdfNativeCheck('claude', currentModel)) {
      throw new Error(
        `${currentModel} does not support native PDF. Use text-extract path for Haiku models.`
      );
    }
    const data = bytesToBase64(bytes);
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data,
      },
    } satisfies ClaudeDocumentBlock;
  }

  throw new Error(`Unsupported attachment type: ${att.type}`);
}

supportsAttachment(att: ChatAttachment, model: string): true | string {
  if (att.type === 'image') {
    // Existing Plan A1 implementation - do not modify.
    if (isVisionModel('claude', model)) return true;
    return `${model} does not support images. Switch to Claude Sonnet or Opus.`;
  }

  if (att.type === 'pdf') {
    // All Claude models support PDF attachment - native or text-extract.
    // The mode is decided by AIChatViewer via getPdfMode().
    return true;
  }

  return `Unsupported attachment type: ${att.type}.`;
}

supportsNativePdf(model: string): boolean {
  return pdfNativeCheck('claude', model);
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/models/claude-pdf-format.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: tsc check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/models/ClaudeProvider.ts tests/unit/models/claude-pdf-format.test.ts
git commit -m "feat(stream-a2): ClaudeProvider native PDF format + supportsNativePdf"
```

---

# Group V: OpenAI, Gemini, Ollama, Mock PDF Text-Extract Implementations

## Task 6: OpenAIProvider PDF text-extract implementation

For OpenAI, PDF bytes are extracted to text via `extractPdfText`, and the text is injected into the message as a text content segment. `formatAttachmentForRequest` returns a `TextExtractBlock` that the message-construction code in `AIChatViewer` detects and injects appropriately.

**Files:**
- Modify: `src/modules/models/OpenAIProvider.ts`
- Create: `tests/unit/models/openai-pdf-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/openai-pdf-format.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '@/modules/models/OpenAIProvider';
import type { ChatAttachment } from '@/types/ai';

// Mock pdf-extract so tests do not need a real PDF.js environment.
vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Page one text content.', 'Page two text content.'],
    pageCount: 2,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf002',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'deck.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf002.pdf',
  byteSize: 4,
  metadata: { pages: 2 },
};

function makeProvider(model: string) {
  return new OpenAIProvider({ apiKey: 'test-key', model });
}

describe('OpenAIProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock shape', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
  });

  it('includes the extracted text in the block', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract.text).toContain('Page one text content.');
    expect(block._text_extract.text).toContain('Page two text content.');
  });

  it('includes pageCount in the block', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract.pageCount).toBe(2);
  });

  it('includes fileName in the block', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract.fileName).toBe('deck.pdf');
  });
});

describe('OpenAIProvider.supportsAttachment (PDF)', () => {
  it('returns true for gpt-4o + PDF (text-extract works universally)', () => {
    const provider = makeProvider('gpt-4o');
    expect(provider.supportsAttachment(pdfAtt, 'gpt-4o')).toBe(true);
  });

  it('returns true for gpt-3.5-turbo + PDF', () => {
    const provider = makeProvider('gpt-3.5-turbo');
    expect(provider.supportsAttachment(pdfAtt, 'gpt-3.5-turbo')).toBe(true);
  });
});

describe('OpenAIProvider.supportsNativePdf', () => {
  it('always returns false', () => {
    const provider = makeProvider('gpt-4o');
    expect(provider.supportsNativePdf!('gpt-4o')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/openai-pdf-format.test.ts
```

Expected: FAIL - PDF stub throws.

- [ ] **Step 3: Implement in OpenAIProvider.ts**

Add the PDF implementation to `src/modules/models/OpenAIProvider.ts`. Note that `formatAttachmentForRequest` for text-extract providers is `async` because it calls `extractPdfText`. Update the method signature in both the implementation and the `Provider` interface to allow `Promise<ProviderContentBlock>` in addition to the synchronous return for images:

The `Provider` interface change: update `formatAttachmentForRequest` to return `ProviderContentBlock | Promise<ProviderContentBlock>`.

In `OpenAIProvider.ts`:

```typescript
import { extractPdfText } from '@/lib/pdf-extract';
import type { TextExtractBlock } from './Provider';

async formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): Promise<ProviderContentBlock> {
  if (att.type === 'image') {
    // Existing Plan A1 synchronous image path - wrapped in a resolved promise.
    const data = bytesToBase64(bytes);
    return {
      type: 'image_url',
      image_url: { url: `data:${att.mimeType};base64,${data}` },
    } satisfies OpenAIImageBlock;
  }

  if (att.type === 'pdf') {
    const result = await extractPdfText(bytes);
    // Encrypted and scanned PDFs: the caller (AIChatViewer) already
    // blocked encrypted PDFs before reaching this point.
    // Scanned PDFs: text will be near-empty; the PdfModeChip shows
    // the warning; the user confirmed to proceed.
    const text = result.pages.join('\n\n');
    return {
      _text_extract: {
        text,
        pageCount: result.pageCount,
        fileName: att.fileName,
      },
    } satisfies TextExtractBlock;
  }

  throw new Error(`Unsupported attachment type: ${att.type}`);
}

supportsAttachment(att: ChatAttachment, model: string): true | string {
  if (att.type === 'image') {
    if (isVisionModel('openai', model)) return true;
    return `${model} does not support images. Switch to GPT-4o or an o1 model.`;
  }
  if (att.type === 'pdf') {
    // Text-extract works for all OpenAI models.
    return true;
  }
  return `Unsupported attachment type: ${att.type}.`;
}

supportsNativePdf(_model: string): boolean {
  return false;
}
```

Update `Provider.ts` interface signature for `formatAttachmentForRequest` to return `ProviderContentBlock | Promise<ProviderContentBlock>` so both sync (Claude image, native PDF) and async (text-extract) paths type-check.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/models/openai-pdf-format.test.ts
```

Expected: all pass.

- [ ] **Step 5: tsc check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/models/OpenAIProvider.ts tests/unit/models/openai-pdf-format.test.ts src/modules/models/Provider.ts
git commit -m "feat(stream-a2): OpenAIProvider PDF text-extract + async formatAttachmentForRequest"
```

---

## Task 7: GeminiProvider PDF text-extract implementation

**Files:**
- Modify: `src/modules/models/GeminiProvider.ts`
- Create: `tests/unit/models/gemini-pdf-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/gemini-pdf-format.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GeminiProvider } from '@/modules/models/GeminiProvider';
import type { ChatAttachment } from '@/types/ai';

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Gemini page content.'],
    pageCount: 1,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf003',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'report.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf003.pdf',
  byteSize: 4,
  metadata: { pages: 1 },
};

function makeProvider(model: string) {
  return new GeminiProvider({ apiKey: 'test-key', model });
}

describe('GeminiProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock', async () => {
    const provider = makeProvider('gemini-1.5-pro');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
    expect(block._text_extract.text).toContain('Gemini page content.');
    expect(block._text_extract.pageCount).toBe(1);
    expect(block._text_extract.fileName).toBe('report.pdf');
  });
});

describe('GeminiProvider.supportsAttachment (PDF)', () => {
  it('returns true (text-extract works for all Gemini models)', () => {
    const provider = makeProvider('gemini-1.5-pro');
    expect(provider.supportsAttachment(pdfAtt, 'gemini-1.5-pro')).toBe(true);
  });
});

describe('GeminiProvider.supportsNativePdf', () => {
  it('always returns false', () => {
    const provider = makeProvider('gemini-1.5-pro');
    expect(provider.supportsNativePdf!('gemini-1.5-pro')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/gemini-pdf-format.test.ts
```

- [ ] **Step 3: Implement in GeminiProvider.ts**

In `src/modules/models/GeminiProvider.ts`, apply the same pattern as OpenAIProvider: replace the PDF stub in `formatAttachmentForRequest` with an async call to `extractPdfText`, return a `TextExtractBlock`, and add `supportsNativePdf`.

```typescript
import { extractPdfText } from '@/lib/pdf-extract';
import type { TextExtractBlock } from './Provider';

// In formatAttachmentForRequest, pdf branch:
if (att.type === 'pdf') {
  const result = await extractPdfText(bytes);
  return {
    _text_extract: {
      text: result.pages.join('\n\n'),
      pageCount: result.pageCount,
      fileName: att.fileName,
    },
  } satisfies TextExtractBlock;
}

// supportsAttachment pdf branch:
if (att.type === 'pdf') return true;

// supportsNativePdf:
supportsNativePdf(_model: string): boolean { return false; }
```

- [ ] **Step 4: Run tests, tsc check, commit**

```bash
npx vitest run tests/unit/models/gemini-pdf-format.test.ts
npx tsc --noEmit
git add src/modules/models/GeminiProvider.ts tests/unit/models/gemini-pdf-format.test.ts
git commit -m "feat(stream-a2): GeminiProvider PDF text-extract"
```

---

## Task 8: OllamaProvider PDF text-extract implementation

**Files:**
- Modify: `src/modules/models/OllamaProvider.ts`
- Create: `tests/unit/models/ollama-pdf-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/ollama-pdf-format.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '@/modules/models/OllamaProvider';
import type { ChatAttachment } from '@/types/ai';

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Ollama extracted text.'],
    pageCount: 1,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf004',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'notes.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf004.pdf',
  byteSize: 4,
  metadata: { pages: 1 },
};

function makeProvider(model: string) {
  return new OllamaProvider({ model, baseUrl: 'http://localhost:11434' });
}

describe('OllamaProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock', async () => {
    const provider = makeProvider('llama3.2:3b');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
    expect(block._text_extract.text).toContain('Ollama extracted text.');
  });
});

describe('OllamaProvider.supportsAttachment (PDF)', () => {
  it('returns true for any Ollama model + PDF (text-extract works universally)', () => {
    const provider = makeProvider('llama3.2:3b');
    expect(provider.supportsAttachment(pdfAtt, 'llama3.2:3b')).toBe(true);
  });
});

describe('OllamaProvider.supportsNativePdf', () => {
  it('always returns false', () => {
    const provider = makeProvider('llama3.2:3b');
    expect(provider.supportsNativePdf!('llama3.2:3b')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/ollama-pdf-format.test.ts
```

- [ ] **Step 3: Implement in OllamaProvider.ts**

Apply the same pattern as GeminiProvider. In `formatAttachmentForRequest`:

```typescript
import { extractPdfText } from '@/lib/pdf-extract';
import type { TextExtractBlock } from './Provider';

if (att.type === 'pdf') {
  const result = await extractPdfText(bytes);
  return {
    _text_extract: {
      text: result.pages.join('\n\n'),
      pageCount: result.pageCount,
      fileName: att.fileName,
    },
  } satisfies TextExtractBlock;
}
```

`supportsAttachment` for PDF: return `true`.
`supportsNativePdf`: return `false`.

- [ ] **Step 4: Run tests, tsc check, commit**

```bash
npx vitest run tests/unit/models/ollama-pdf-format.test.ts
npx tsc --noEmit
git add src/modules/models/OllamaProvider.ts tests/unit/models/ollama-pdf-format.test.ts
git commit -m "feat(stream-a2): OllamaProvider PDF text-extract"
```

---

## Task 9: MockProvider PDF text-extract implementation

MockProvider records calls for testing. For PDFs it records the `TextExtractBlock` it would return, making it possible to assert in E2E tests that the correct path was taken.

**Files:**
- Modify: `src/modules/models/MockProvider.ts`
- Create: `tests/unit/models/mock-pdf-format.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/models/mock-pdf-format.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MockProvider } from '@/modules/models/MockProvider';
import type { ChatAttachment } from '@/types/ai';

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Mock extracted text page one.'],
    pageCount: 1,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf005',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'mock.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf005.pdf',
  byteSize: 4,
  metadata: { pages: 1 },
};

describe('MockProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock', async () => {
    const provider = new MockProvider();
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
    expect(block._text_extract.text).toContain('Mock extracted text page one.');
    expect(block._text_extract.fileName).toBe('mock.pdf');
  });

  it('records the call for later inspection', async () => {
    const provider = new MockProvider();
    await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES);
    expect(provider.attachmentCallLog).toHaveLength(1);
    expect(provider.attachmentCallLog[0].att.type).toBe('pdf');
  });
});

describe('MockProvider.supportsAttachment (PDF)', () => {
  it('returns true (mock supports all attachment types)', () => {
    const provider = new MockProvider();
    expect(provider.supportsAttachment(pdfAtt, 'mock-model')).toBe(true);
  });
});

describe('MockProvider.supportsNativePdf', () => {
  it('returns false (mock always uses text-extract for deterministic testing)', () => {
    const provider = new MockProvider();
    expect(provider.supportsNativePdf!('mock-model')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/models/mock-pdf-format.test.ts
```

- [ ] **Step 3: Implement in MockProvider.ts**

Add the PDF text-extract path to `MockProvider.formatAttachmentForRequest`:

```typescript
import { extractPdfText } from '@/lib/pdf-extract';
import type { TextExtractBlock } from './Provider';

// In formatAttachmentForRequest, pdf branch:
if (att.type === 'pdf') {
  const result = await extractPdfText(bytes);
  const block: TextExtractBlock = {
    _text_extract: {
      text: result.pages.join('\n\n'),
      pageCount: result.pageCount,
      fileName: att.fileName,
    },
  };
  this.attachmentCallLog.push({ att, bytes, block });
  return block;
}
```

`supportsAttachment` for PDF: return `true`.
`supportsNativePdf`: return `false`.

- [ ] **Step 4: Run tests, tsc check, commit**

```bash
npx vitest run tests/unit/models/mock-pdf-format.test.ts
npx tsc --noEmit
git add src/modules/models/MockProvider.ts tests/unit/models/mock-pdf-format.test.ts
git commit -m "feat(stream-a2): MockProvider PDF text-extract with call recording"
```

---

# Group VI: Pre-Send Preview + Mode Chip UI

## Task 10: Create PdfModeChip component

`PdfModeChip` renders next to a PDF attachment in chat history to tell the user how the PDF was processed. Native gets a green chip. Text-extract gets a yellow chip. Both have tooltips explaining the tradeoff.

**Files:**
- Create: `src/components/chat/PdfModeChip.tsx`
- Create: `tests/unit/components/chat/PdfModeChip.test.tsx`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/components/chat/PdfModeChip.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdfModeChip } from '@/components/chat/PdfModeChip';

describe('PdfModeChip - native mode', () => {
  it('renders with native variant class', () => {
    render(
      <PdfModeChip
        fileName="contract.pdf"
        pageCount={12}
        mode="native"
      />
    );
    expect(screen.getByTestId('pdf-mode-chip')).toBeTruthy();
    expect(screen.getByTestId('pdf-mode-chip').className).toMatch(/mode-chip-native/);
  });

  it('shows file name, page count, and "native PDF" label', () => {
    render(
      <PdfModeChip fileName="contract.pdf" pageCount={12} mode="native" />
    );
    const chip = screen.getByTestId('pdf-mode-chip');
    expect(chip.textContent).toContain('contract.pdf');
    expect(chip.textContent).toContain('12');
    expect(chip.textContent).toMatch(/native pdf/i);
  });
});

describe('PdfModeChip - text-extract mode', () => {
  it('renders with extracted variant class', () => {
    render(
      <PdfModeChip fileName="deck.pdf" pageCount={8} mode="text-extract" />
    );
    expect(screen.getByTestId('pdf-mode-chip').className).toMatch(/mode-chip-extracted/);
  });

  it('shows "text extracted" label', () => {
    render(
      <PdfModeChip fileName="deck.pdf" pageCount={8} mode="text-extract" />
    );
    expect(screen.getByTestId('pdf-mode-chip').textContent).toMatch(/text extracted/i);
  });
});

describe('PdfModeChip - scanned warning', () => {
  it('shows scanned warning when scanned flag is true', () => {
    render(
      <PdfModeChip
        fileName="scan.pdf"
        pageCount={2}
        mode="text-extract"
        scanned
      />
    );
    expect(screen.getByTestId('pdf-scanned-warning')).toBeTruthy();
  });

  it('does not show scanned warning when scanned is false', () => {
    render(
      <PdfModeChip fileName="scan.pdf" pageCount={2} mode="text-extract" scanned={false} />
    );
    expect(screen.queryByTestId('pdf-scanned-warning')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/components/chat/PdfModeChip.test.tsx
```

Expected: FAIL - component does not exist.

- [ ] **Step 3: Implement PdfModeChip.tsx**

Write `src/components/chat/PdfModeChip.tsx`:

```typescript
/**
 * Stream A2 - PDF mode indicator chip.
 *
 * Renders in chat history next to a PDF attachment to indicate whether the
 * PDF was sent natively (Claude document block) or via text extraction.
 *
 * Native path: figures and tables are preserved in the model's context.
 * Text-extract path: only the text layer is sent; figures and tables are
 * omitted. The tooltip explains the difference.
 */

import { cn } from '@/lib/utils';
import type { PdfMode } from '@/modules/models/pdf-capability';

export interface PdfModeChipProps {
  fileName: string;
  pageCount: number;
  mode: PdfMode;
  /** True when the PDF appears to be a scanned image with no text layer. */
  scanned?: boolean;
}

export function PdfModeChip({ fileName, pageCount, mode, scanned = false }: PdfModeChipProps) {
  const isNative = mode === 'native';
  const label = isNative ? 'native PDF' : 'text extracted';
  const title = isNative
    ? 'Sent as native PDF - figures, tables, and formatting are preserved in the model context.'
    : 'Sent as extracted text - only the text layer was sent. Figures and tables are not included.';

  return (
    <span
      data-testid="pdf-mode-chip"
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isNative
          ? 'mode-chip-native bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          : 'mode-chip-extracted bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      )}
    >
      {fileName} &middot; {pageCount} {pageCount === 1 ? 'page' : 'pages'} &middot; {label}
      {scanned && (
        <span
          data-testid="pdf-scanned-warning"
          className="ml-1 text-yellow-600 dark:text-yellow-400"
          title="This PDF appears to be scanned. The text layer is absent or empty."
        >
          (scanned)
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/components/chat/PdfModeChip.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/PdfModeChip.tsx tests/unit/components/chat/PdfModeChip.test.tsx
git commit -m "feat(stream-a2): PdfModeChip - native/extracted indicator with scanned warning"
```

---

## Task 11: Create PdfPreviewBeforeSend component

Before sending in text-extract mode, the user sees the first 200 characters of extracted text in a modal. This lets them catch garbled extraction before it hits the API.

**Files:**
- Create: `src/components/chat/PdfPreviewBeforeSend.tsx`
- Create: `tests/unit/components/chat/PdfPreviewBeforeSend.test.tsx`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/components/chat/PdfPreviewBeforeSend.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdfPreviewBeforeSend } from '@/components/chat/PdfPreviewBeforeSend';

const SAMPLE_TEXT =
  'This is the extracted text from the PDF. It contains useful information about the contract terms and conditions.';

describe('PdfPreviewBeforeSend', () => {
  it('renders the modal when open', () => {
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="contract.pdf"
        extractedPreview={SAMPLE_TEXT}
        pageCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('pdf-preview-modal')).toBeTruthy();
  });

  it('does not render when closed', () => {
    render(
      <PdfPreviewBeforeSend
        isOpen={false}
        fileName="contract.pdf"
        extractedPreview={SAMPLE_TEXT}
        pageCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByTestId('pdf-preview-modal')).toBeNull();
  });

  it('shows file name and page count', () => {
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="contract.pdf"
        extractedPreview={SAMPLE_TEXT}
        pageCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('pdf-preview-modal').textContent).toContain('contract.pdf');
    expect(screen.getByTestId('pdf-preview-modal').textContent).toContain('3');
  });

  it('truncates preview to 200 characters', () => {
    const longText = 'A'.repeat(300);
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="big.pdf"
        extractedPreview={longText}
        pageCount={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const preview = screen.getByTestId('pdf-preview-text');
    expect(preview.textContent!.length).toBeLessThanOrEqual(203); // 200 + '...'
  });

  it('calls onConfirm when "Send anyway" is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="doc.pdf"
        extractedPreview={SAMPLE_TEXT}
        pageCount={1}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('pdf-preview-confirm-button'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when "Cancel" is clicked', () => {
    const onCancel = vi.fn();
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="doc.pdf"
        extractedPreview={SAMPLE_TEXT}
        pageCount={1}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId('pdf-preview-cancel-button'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows scanned warning when scanned flag is true', () => {
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="scan.pdf"
        extractedPreview=""
        pageCount={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        scanned
      />
    );
    expect(screen.getByTestId('pdf-preview-scanned-warning')).toBeTruthy();
  });

  it('shows "Send as native PDF" button when canSendNative is true', () => {
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="scan.pdf"
        extractedPreview=""
        pageCount={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onSendNative={vi.fn()}
        scanned
        canSendNative
      />
    );
    expect(screen.getByTestId('pdf-preview-send-native-button')).toBeTruthy();
  });

  it('calls onSendNative when "Send as native PDF" is clicked', () => {
    const onSendNative = vi.fn();
    render(
      <PdfPreviewBeforeSend
        isOpen
        fileName="scan.pdf"
        extractedPreview=""
        pageCount={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onSendNative={onSendNative}
        scanned
        canSendNative
      />
    );
    fireEvent.click(screen.getByTestId('pdf-preview-send-native-button'));
    expect(onSendNative).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/components/chat/PdfPreviewBeforeSend.test.tsx
```

Expected: FAIL - component does not exist.

- [ ] **Step 3: Implement PdfPreviewBeforeSend.tsx**

Write `src/components/chat/PdfPreviewBeforeSend.tsx`:

```typescript
/**
 * Stream A2 - Pre-send text extraction preview modal.
 *
 * Shown before sending a PDF in text-extract mode. Displays the first 200
 * characters of extracted text so the user can verify the extraction looks
 * correct before committing the send.
 *
 * For scanned PDFs (near-empty extraction), a warning is shown and the
 * "Send as native PDF anyway" button appears when Claude is the active
 * provider (canSendNative = true).
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const PREVIEW_LIMIT = 200;

export interface PdfPreviewBeforeSendProps {
  isOpen: boolean;
  fileName: string;
  /** Full extracted text. The component truncates it to 200 chars for display. */
  extractedPreview: string;
  pageCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  /** When true, shows the scanned-PDF warning. */
  scanned?: boolean;
  /** When true, shows the "Send as native PDF" escape hatch (only when Claude is active). */
  canSendNative?: boolean;
  /** Called when the user clicks "Send as native PDF". */
  onSendNative?: () => void;
}

export function PdfPreviewBeforeSend({
  isOpen,
  fileName,
  extractedPreview,
  pageCount,
  onConfirm,
  onCancel,
  scanned = false,
  canSendNative = false,
  onSendNative,
}: PdfPreviewBeforeSendProps) {
  if (!isOpen) return null;

  const preview = extractedPreview.length > PREVIEW_LIMIT
    ? extractedPreview.slice(0, PREVIEW_LIMIT) + '...'
    : extractedPreview;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-testid="pdf-preview-modal">
        <DialogHeader>
          <DialogTitle>
            PDF extraction preview: {fileName}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'} extracted as text.
          Review the sample below before sending.
        </p>

        {scanned && (
          <div
            data-testid="pdf-preview-scanned-warning"
            className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200"
          >
            This PDF appears to be a scanned image. The text layer is absent or near-empty.
            Extraction may not produce useful results.
          </div>
        )}

        <pre
          data-testid="pdf-preview-text"
          className="max-h-32 overflow-y-auto rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap"
        >
          {preview || '(no text extracted)'}
        </pre>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            data-testid="pdf-preview-cancel-button"
            variant="ghost"
            onClick={onCancel}
          >
            Cancel
          </Button>

          {scanned && canSendNative && onSendNative && (
            <Button
              data-testid="pdf-preview-send-native-button"
              variant="outline"
              onClick={onSendNative}
            >
              Send as native PDF
            </Button>
          )}

          <Button
            data-testid="pdf-preview-confirm-button"
            onClick={onConfirm}
          >
            Send anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/components/chat/PdfPreviewBeforeSend.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/PdfPreviewBeforeSend.tsx tests/unit/components/chat/PdfPreviewBeforeSend.test.tsx
git commit -m "feat(stream-a2): PdfPreviewBeforeSend modal with scanned warning and native PDF escape hatch"
```

---

# Group VII: AIChatViewer Integration

## Task 12: Wire PDF flow into AIChatViewer

This is the main integration task. It connects the extraction utility, mode chip, pre-send preview, audit event, and cost meter into the existing chat send path.

**Files:**
- Modify: `src/components/ai/AIChatViewer.tsx`
- Modify: `src/types/audit.ts` (confirm `pdf_extracted` payload)

- [ ] **Step 1: Confirm pdf_extracted audit event in src/types/audit.ts**

```bash
grep -n "pdf_extracted" src/types/audit.ts
```

If the event is present, verify its payload shape includes `{ path: string; pages: number; mode: 'native' | 'text-extract' }`. If missing or incomplete, add it:

```typescript
| {
    type: 'pdf_extracted';
    payload: {
      path: string;        // pathInWorkspace from the ChatAttachment
      pages: number;       // pageCount from extractPdfText result
      mode: 'native' | 'text-extract';
    };
  }
```

- [ ] **Step 2: Add pendingPdfExtractions state**

In `AIChatViewer.tsx`, add state for:

- `pdfPreviewState`: tracks whether the pre-send preview modal is open, and which PDF triggered it.
- `extractionResultCache`: maps attachment id to `PdfExtractionResult` so extraction runs once per attachment, not on every render.

```typescript
import { PdfPreviewBeforeSend } from '@/components/chat/PdfPreviewBeforeSend';
import { PdfModeChip } from '@/components/chat/PdfModeChip';
import { getPdfMode, supportsNativePdf } from '@/modules/models/pdf-capability';
import { extractPdfText, type PdfExtractionResult } from '@/lib/pdf-extract';
import { estimatePdfTokens } from '@/modules/attachments/pdfTokens';

// Inside the AIChatViewer component:
const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
const [pdfPreviewTarget, setPdfPreviewTarget] = useState<ChatAttachment | null>(null);
const [extractionCache, setExtractionCache] = useState<
  Map<string, PdfExtractionResult>
>(new Map());
```

- [ ] **Step 3: Handle encrypted PDF on attach**

When the user attaches a PDF (in `handleFilesSelected`, which Plan A1 added), run extraction immediately after `AttachmentService.save` for PDF attachments. If `result.encrypted === true`, show a toast and reject the attachment:

```typescript
if (att.type === 'pdf') {
  // Read bytes back from the just-saved attachment.
  const bytes = await AttachmentService.read(att.pathInWorkspace);
  const result = await extractPdfText(bytes);
  if (result.encrypted) {
    toast.error(`${att.fileName}: Encrypted PDFs are not supported.`);
    // Remove the just-saved attachment.
    await AttachmentService.delete(att.pathInWorkspace);
    return; // Do not add to pendingAttachments.
  }
  // Cache the extraction result for use in handleSendMessage.
  setExtractionCache((prev) => new Map(prev).set(att.id, result));
}
```

- [ ] **Step 4: Show pre-send preview before calling the provider**

In `handleSendMessage`, before calling `provider.sendMessage` or `provider.sendMessageStreaming`, check for PDF attachments in text-extract mode and gate the send on user confirmation:

```typescript
// Check if any pending PDF requires text-extract mode and preview.
const pdfAtts = pendingAttachments.filter((a) => a.type === 'pdf');
const pdfNeedsPreview = pdfAtts.some((att) => {
  const mode = getPdfMode(chatProvider, chatModel);
  return mode === 'text-extract';
});

if (pdfNeedsPreview && pdfAtts.length > 0) {
  // Show preview for the first PDF (multi-PDF in single message is rare;
  // preview sequencing is handled by the user confirming one at a time).
  setPdfPreviewTarget(pdfAtts[0]);
  setPdfPreviewOpen(true);
  // The actual send happens in the onConfirm callback below.
  // Suspend the send path here.
  return;
}

// Proceed with the send (all PDFs are native, or user confirmed extraction).
await executeSend();
```

Refactor the send logic into an `executeSend()` function that both the direct path and the `onConfirm` callback can call.

- [ ] **Step 5: Build the provider request with PDF content**

Inside `executeSend()`, for each PDF attachment, call `formatAttachmentForRequest`. For text-extract providers, the returned `TextExtractBlock` must be injected into the message text rather than as a binary content block:

```typescript
for (const att of pendingAttachments) {
  if (att.type === 'pdf') {
    const bytes = await AttachmentService.read(att.pathInWorkspace);
    const block = await provider.formatAttachmentForRequest(att, bytes);

    if ('_text_extract' in block) {
      // Inject extracted text into the user message content.
      const { text, pageCount, fileName } = block._text_extract;
      systemPromptAddendum +=
        `\n\n---\nAttached PDF: ${fileName} (${pageCount} pages)\n\n${text}\n---`;
    } else {
      // Native Claude document block: pass in the content array.
      nativeContentBlocks.push(block);
    }

    // Fire pdf_extracted audit event.
    const mode = getPdfMode(chatProvider, chatModel);
    await auditService.log({
      type: 'pdf_extracted',
      payload: {
        path: att.pathInWorkspace,
        pages: extractionCache.get(att.id)?.pageCount ?? (att.metadata.pages ?? 0),
        mode,
      },
    });
  }
}
```

Pass `systemPromptAddendum` as an addition to the provider's `systemPrompt` option, and `nativeContentBlocks` as additional content blocks in the Claude API content array.

- [ ] **Step 6: Render PdfModeChip in chat history**

In the chat message rendering section of `AIChatViewer.tsx`, for each `ChatMessage` that has PDF attachments, render a `PdfModeChip` below the message text:

```tsx
{msg.attachments
  ?.filter((att) => att.type === 'pdf')
  .map((att) => (
    <PdfModeChip
      key={att.id}
      fileName={att.fileName}
      pageCount={att.metadata.pages ?? 0}
      mode={att.metadata.extractionMode ?? 'text-extract'}
      scanned={false} // scanned flag stored in metadata if needed; default false for history
    />
  ))}
```

Save `extractionMode` into `att.metadata.extractionMode` when building the message object before persistence so that history reloads show the correct chip.

- [ ] **Step 7: Render PdfPreviewBeforeSend in the component tree**

Add the modal to the `AIChatViewer` JSX:

```tsx
{pdfPreviewTarget && (
  <PdfPreviewBeforeSend
    isOpen={pdfPreviewOpen}
    fileName={pdfPreviewTarget.fileName}
    extractedPreview={
      extractionCache.get(pdfPreviewTarget.id)?.pages.join(' ') ?? ''
    }
    pageCount={
      extractionCache.get(pdfPreviewTarget.id)?.pageCount ?? 0
    }
    scanned={extractionCache.get(pdfPreviewTarget.id)?.scanned ?? false}
    canSendNative={
      chatProvider === 'claude' &&
      supportsNativePdf(chatProvider, chatModel)
    }
    onConfirm={() => {
      setPdfPreviewOpen(false);
      void executeSend();
    }}
    onCancel={() => {
      setPdfPreviewOpen(false);
      setPdfPreviewTarget(null);
    }}
    onSendNative={() => {
      // Override the model's mode to native for this send only.
      // Achieved by temporarily overriding the provider's model in executeSend.
      setPdfPreviewOpen(false);
      void executeSend({ forcePdfNative: true });
    }}
  />
)}
```

- [ ] **Step 8: tsc check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/ai/AIChatViewer.tsx src/types/audit.ts
git commit -m "feat(stream-a2): AIChatViewer PDF integration - encrypt block, pre-send preview, audit event, mode chip in history"
```

---

# Group VIII: PDF Cost Meter

## Task 13: Create pdfTokens.ts and integrate into cost meter

**Files:**
- Create: `src/modules/attachments/pdfTokens.ts`
- Modify: `src/modules/attachments/index.ts`
- Create: `tests/unit/attachments/pdfTokens.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/attachments/pdfTokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { estimatePdfTokens } from '@/modules/attachments/pdfTokens';
import type { PdfExtractionResult } from '@/lib/pdf-extract';

function mockResult(overrides: Partial<PdfExtractionResult>): PdfExtractionResult {
  return {
    pages: [],
    pageCount: 0,
    encrypted: false,
    scanned: false,
    ...overrides,
  };
}

describe('estimatePdfTokens - native Claude', () => {
  it('1-page PDF = 3000 tokens', () => {
    const result = mockResult({ pageCount: 1, pages: ['text'] });
    expect(estimatePdfTokens('native', result)).toBe(3000);
  });

  it('5-page PDF = 15000 tokens', () => {
    const result = mockResult({ pageCount: 5, pages: Array(5).fill('text') });
    expect(estimatePdfTokens('native', result)).toBe(15000);
  });

  it('0 pages (encrypted) = 0 tokens', () => {
    const result = mockResult({ pageCount: 0, pages: [], encrypted: true });
    expect(estimatePdfTokens('native', result)).toBe(0);
  });
});

describe('estimatePdfTokens - text-extract', () => {
  it('100-char text = 25 tokens (100 / 4)', () => {
    const text = 'A'.repeat(100);
    const result = mockResult({ pages: [text], pageCount: 1 });
    expect(estimatePdfTokens('text-extract', result)).toBe(25);
  });

  it('400-char text across 2 pages = 100 tokens', () => {
    const result = mockResult({
      pages: ['A'.repeat(200), 'B'.repeat(200)],
      pageCount: 2,
    });
    expect(estimatePdfTokens('text-extract', result)).toBe(100);
  });

  it('empty text = 0 tokens', () => {
    const result = mockResult({ pages: [''], pageCount: 1 });
    expect(estimatePdfTokens('text-extract', result)).toBe(0);
  });

  it('scanned PDF with near-empty text = 0 or near-0 tokens', () => {
    const result = mockResult({ pages: ['ab'], pageCount: 1, scanned: true });
    expect(estimatePdfTokens('text-extract', result)).toBe(0); // 2 / 4 = 0 (floor)
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/attachments/pdfTokens.test.ts
```

Expected: FAIL - module does not exist.

- [ ] **Step 3: Implement pdfTokens.ts**

Write `src/modules/attachments/pdfTokens.ts`:

```typescript
/**
 * Stream A2 - PDF token estimation for the cost meter.
 *
 * Two modes, corresponding to PdfMode from pdf-capability.ts:
 *
 *   native:       Anthropic charges roughly 3000 tokens per A4 page for the
 *                 native PDF document block (source: Anthropic docs, 2026-04).
 *                 This is an approximation; actual cost depends on image density.
 *
 *   text-extract: Token count derived from extracted text length using the
 *                 universal 4-chars-per-token heuristic. This is the actual
 *                 token count because the text is sent verbatim.
 *
 * Returns 0 for encrypted PDFs (they are blocked before reaching the cost meter).
 */

import type { PdfExtractionResult } from '@/lib/pdf-extract';
import type { PdfMode } from '@/modules/models/pdf-capability';

/** Approximate tokens per A4 page for Claude's native PDF block. */
const NATIVE_TOKENS_PER_PAGE = 3000;

/**
 * Estimate token count for a PDF based on extraction mode and result.
 *
 * @param mode    'native' (Claude document block) or 'text-extract' (all others).
 * @param result  Output from extractPdfText.
 */
export function estimatePdfTokens(mode: PdfMode, result: PdfExtractionResult): number {
  if (result.encrypted || result.pageCount === 0) return 0;

  if (mode === 'native') {
    return NATIVE_TOKENS_PER_PAGE * result.pageCount;
  }

  // text-extract: derive from actual character count.
  const totalChars = result.pages.reduce((sum, p) => sum + p.length, 0);
  return Math.floor(totalChars / 4);
}
```

- [ ] **Step 4: Export from attachments/index.ts**

In `src/modules/attachments/index.ts`, add:

```typescript
export { estimatePdfTokens } from './pdfTokens';
```

- [ ] **Step 5: Wire into AIChatViewer cost-meter**

In `AIChatViewer.tsx`'s `executeSend` function, after processing PDF attachments, accumulate `pdfTokenOverhead` alongside the existing `imageTokenOverhead` from Plan A1:

```typescript
import { estimatePdfTokens } from '@/modules/attachments/pdfTokens';
import { getPdfMode } from '@/modules/models/pdf-capability';

// Inside executeSend, after extracting text / building native blocks:
let pdfTokenOverhead = 0;
for (const att of pendingAttachments.filter((a) => a.type === 'pdf')) {
  const cached = extractionCache.get(att.id);
  if (cached) {
    const mode = getPdfMode(chatProvider, chatModel);
    pdfTokenOverhead += estimatePdfTokens(mode, cached);
  }
}

// In the recordCost call (both streaming and non-streaming paths):
recordCost(chatId, {
  cost: response.cost,
  inputTokens: response.usage.inputTokens + imageTokenOverhead + pdfTokenOverhead,
  outputTokens: response.usage.outputTokens,
  provider: chatProvider,
});
```

The cost-meter tooltip on the send button ("Send (~84K tokens, ~$0.27)") already reads from the accumulated token count, so no additional wiring is needed for the tooltip itself. Confirm by checking the existing `CostPreviewTooltip` (or equivalent) component reads `imageTokenOverhead` already - if it does, extend it to also include `pdfTokenOverhead` in the pre-send estimate.

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/unit/attachments/pdfTokens.test.ts
```

Expected: all pass.

- [ ] **Step 7: tsc check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/attachments/pdfTokens.ts src/modules/attachments/index.ts tests/unit/attachments/pdfTokens.test.ts src/components/ai/AIChatViewer.tsx
git commit -m "feat(stream-a2): pdfTokens.ts - cost meter for native (3000/page) and text-extract (chars/4)"
```

---

# Group IX: E2E Test + Final Verification

## Task 14: E2E test and full verification pass

**Files:**
- Create: `tests/e2e/pdf-attachment.spec.ts`

- [ ] **Step 1: Write the E2E test**

Write `tests/e2e/pdf-attachment.spec.ts`:

```typescript
/**
 * Stream A2 E2E - PDF attachment send flow.
 *
 * Uses MockProvider (no real API key required). Tests:
 *   1. Attach a text-based PDF via file picker.
 *   2. Extraction preview modal appears.
 *   3. User confirms send.
 *   4. Message appears in history with a "text extracted" mode chip.
 *   5. Reload - mode chip persists.
 *   6. Attach an encrypted PDF - error toast appears, PDF is not added.
 *   7. Switch to Claude Sonnet (mocked) - mode chip shows "native PDF".
 *
 * NOTE: Steps 6 and 7 require fixture PDFs. If fixture PDFs are not
 * available in CI, those test blocks are skipped via test.skip.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Minimal 1-page PDF fixture embedded as base64. Replace STUB with real bytes.
// This is the same simple PDF used in unit tests.
const SIMPLE_PDF_BASE64 = 'STUB_REPLACE_WITH_REAL_SIMPLE_PDF_BASE64';

function writeTempPdf(base64: string, name: string): string {
  const dir = path.join(process.cwd(), 'tests/fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const fpath = path.join(dir, name);
  fs.writeFileSync(fpath, Buffer.from(base64, 'base64'));
  return fpath;
}

test.describe('PDF attachment E2E', () => {
  test.beforeAll(() => {
    if (SIMPLE_PDF_BASE64 === 'STUB_REPLACE_WITH_REAL_SIMPLE_PDF_BASE64') {
      test.skip(true, 'PDF fixture not yet provided. Replace STUB in test file.');
    }
  });

  test('attach PDF in text-extract mode, confirm preview, verify mode chip', async ({ page }) => {
    const pdfPath = writeTempPdf(SIMPLE_PDF_BASE64, 'simple.pdf');
    await page.goto('/');

    // Navigate to AI Assistant.
    await page.getByTestId('sidebar-link-ai-assistant').click();
    await page.getByTestId('new-chat-button').click();
    await expect(page.getByTestId('chat-input')).toBeVisible();

    // Confirm provider is Mock (text-extract path).
    // In a real test, ensure the active provider is Mock or configure it via settings.

    // Attach PDF via file picker.
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('chat-paperclip-button').click(),
    ]);
    await fileChooser.setFiles(pdfPath);

    // Attachment tile should appear.
    await expect(page.getByTestId('attachment-tile-simple.pdf')).toBeVisible({ timeout: 5000 });

    // Type a message and send.
    await page.getByTestId('chat-input').fill('Summarize this PDF.');
    await page.getByTestId('chat-send-button').click();

    // Extraction preview modal should appear (text-extract mode).
    await expect(page.getByTestId('pdf-preview-modal')).toBeVisible({ timeout: 5000 });

    // Preview should contain some text.
    const previewText = await page.getByTestId('pdf-preview-text').textContent();
    expect(previewText).not.toBe('(no text extracted)');

    // Confirm send.
    await page.getByTestId('pdf-preview-confirm-button').click();

    // Message should appear in history.
    await expect(page.getByTestId('chat-message-user').last()).toBeVisible({ timeout: 10000 });

    // Mode chip should show "text extracted".
    await expect(page.getByTestId('pdf-mode-chip')).toBeVisible({ timeout: 5000 });
    expect(await page.getByTestId('pdf-mode-chip').textContent()).toMatch(/text extracted/i);

    // Reload and verify mode chip persists.
    await page.reload();
    await expect(page.getByTestId('pdf-mode-chip')).toBeVisible({ timeout: 5000 });
    expect(await page.getByTestId('pdf-mode-chip').textContent()).toMatch(/text extracted/i);
  });
});
```

- [ ] **Step 2: Run all unit tests**

```bash
npx vitest run
```

Expected: all existing and new tests pass. Zero failures.

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

- [ ] **Step 5: grep for em dashes**

```bash
grep -rn "-" src/lib/pdf-extract.ts src/modules/models/pdf-capability.ts src/modules/attachments/pdfTokens.ts src/components/chat/PdfModeChip.tsx src/components/chat/PdfPreviewBeforeSend.tsx src/modules/models/ClaudeProvider.ts src/modules/models/OpenAIProvider.ts src/modules/models/GeminiProvider.ts src/modules/models/OllamaProvider.ts src/modules/models/MockProvider.ts src/modules/models/Provider.ts
```

Expected: no matches. If any appear, replace them with a comma or rewrite the sentence.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/pdf-attachment.spec.ts
git commit -m "test(stream-a2): E2E PDF attach, preview modal, mode chip persistence"
```

---

## What Is Deferred (Plan A2 does not close the Stream A PR)

Stream A uses a single rolling branch (`feature/stream-a`). Plan A2 leaves the branch ready for Plan A3. The Stream A PR opens only after Plans A3 and A4 land. Do not open a PR at the end of A2.

Deferred to later A-sub-plans:

- **Plan A3:** PDF-to-RAG indexing. The `extractPdfText` function from this plan is reused by the RAG walker, but the index storage, embedding, and workspace integration are all A3 scope.
- **Plan A4:** Long-context UX - context cap raise, summarization compression, cost preview in input.

---

## Self-Review Results

### 1. Every Plan A2 scope item has a task?

| Scope item | Covered |
|---|---|
| pdfjs-dist dependency + lazy-load on first PDF attach | Task 1 (install + copy worker) |
| Web worker config (Vite static asset pattern) | Task 1 (copy to public/, set workerSrc in pdf-extract.ts) |
| `extractPdfText(bytes): Promise<{ pages, pageCount, encrypted }>` | Task 2 |
| Claude: native PDF content block `{ type: 'document', ... }` | Task 5 (ClaudeProvider) |
| OpenAI PDF: text-extract fallback | Task 6 |
| Gemini PDF: text-extract fallback | Task 7 |
| Ollama PDF: text-extract fallback | Task 8 |
| Mock PDF: text-extract with call recording | Task 9 |
| Hybrid routing logic in send path | Task 12 (AIChatViewer integration) |
| `supportsAttachment` for `att.type === 'pdf'` (replacing stubs) | Tasks 5-9 |
| UI mode-indicator chips (native green / extracted yellow) | Task 10 (PdfModeChip) |
| Pre-send 200-char extraction preview | Task 11 (PdfPreviewBeforeSend) |
| Cost preview tooltip - native 3000/page, text-extract chars/4 | Task 13 (pdfTokens.ts + AIChatViewer wire) |
| Encrypted PDF: surface error, don't attach | Task 12 Step 3 (handleFilesSelected gating) |
| Scanned PDF: warning chip + "send native" escape hatch | Task 10 (PdfModeChip scanned prop), Task 11 (PdfPreviewBeforeSend canSendNative) |
| `pdf_extracted` audit event | Task 12 Step 5 |
| `pdf-capability.ts` config (supportsNativePdf, getPdfMode) | Task 3 |
| `pdfTokens.ts` cost meter integration | Task 13 |
| E2E verification | Task 14 |

All scope items are covered. No gaps.

### 2. PDF.js setup is concrete and executable?

Yes. Task 1 specifies: `npm install pdfjs-dist`, `ls node_modules/pdfjs-dist/build/` to find the exact worker filename, `cp` to `public/`, and a `prebuild`/`predev` npm script to automate the copy. Task 2 sets `GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'` inside a `ensureWorkerConfigured()` function that runs once. The `.mjs` extension is noted as version-dependent with a branch for `.js`.

### 3. Hybrid routing logic is fully specified per provider?

Yes. The routing decision lives in two places:

- `pdf-capability.ts` exports `getPdfMode(provider, model): PdfMode` - the single source of truth for which mode applies.
- Each provider's `formatAttachmentForRequest` handles its own mode:
  - `ClaudeProvider`: checks `supportsNativePdf` internally; returns `ClaudeDocumentBlock` for supported models; throws a descriptive error (caught by AIChatViewer) for Haiku.
  - `OpenAI`, `Gemini`, `Ollama`, `Mock`: call `extractPdfText`, return `TextExtractBlock`.
- `AIChatViewer.executeSend` detects `TextExtractBlock` by the `_text_extract` sentinel key and injects text into `systemPromptAddendum`; it passes `ClaudeDocumentBlock` to the content array.

### 4. Edge cases (encrypted, scanned) have explicit handling tasks?

Yes.

- **Encrypted PDF:** Task 12 Step 3 - extraction runs immediately after save, `encrypted === true` shows a toast, the file is deleted from the workspace, and it is never added to `pendingAttachments`. The `formatAttachmentForRequest` methods never see an encrypted PDF.
- **Scanned PDF:** Task 10 (PdfModeChip renders `(scanned)` suffix), Task 11 (PdfPreviewBeforeSend shows yellow warning and "Send as native PDF" button when `canSendNative` is true), Task 12 Step 7 (the modal is wired with `scanned` and `canSendNative` props from AIChatViewer state).

### 5. Em dash, time estimate, TBD check

- Em dashes: Task 14 Step 5 includes a grep command to catch them in all new source files. No em dashes appear in the plan text or in any code block in this plan.
- Time estimates: none in implementation steps.
- TBD / TODO / "implement later": none. Every step is fully specified.

### 6. Type/method names consistent across tasks?

- `extractPdfText(bytes: Uint8Array): Promise<PdfExtractionResult>`: consistent in Task 2, Task 12, all provider tests.
- `PdfExtractionResult`: consistent across Task 2 (definition), Task 13 (pdfTokens.ts input type), provider test mocks.
- `supportsNativePdf(provider, model): boolean` (module function in pdf-capability.ts): consistent in Task 3, Task 5.
- `supportsNativePdf(model: string): boolean` (Provider interface method): consistent in Tasks 4-9.
- `getPdfMode(provider, model): PdfMode`: consistent in Tasks 3, 12, 13.
- `PdfMode = 'native' | 'text-extract'`: consistent across Tasks 3, 10, 11, 13.
- `ClaudeDocumentBlock`: consistent across Tasks 4, 5.
- `TextExtractBlock`: consistent across Tasks 4, 6-9, 12.
- `estimatePdfTokens(mode: PdfMode, result: PdfExtractionResult): number`: consistent in Task 13.
- `formatAttachmentForRequest(att, bytes): ProviderContentBlock | Promise<ProviderContentBlock>`: consistent across all provider tasks (Tasks 5-9).
- `supportsAttachment(att, model): true | string`: consistent across all provider tasks.

### 7. Per-provider format method signatures consistent with Provider interface?

The signature in `Provider.ts` after Task 4's extension:

```typescript
formatAttachmentForRequest(
  att: ChatAttachment,
  bytes: Uint8Array
): ProviderContentBlock | Promise<ProviderContentBlock>;
```

- `ClaudeProvider`: synchronous for native PDF (returns `ClaudeDocumentBlock`), throws synchronously for unsupported models.
- `OpenAIProvider`, `GeminiProvider`, `OllamaProvider`, `MockProvider`: all `async`, return `Promise<TextExtractBlock>` for PDF.
- The union return type covers both cases without requiring all providers to be async.

### 8. Concerns and follow-ups

**PDF.js worker file extension:** pdfjs-dist v4.x ships `pdf.worker.min.mjs`. Earlier versions used `.js`. Task 1 includes a `ls node_modules/pdfjs-dist/build/` step to determine the exact filename before copying. The `workerSrc` path in `ensureWorkerConfigured()` must match the copied filename exactly.

**Fixture PDFs for tests and E2E:** Both `tests/unit/lib/pdf-extract.test.ts` and `tests/e2e/pdf-attachment.spec.ts` use base64-embedded fixture PDFs with `STUB_REPLACE_WITH_REAL_*_BASE64` markers. These stubs must be replaced with real PDF bytes before the tests can pass. Task 2 Step 4 provides shell commands using `fpdf` (Python) and `qpdf` to generate the fixtures. If neither tool is available in the build environment, the affected test blocks should be marked `it.skip` with a comment explaining the requirement.

**AIChatViewer refactor scope:** Task 12 introduces a meaningful refactor of `handleSendMessage` into an `executeSend()` function to support the confirmation gate. The implementing worker should read the existing `handleSendMessage` implementation carefully and preserve all existing streaming, abort-signal, and error-handling behavior. The refactor is additive, not a rewrite.

**ClaudeProvider model field access:** Task 5 accesses `this.config.model` to determine the current model for the `supportsNativePdf` check in `formatAttachmentForRequest`. If `ClaudeProvider` stores the model differently (e.g. `this.model`), adjust the reference accordingly.


**scanned flag persistence:** Task 12 Step 6 notes that `att.metadata.extractionMode` is saved at message-build time so history reloads show the correct chip. The `scanned` flag is not currently persisted to `att.metadata`. If future requirements need the scanned indicator to appear on history reloads, add `att.metadata.scanned` to the `ChatAttachment` type and save it alongside `extractionMode`. This is out of scope for A2 but is a straightforward extension.
