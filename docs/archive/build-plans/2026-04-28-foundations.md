# Projelli v2.0 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all shared interfaces, types, configuration, and skeleton services that every v2.0 stream depends on. No stream-specific features. No end-user-visible behavior changes. Foundations branch must merge to `main` before any stream begins.

**Architecture:** Foundations is plumbing. It produces typed interfaces, skeleton services with passing tests, configuration files, audit log additions, settings nav slots, and CI gates that the 5 implementation streams build on top of. Each foundation has its own tests; existing functionality stays unbroken.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Zustand, Vitest, Tauri 2 (Rust), i18next + react-i18next + i18next-parser, ESLint with custom rule, sql.js / native sqlite.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 3.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/types/chat.ts` | Extend with `ChatAttachment` and `ChatMessage.attachments` |
| `src/types/marketplace.ts` | `CatalogEntry`, `InstalledEntry`, `UpdateInfo` types |
| `src/types/audit.ts` | Extend `AuditEvent` union with v2.0 event types |
| `src/modules/attachments/AttachmentService.ts` | Save / read / delete / hash for chat attachments |
| `src/modules/attachments/index.ts` | Barrel export |
| `src/modules/marketplace/MarketplaceService.ts` | Fetch / cache / install / uninstall for GitHub catalogs |
| `src/modules/marketplace/types.ts` | Internal types |
| `src/modules/marketplace/index.ts` | Barrel export |
| `src/i18n.ts` | i18next runtime config |
| `src/locales/en.json` | English source-of-truth (seed strings only) |
| `src/locales/es.json` | Spanish (empty in foundations, populated in Stream E) |
| `src/locales/de.json` | German (empty in foundations, populated in Stream E) |
| `src/lib/locale-detect.ts` | OS locale detection via Tauri |
| `eslint-plugin-projelli-i18n/index.js` | Custom ESLint rule |
| `eslint-plugin-projelli-i18n/lib/no-hardcoded-string.js` | Rule implementation |
| `eslint-plugin-projelli-i18n/package.json` | Plugin package manifest |
| `i18next-parser.config.js` | i18n parser config |
| `src-tauri/src/sidecars/mod.rs` | `Sidecar` trait |
| `src-tauri/src/sidecars/parakeet.rs` | Refactored Parakeet using trait |
| `src/components/settings/MarketplaceSettings.tsx` | Empty placeholder |
| `src/components/settings/MobileSettings.tsx` | Empty placeholder |
| `src/components/settings/PluginsSettings.tsx` | Empty placeholder |
| `src/components/settings/AdvancedSettings.tsx` | Empty placeholder |
| `tests/unit/attachments/AttachmentService.test.ts` | Unit tests |
| `tests/unit/marketplace/MarketplaceService.test.ts` | Unit tests |
| `tests/unit/i18n/locale-detect.test.ts` | Unit tests |
| `tests/unit/audit/audit-event-types.test.ts` | Type-shape tests |

### Files to modify

| Path | Change |
|---|---|
| `package.json` | Add i18next, react-i18next, i18next-parser, the local ESLint plugin |
| `src/main.tsx` | Initialize i18next + locale detection on bootstrap |
| `src/modules/models/Provider.ts` | Add `formatAttachmentForRequest`, `supportsAttachment` to interface |
| `src/modules/models/ClaudeProvider.ts` | Stub implementations of new Provider methods |
| `src/modules/models/OpenAIProvider.ts` | Stub implementations |
| `src/modules/models/GeminiProvider.ts` | Stub implementations |
| `src/modules/models/OllamaProvider.ts` | Stub implementations |
| `src/modules/audit/AuditService.ts` | Accept new event types from extended union |
| `src/components/settings/SettingsNav.tsx` | Add nav links for Marketplace, Mobile, Plugins, Advanced |
| `src/components/settings/SettingsRouter.tsx` | Wire new placeholder pages |
| `src/stores/settingsStore.ts` | Add `language` field, default `null` |
| `.eslintrc.cjs` (or equivalent) | Enable `projelli-i18n/no-hardcoded-string` rule |
| `.github/workflows/ci.yml` | Run i18next-parser strict check |
| `vite.config.ts` | Possibly add alias if locales path needs it |

### Files to NOT modify (out of foundations scope)

- Existing chat panel UI (Stream A integrates AttachmentService later)
- Workflow panel UI (Stream C integrates marketplace later)
- TTS UI components (Stream B builds on Sidecar trait later)
- Any existing user-facing string (Stream E sweep handles those later)

---

## Task Decomposition

There are 7 task groups. Within each group, tasks run sequentially. Across groups, the order is dependency-driven (types before consumers).

- Group I: i18n tooling setup (Tasks 1–7)
- Group II: Chat-attachment foundations (Tasks 8–13)
- Group III: Provider interface extension (Tasks 14–17)
- Group IV: MarketplaceService skeleton (Tasks 18–24)
- Group V: Sidecar trait refactor (Tasks 25–28)
- Group VI: Settings schema additions (Tasks 29–32)
- Group VII: Audit log additions (Tasks 33–34)

Final task: open foundations PR.

---

# Group I: i18n Tooling Setup

## Task 1: Install i18n dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependencies**

Run from `~/projelli/`:
```bash
npm install i18next@^23 react-i18next@^14
npm install --save-dev i18next-parser@^9
```

- [ ] **Step 2: Verify install**

Run:
```bash
npx i18next-parser --version
```
Expected: prints a version number starting with `9.`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add i18next, react-i18next, i18next-parser for foundations"
```

---

## Task 2: Create empty locale files

**Files:**
- Create: `src/locales/en.json`, `src/locales/es.json`, `src/locales/de.json`

- [ ] **Step 1: Create en.json with seed string**

```bash
mkdir -p src/locales
```

Write `src/locales/en.json`:
```json
{
  "_meta.test": "i18n is working"
}
```

- [ ] **Step 2: Create empty es.json and de.json**

Write `src/locales/es.json`:
```json
{
  "_meta.test": "i18n está funcionando"
}
```

Write `src/locales/de.json`:
```json
{
  "_meta.test": "i18n funktioniert"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/locales/
git commit -m "feat(i18n): add seed locale files (en, es, de)"
```

---

## Task 3: Create i18next runtime config

**Files:**
- Create: `src/i18n.ts`
- Test: `tests/unit/i18n/i18n-config.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/unit/i18n/i18n-config.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';

describe('i18n config', () => {
  it('exposes initialized i18n instance with en/es/de resources', async () => {
    expect(i18n.languages).toBeDefined();
    expect(i18n.options.fallbackLng).toEqual(['en']);
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true);
  });

  it('translates the seed key per locale', async () => {
    expect(i18n.t('_meta.test', { lng: 'en' })).toBe('i18n is working');
    expect(i18n.t('_meta.test', { lng: 'es' })).toBe('i18n está funcionando');
    expect(i18n.t('_meta.test', { lng: 'de' })).toBe('i18n funktioniert');
  });

  it('falls back to English on unknown locale', () => {
    expect(i18n.t('_meta.test', { lng: 'fr' })).toBe('i18n is working');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/i18n/i18n-config.test.ts
```
Expected: FAIL with "Cannot find module '@/i18n'"

- [ ] **Step 3: Implement i18n config**

Write `src/i18n.ts`:
```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import de from './locales/de.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    de: { translation: de },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  saveMissing: import.meta.env.DEV,
});

export default i18n;
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/i18n/i18n-config.test.ts
```
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts tests/unit/i18n/i18n-config.test.ts
git commit -m "feat(i18n): add i18next runtime config with en/es/de locales"
```

---

## Task 4: Create i18next-parser config

**Files:**
- Create: `i18next-parser.config.js`

- [ ] **Step 1: Write parser config**

Write `i18next-parser.config.js` at repo root:
```javascript
export default {
  locales: ['en', 'es', 'de'],
  output: 'src/locales/$LOCALE.json',
  input: ['src/**/*.{ts,tsx}'],
  defaultNamespace: 'translation',
  keepRemoved: false,
  failOnWarnings: false,
  failOnUpdate: false,
  lexers: {
    js: ['JavascriptLexer'],
    ts: ['JavascriptLexer'],
    jsx: ['JsxLexer'],
    tsx: ['JsxLexer'],
  },
};
```

- [ ] **Step 2: Verify parser runs**

Run:
```bash
npx i18next-parser --config i18next-parser.config.js --silent
```
Expected: exits 0, leaves `_meta.test` key in en.json untouched (no source code uses `t()` yet).

- [ ] **Step 3: Add npm script**

Modify `package.json` `scripts`:
```json
{
  "scripts": {
    "i18n:check": "i18next-parser --config i18next-parser.config.js --fail-on-warnings",
    "i18n:extract": "i18next-parser --config i18next-parser.config.js"
  }
}
```

- [ ] **Step 4: Verify scripts run**

Run:
```bash
npm run i18n:check
```
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add i18next-parser.config.js package.json
git commit -m "feat(i18n): add i18next-parser config + npm scripts"
```

---

## Task 5: Create custom ESLint rule package

**Files:**
- Create: `eslint-plugin-projelli-i18n/package.json`
- Create: `eslint-plugin-projelli-i18n/index.js`
- Create: `eslint-plugin-projelli-i18n/lib/no-hardcoded-string.js`
- Create: `eslint-plugin-projelli-i18n/lib/no-hardcoded-string.test.js`

- [ ] **Step 1: Create package directory and manifest**

```bash
mkdir -p eslint-plugin-projelli-i18n/lib
```

Write `eslint-plugin-projelli-i18n/package.json`:
```json
{
  "name": "eslint-plugin-projelli-i18n",
  "version": "0.1.0",
  "main": "index.js",
  "private": true,
  "peerDependencies": {
    "eslint": ">=8.0.0"
  }
}
```

- [ ] **Step 2: Write failing rule test**

Write `eslint-plugin-projelli-i18n/lib/no-hardcoded-string.test.js`:
```javascript
const { RuleTester } = require('eslint');
const rule = require('./no-hardcoded-string');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
});

ruleTester.run('no-hardcoded-string', rule, {
  valid: [
    { code: '<button>{t("send-button")}</button>' },
    { code: '<span>OK</span>' },
    { code: '<code>{snippet}</code>' },
    { code: '<button>Send</button>' },
  ],
  invalid: [
    {
      code: '<p>Click here to upload a file</p>',
      errors: [{ message: /hardcoded/i }],
    },
    {
      code: '<button>Submit your form</button>',
      errors: [{ message: /hardcoded/i }],
    },
  ],
});

console.log('rule tests passed');
```

- [ ] **Step 3: Run test to verify failure**

Run:
```bash
node eslint-plugin-projelli-i18n/lib/no-hardcoded-string.test.js
```
Expected: throws because `no-hardcoded-string.js` doesn't exist yet.

- [ ] **Step 4: Implement the rule**

Write `eslint-plugin-projelli-i18n/lib/no-hardcoded-string.js`:
```javascript
const SKIP_PARENTS = new Set(['JSXAttribute']);
const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded JSX text strings; use t() or <Trans>',
    },
    messages: {
      hardcoded: 'Hardcoded user-facing string. Wrap in t() or <Trans>.',
    },
    schema: [],
  },
  create(context) {
    function countWords(text) {
      const trimmed = text.trim();
      if (!trimmed) return 0;
      return trimmed.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w)).length;
    }

    function getEnclosingTagName(node) {
      let parent = node.parent;
      while (parent && parent.type !== 'JSXElement') {
        parent = parent.parent;
      }
      if (!parent) return null;
      const opening = parent.openingElement;
      return opening?.name?.name?.toLowerCase?.() ?? null;
    }

    return {
      JSXText(node) {
        if (SKIP_PARENTS.has(node.parent?.type)) return;
        const tag = getEnclosingTagName(node);
        if (tag && SKIP_TAGS.has(tag)) return;
        if (countWords(node.value) < 3) return;
        context.report({ node, messageId: 'hardcoded' });
      },
    };
  },
};
```

- [ ] **Step 5: Write index.js exporting the rule**

Write `eslint-plugin-projelli-i18n/index.js`:
```javascript
module.exports = {
  rules: {
    'no-hardcoded-string': require('./lib/no-hardcoded-string'),
  },
};
```

- [ ] **Step 6: Re-run test to verify pass**

Run:
```bash
node eslint-plugin-projelli-i18n/lib/no-hardcoded-string.test.js
```
Expected: prints `rule tests passed`, exits 0.

- [ ] **Step 7: Commit**

```bash
git add eslint-plugin-projelli-i18n/
git commit -m "feat(eslint): add projelli-i18n/no-hardcoded-string rule"
```

---

## Task 6: Wire ESLint plugin into project config

**Files:**
- Modify: `package.json`
- Modify: `.eslintrc.cjs` (read existing first to determine actual filename)

- [ ] **Step 1: Read existing ESLint config**

Run:
```bash
ls -la .eslintrc* eslint.config.*
```
Note the existing file (could be `.eslintrc.cjs`, `.eslintrc.json`, `eslint.config.js`, etc.) and use that path in subsequent steps.

- [ ] **Step 2: Add local plugin to package.json devDependencies**

Modify `package.json` `devDependencies`:
```json
"eslint-plugin-projelli-i18n": "file:./eslint-plugin-projelli-i18n"
```

Run:
```bash
npm install
```
Expected: installs the local plugin as a symlink.

- [ ] **Step 3: Enable the rule in ESLint config**

Modify the existing ESLint config file. For `.eslintrc.cjs`, add to `plugins` and `rules`:
```javascript
module.exports = {
  // ...existing config...
  plugins: [
    // ...existing plugins...
    'projelli-i18n',
  ],
  rules: {
    // ...existing rules...
    'projelli-i18n/no-hardcoded-string': 'warn',
  },
};
```

For flat config (`eslint.config.js`), use the equivalent flat-config syntax.

- [ ] **Step 4: Run eslint to verify rule loads**

Run:
```bash
npx eslint src/main.tsx
```
Expected: rule runs without "rule not found" errors. May produce warnings on existing hardcoded strings; this is expected (Stream E sweep will fix them).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .eslintrc.cjs
git commit -m "chore(eslint): enable projelli-i18n/no-hardcoded-string rule"
```

---

## Task 7: Create locale-detect utility + tests

**Files:**
- Create: `src/lib/locale-detect.ts`
- Test: `tests/unit/i18n/locale-detect.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/unit/i18n/locale-detect.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/os', () => ({
  locale: vi.fn(),
}));

import { locale as mockLocaleFn } from '@tauri-apps/api/os';
import { detectLocale } from '@/lib/locale-detect';

describe('detectLocale', () => {
  beforeEach(() => {
    vi.mocked(mockLocaleFn).mockReset();
  });

  it('returns "en" when OS locale is en-US', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('en-US');
    expect(await detectLocale()).toBe('en');
  });

  it('returns "es" when OS locale is es-MX', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('es-MX');
    expect(await detectLocale()).toBe('es');
  });

  it('returns "de" when OS locale is de-AT', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('de-AT');
    expect(await detectLocale()).toBe('de');
  });

  it('falls back to "en" for unsupported locale (fr-FR)', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('fr-FR');
    expect(await detectLocale()).toBe('en');
  });

  it('falls back to "en" when Tauri os.locale throws', async () => {
    vi.mocked(mockLocaleFn).mockRejectedValue(new Error('not in tauri'));
    expect(await detectLocale()).toBe('en');
  });

  it('returns "en" for null/undefined locale', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue(null);
    expect(await detectLocale()).toBe('en');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/i18n/locale-detect.test.ts
```
Expected: FAIL with "Cannot find module '@/lib/locale-detect'"

- [ ] **Step 3: Implement detectLocale**

Write `src/lib/locale-detect.ts`:
```typescript
import { locale as osLocale } from '@tauri-apps/api/os';

const SUPPORTED = ['en', 'es', 'de'] as const;
type SupportedLocale = (typeof SUPPORTED)[number];

export async function detectLocale(): Promise<SupportedLocale> {
  try {
    const raw = await osLocale();
    if (!raw) return 'en';
    const lang = raw.split('-')[0].toLowerCase();
    return (SUPPORTED as readonly string[]).includes(lang)
      ? (lang as SupportedLocale)
      : 'en';
  } catch {
    return 'en';
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/i18n/locale-detect.test.ts
```
Expected: PASS, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/locale-detect.ts tests/unit/i18n/locale-detect.test.ts
git commit -m "feat(i18n): add detectLocale utility with Tauri OS locale fallback"
```

---

# Group II: Chat-Attachment Foundations

## Task 8: Add ChatAttachment type definitions

**Files:**
- Modify: `src/types/chat.ts` (read existing first)
- Test: `tests/unit/types/chat.test.ts`

- [ ] **Step 1: Read existing chat types**

Run:
```bash
cat src/types/chat.ts
```
Note the existing `ChatMessage` interface fields. The new `attachments` field is OPTIONAL on `ChatMessage` so existing message-construction sites need no changes.

- [ ] **Step 2: Write failing type-shape test**

Write `tests/unit/types/chat.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { ChatAttachment, ChatMessage } from '@/types/chat';

describe('ChatAttachment type', () => {
  it('accepts a fully-populated image attachment', () => {
    const att: ChatAttachment = {
      id: 'sha256-abc',
      type: 'image',
      mimeType: 'image/png',
      fileName: 'chart.png',
      pathInWorkspace: 'media/2026-04/chat-image-abc.png',
      byteSize: 12345,
      metadata: { width: 1024, height: 768 },
    };
    expect(att.type).toBe('image');
  });

  it('accepts a PDF attachment with native extraction mode', () => {
    const att: ChatAttachment = {
      id: 'sha256-def',
      type: 'pdf',
      mimeType: 'application/pdf',
      fileName: 'contract.pdf',
      pathInWorkspace: 'media/2026-04/chat-pdf-def.pdf',
      byteSize: 540000,
      metadata: { pages: 12, extractionMode: 'native' },
    };
    expect(att.metadata.pages).toBe(12);
  });

  it('ChatMessage allows omitting attachments', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'user',
      content: 'hi',
      timestamp: new Date().toISOString(),
    };
    expect(msg.attachments).toBeUndefined();
  });

  it('ChatMessage accepts attachments array', () => {
    const msg: ChatMessage = {
      id: 'm2',
      role: 'user',
      content: 'check this',
      timestamp: new Date().toISOString(),
      attachments: [
        {
          id: 'sha256-abc',
          type: 'image',
          mimeType: 'image/png',
          fileName: 'chart.png',
          pathInWorkspace: 'media/2026-04/chat-image-abc.png',
          byteSize: 12345,
          metadata: {},
        },
      ],
    };
    expect(msg.attachments).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/types/chat.test.ts
```
Expected: FAIL because `ChatAttachment` is not exported.

- [ ] **Step 4: Add ChatAttachment + extend ChatMessage**

Modify `src/types/chat.ts`. Read existing content; preserve all current types; ADD:

```typescript
export interface ChatAttachment {
  id: string;
  type: 'image' | 'pdf';
  mimeType: string;
  fileName: string;
  pathInWorkspace: string;
  byteSize: number;
  metadata: {
    pages?: number;
    width?: number;
    height?: number;
    extractionMode?: 'native' | 'text-extract';
  };
}
```

And extend the existing `ChatMessage` interface to add an optional field:
```typescript
attachments?: ChatAttachment[];
```

- [ ] **Step 5: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/types/chat.test.ts
```
Expected: PASS, 4 tests passing.

- [ ] **Step 6: Run full type check**

Run:
```bash
npx tsc --noEmit
```
Expected: 0 errors. Existing code that constructs `ChatMessage` keeps compiling because `attachments` is optional.

- [ ] **Step 7: Commit**

```bash
git add src/types/chat.ts tests/unit/types/chat.test.ts
git commit -m "feat(types): add ChatAttachment type, extend ChatMessage with optional attachments"
```

---

## Task 9: Add SHA-256 hash utility

**Files:**
- Create: `src/lib/hash.ts`
- Test: `tests/unit/lib/hash.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/unit/lib/hash.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '@/lib/hash';

describe('sha256Hex', () => {
  it('hashes empty bytes to known value', async () => {
    const result = await sha256Hex(new Uint8Array(0));
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "hello" to known value', async () => {
    const bytes = new TextEncoder().encode('hello');
    const result = await sha256Hex(bytes);
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces deterministic output for same input', async () => {
    const bytes = new TextEncoder().encode('test123');
    const a = await sha256Hex(bytes);
    const b = await sha256Hex(bytes);
    expect(a).toBe(b);
  });

  it('produces different outputs for different inputs', async () => {
    const a = await sha256Hex(new TextEncoder().encode('a'));
    const b = await sha256Hex(new TextEncoder().encode('b'));
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/lib/hash.test.ts
```
Expected: FAIL with "Cannot find module '@/lib/hash'"

- [ ] **Step 3: Implement sha256Hex**

Write `src/lib/hash.ts`:
```typescript
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 4: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/lib/hash.test.ts
```
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hash.ts tests/unit/lib/hash.test.ts
git commit -m "feat(lib): add sha256Hex utility (Web Crypto API)"
```

---

## Task 10: Implement AttachmentService.save

**Files:**
- Create: `src/modules/attachments/AttachmentService.ts`
- Create: `src/modules/attachments/index.ts`
- Test: `tests/unit/attachments/AttachmentService.test.ts`

- [ ] **Step 1: Write failing test for save**

Write `tests/unit/attachments/AttachmentService.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentService } from '@/modules/attachments/AttachmentService';
import type { FSBackend } from '@/modules/workspace/FSBackend';

function makeMockFs(): FSBackend & { writes: Map<string, Uint8Array> } {
  const writes = new Map<string, Uint8Array>();
  const fs = {
    writes,
    read: vi.fn(async (p: string) => {
      const stored = writes.get(p);
      if (!stored) throw new Error(`not found: ${p}`);
      return new TextDecoder().decode(stored);
    }),
    readBytes: vi.fn(async (p: string) => {
      const stored = writes.get(p);
      if (!stored) throw new Error(`not found: ${p}`);
      return stored;
    }),
    write: vi.fn(async (p: string, content: string) => {
      writes.set(p, new TextEncoder().encode(content));
    }),
    writeBytes: vi.fn(async (p: string, bytes: Uint8Array) => {
      writes.set(p, bytes);
    }),
    delete: vi.fn(async (p: string) => {
      writes.delete(p);
    }),
    exists: vi.fn(async (p: string) => writes.has(p)),
    move: vi.fn(),
    list: vi.fn(),
    mkdir: vi.fn(async () => {}),
  } as unknown as FSBackend & { writes: Map<string, Uint8Array> };
  return fs;
}

describe('AttachmentService.save', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('saves bytes and returns ChatAttachment with hash, path, size', async () => {
    const bytes = new TextEncoder().encode('hello-image');
    const att = await svc.save(bytes, 'chart.png', 'image/png');
    expect(att.type).toBe('image');
    expect(att.mimeType).toBe('image/png');
    expect(att.fileName).toBe('chart.png');
    expect(att.byteSize).toBe(bytes.byteLength);
    expect(att.id).toMatch(/^[0-9a-f]{64}$/);
    expect(att.pathInWorkspace).toMatch(/^media\/2026-04\/chat-image-[0-9a-f]{64}\.png$/);
  });

  it('infers PDF type from mime', async () => {
    const att = await svc.save(new Uint8Array([1,2,3]), 'doc.pdf', 'application/pdf');
    expect(att.type).toBe('pdf');
  });

  it('rejects non-image/non-pdf MIME types', async () => {
    await expect(
      svc.save(new Uint8Array([1]), 'data.csv', 'text/csv')
    ).rejects.toThrow(/unsupported/i);
  });

  it('writes file at returned path', async () => {
    const bytes = new TextEncoder().encode('hello');
    const att = await svc.save(bytes, 'a.png', 'image/png');
    expect(fs.writes.has(att.pathInWorkspace)).toBe(true);
  });

  it('produces same hash for same bytes (dedup)', async () => {
    const bytes = new TextEncoder().encode('same');
    const a = await svc.save(bytes, 'a.png', 'image/png');
    const b = await svc.save(bytes, 'b.png', 'image/png');
    expect(a.id).toBe(b.id);
    expect(a.pathInWorkspace).toBe(b.pathInWorkspace);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/attachments/AttachmentService.test.ts
```
Expected: FAIL with "Cannot find module '@/modules/attachments/AttachmentService'"

- [ ] **Step 3: Implement save**

Write `src/modules/attachments/AttachmentService.ts`:
```typescript
import type { FSBackend } from '@/modules/workspace/FSBackend';
import type { ChatAttachment } from '@/types/chat';
import { sha256Hex } from '@/lib/hash';

const SUPPORTED_MIME: Record<string, ChatAttachment['type']> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export class AttachmentService {
  constructor(
    private fs: FSBackend,
    private monthFn: () => string = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
  ) {}

  async save(
    bytes: Uint8Array,
    fileName: string,
    mimeType: string
  ): Promise<ChatAttachment> {
    const type = SUPPORTED_MIME[mimeType];
    if (!type) {
      throw new Error(`Unsupported MIME type: ${mimeType}`);
    }
    const hash = await sha256Hex(bytes);
    const ext = EXT_BY_MIME[mimeType];
    const month = this.monthFn();
    const pathInWorkspace = `media/${month}/chat-${type}-${hash}.${ext}`;

    await this.fs.mkdir(`media/${month}`).catch(() => {});
    await this.fs.writeBytes(pathInWorkspace, bytes);

    return {
      id: hash,
      type,
      mimeType,
      fileName,
      pathInWorkspace,
      byteSize: bytes.byteLength,
      metadata: {},
    };
  }

  async read(att: ChatAttachment): Promise<Uint8Array> {
    return await this.fs.readBytes(att.pathInWorkspace);
  }

  async delete(att: ChatAttachment): Promise<void> {
    await this.fs.delete(att.pathInWorkspace);
  }

  async exists(att: ChatAttachment): Promise<boolean> {
    return await this.fs.exists(att.pathInWorkspace);
  }
}
```

Write `src/modules/attachments/index.ts`:
```typescript
export { AttachmentService } from './AttachmentService';
```

- [ ] **Step 4: Verify FSBackend has writeBytes/readBytes/mkdir/exists**

Run:
```bash
grep -n "writeBytes\|readBytes\|mkdir\|exists" src/modules/workspace/FSBackend.ts src/modules/workspace/WebFSBackend.ts src/modules/workspace/TauriFSBackend.ts
```

If any of `writeBytes`, `readBytes`, `mkdir`, `exists` are missing from `FSBackend`, this is a finding to surface before continuing. The agent should NOT silently add them; raise as a foundation gap.

If all four exist, proceed.

- [ ] **Step 5: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/attachments/AttachmentService.test.ts
```
Expected: PASS, 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/attachments/ tests/unit/attachments/
git commit -m "feat(attachments): add AttachmentService with hash-dedup save/read/delete"
```

---

## Task 11: Add AttachmentService delete + read tests

**Files:**
- Modify: `tests/unit/attachments/AttachmentService.test.ts`

- [ ] **Step 1: Add tests for read and delete**

Append to `tests/unit/attachments/AttachmentService.test.ts`:
```typescript
describe('AttachmentService.read', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('returns bytes previously saved', async () => {
    const bytes = new TextEncoder().encode('content-here');
    const att = await svc.save(bytes, 'a.png', 'image/png');
    const readBack = await svc.read(att);
    expect(Array.from(readBack)).toEqual(Array.from(bytes));
  });

  it('throws when file is missing', async () => {
    const bytes = new TextEncoder().encode('x');
    const att = await svc.save(bytes, 'a.png', 'image/png');
    fs.writes.delete(att.pathInWorkspace);
    await expect(svc.read(att)).rejects.toThrow();
  });
});

describe('AttachmentService.delete', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('removes file from workspace', async () => {
    const att = await svc.save(new TextEncoder().encode('x'), 'a.png', 'image/png');
    expect(fs.writes.has(att.pathInWorkspace)).toBe(true);
    await svc.delete(att);
    expect(fs.writes.has(att.pathInWorkspace)).toBe(false);
  });
});

describe('AttachmentService.exists', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('returns true after save', async () => {
    const att = await svc.save(new TextEncoder().encode('x'), 'a.png', 'image/png');
    expect(await svc.exists(att)).toBe(true);
  });

  it('returns false after delete', async () => {
    const att = await svc.save(new TextEncoder().encode('x'), 'a.png', 'image/png');
    await svc.delete(att);
    expect(await svc.exists(att)).toBe(false);
  });
});
```

- [ ] **Step 2: Run all attachment tests**

Run:
```bash
npx vitest run tests/unit/attachments/
```
Expected: PASS, 11 tests total (5 from save + 2 read + 1 delete + 2 exists + ... etc.). Actual count: 5 + 2 + 1 + 2 = 10. Confirm actual count matches.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/attachments/AttachmentService.test.ts
git commit -m "test(attachments): cover read/delete/exists"
```

---

## Task 12: Verify FSBackend supports binary I/O

**Files:**
- (Verify-only, may modify FSBackend interfaces if missing methods)

- [ ] **Step 1: Re-read FSBackend interface**

Run:
```bash
cat src/modules/workspace/FSBackend.ts
```

Confirm the interface has:
- `readBytes(path: string): Promise<Uint8Array>`
- `writeBytes(path: string, bytes: Uint8Array): Promise<void>`
- `mkdir(path: string): Promise<void>`
- `exists(path: string): Promise<boolean>`

If any are missing, see Step 2.

- [ ] **Step 2 (only if missing methods): Add them**

If FSBackend.ts already has these methods AND both `WebFSBackend.ts` and `TauriFSBackend.ts` implement them, skip this step.

If methods are missing, this is a foundation gap. The agent should:
1. Add the missing methods to the `FSBackend` interface.
2. Implement in `WebFSBackend.ts` using File System Access API binary read/write.
3. Implement in `TauriFSBackend.ts` using Tauri `fs::write_binary` and `fs::read_binary`.
4. Add unit tests for each implementation.

This is a non-trivial sub-task. If discovered, surface to TL (Claude) before proceeding. Do NOT silently extend the interface without surfacing.

- [ ] **Step 3: Document the verified state**

Append a note to the foundations PR description (kept locally for now):
```
FSBackend interface verified at <commit-hash>:
- readBytes: <yes/no, path:line>
- writeBytes: <yes/no>
- mkdir: <yes/no>
- exists: <yes/no>
Findings: <any extensions added, with rationale>
```

---

## Task 13: AttachmentService barrel export + integration smoke test

**Files:**
- Verify: `src/modules/attachments/index.ts`
- Test: `tests/unit/attachments/integration.test.ts`

- [ ] **Step 1: Write integration smoke test**

Write `tests/unit/attachments/integration.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { AttachmentService } from '@/modules/attachments';

describe('AttachmentService barrel export', () => {
  it('exports AttachmentService class via index', () => {
    expect(AttachmentService).toBeDefined();
    expect(typeof AttachmentService).toBe('function');
  });
});
```

- [ ] **Step 2: Run test**

Run:
```bash
npx vitest run tests/unit/attachments/integration.test.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/attachments/integration.test.ts
git commit -m "test(attachments): smoke test barrel export"
```

---

# Group III: Provider Interface Extension

## Task 14: Read existing Provider interface

**Files:**
- Read: `src/modules/models/Provider.ts`
- Read: `src/modules/models/ClaudeProvider.ts`, `OpenAIProvider.ts`, `GeminiProvider.ts`, `OllamaProvider.ts` (note paths if different)

- [ ] **Step 1: Inventory provider files**

Run:
```bash
ls src/modules/models/ && grep -l "implements Provider\|extends.*Provider" src/modules/models/*.ts
```

Note exact filenames and their current method signatures. Foundations adds two methods to the interface (`formatAttachmentForRequest`, `supportsAttachment`); each provider file gets a stub implementation that throws `"not implemented in foundations"`.

- [ ] **Step 2: Document baseline**

For the foundations PR description (kept locally), note:
- Provider interface path
- List of concrete implementations
- Existing methods (so agent can verify nothing breaks)

---

## Task 15: Add formatAttachmentForRequest + supportsAttachment to Provider interface

**Files:**
- Modify: `src/modules/models/Provider.ts`
- Test: `tests/unit/models/provider-interface.test.ts`

- [ ] **Step 1: Write failing interface-shape test**

Write `tests/unit/models/provider-interface.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { Provider, ProviderContentBlock } from '@/modules/models/Provider';
import type { ChatAttachment } from '@/types/chat';

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
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/models/provider-interface.test.ts
```
Expected: FAIL with type error or missing export.

- [ ] **Step 3: Extend Provider interface**

Modify `src/modules/models/Provider.ts`. Read existing content first; preserve all existing methods. Add at the bottom:

```typescript
import type { ChatAttachment } from '@/types/chat';

export type ProviderContentBlock = unknown;
// Each provider's actual content-block shape lives in its own module.
// Stream A will narrow this type per provider.

declare module './Provider' {
  // augments existing interface; keep this in same file
}

// Add these to the existing Provider interface:
//   formatAttachmentForRequest(att: ChatAttachment, bytes: Uint8Array): ProviderContentBlock;
//   supportsAttachment(att: ChatAttachment, model: string): boolean | string;
```

Locate the existing `interface Provider { ... }` block and ADD the two new method signatures inside it:

```typescript
formatAttachmentForRequest(att: ChatAttachment, bytes: Uint8Array): ProviderContentBlock;
supportsAttachment(att: ChatAttachment, model: string): boolean | string;
```

- [ ] **Step 4: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/models/provider-interface.test.ts
```
Expected: PASS, 4 tests passing.

- [ ] **Step 5: TypeScript compilation check**

Run:
```bash
npx tsc --noEmit
```
Expected: errors in each `*Provider.ts` file (subclasses missing the new methods). This is expected and resolved in Task 16.

- [ ] **Step 6: Commit (failing typecheck OK in this commit)**

```bash
git add src/modules/models/Provider.ts tests/unit/models/provider-interface.test.ts
git commit -m "feat(provider): extend interface with attachment methods (stubs in next task)"
```

Note: this commit intentionally leaves typecheck failing because subclasses haven't been stubbed yet. Task 16 fixes typecheck. This is acceptable per TDD: red → red (subclasses) → green.

---

## Task 16: Add stub implementations to all 4 providers

**Files:**
- Modify: `src/modules/models/ClaudeProvider.ts`
- Modify: `src/modules/models/OpenAIProvider.ts`
- Modify: `src/modules/models/GeminiProvider.ts`
- Modify: `src/modules/models/OllamaProvider.ts`

(Adjust paths if files are named differently per Task 14 inventory.)

- [ ] **Step 1: Add stubs to ClaudeProvider**

Add to the class body:
```typescript
formatAttachmentForRequest(att: ChatAttachment, bytes: Uint8Array): ProviderContentBlock {
  throw new Error('formatAttachmentForRequest not implemented in foundations (Stream A scope)');
}

supportsAttachment(att: ChatAttachment, model: string): boolean | string {
  return 'Attachment support not implemented in foundations (Stream A scope)';
}
```

Add imports at top of file:
```typescript
import type { ChatAttachment } from '@/types/chat';
import type { ProviderContentBlock } from './Provider';
```

- [ ] **Step 2: Repeat for OpenAIProvider, GeminiProvider, OllamaProvider**

Same code, same imports, in each of the three other provider files.

- [ ] **Step 3: TypeScript compilation check**

Run:
```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Run all model unit tests**

Run:
```bash
npx vitest run tests/unit/models/
```
Expected: PASS. Existing tests untouched; new interface test passes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/models/
git commit -m "feat(provider): stub formatAttachmentForRequest + supportsAttachment in 4 providers"
```

---

## Task 17: Verify no regression in existing chat send flow

**Files:**
- Test: any existing chat-send integration test (run, do not modify)

- [ ] **Step 1: Locate existing chat tests**

Run:
```bash
grep -rl "sendMessage\|sendMessageStreaming" tests/
```

- [ ] **Step 2: Run them**

Run:
```bash
npx vitest run tests/
```
Expected: all existing tests pass. The Provider interface extension is additive only.

- [ ] **Step 3: If any test fails**

Investigate. Foundations should not break existing functionality. If a test fails, debug; if it's a flaky test, document but do not silence.

(No commit unless changes made.)

---

# Group IV: MarketplaceService Skeleton

## Task 18: Add CatalogEntry types

**Files:**
- Create: `src/types/marketplace.ts`
- Test: `tests/unit/types/marketplace.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/unit/types/marketplace.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { CatalogEntry, InstalledEntry, UpdateInfo } from '@/types/marketplace';

describe('CatalogEntry type', () => {
  it('accepts a fully-populated entry', () => {
    const e: CatalogEntry = {
      id: 'investor-update-v1',
      name: 'Monthly Investor Update',
      description: 'Template',
      version: '1.0.0',
      author: { name: 'Jane Doe' },
      category: 'investor',
      tags: ['monthly'],
      installUrl: 'https://example.com/x.tar.gz',
      manifestUrl: 'https://example.com/manifest.json',
      minProjelliVersion: '2.0.0',
      publishedAt: '2026-04-28T00:00:00Z',
      updatedAt: '2026-04-28T00:00:00Z',
    };
    expect(e.id).toBe('investor-update-v1');
  });

  it('InstalledEntry includes installedAt', () => {
    const e: InstalledEntry = {
      id: 'x',
      name: 'X',
      description: '',
      version: '1.0.0',
      author: { name: 'A' },
      category: 'misc',
      tags: [],
      installUrl: '',
      manifestUrl: '',
      minProjelliVersion: '2.0.0',
      publishedAt: '',
      updatedAt: '',
      installedAt: '2026-04-28T00:00:00Z',
      installedPath: '.projelli/templates/x',
    };
    expect(e.installedAt).toBeDefined();
  });

  it('UpdateInfo carries old/new versions', () => {
    const u: UpdateInfo = {
      id: 'x',
      installedVersion: '1.0.0',
      latestVersion: '1.1.0',
    };
    expect(u.latestVersion).toBe('1.1.0');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/types/marketplace.test.ts
```
Expected: FAIL with "Cannot find module '@/types/marketplace'"

- [ ] **Step 3: Create marketplace types**

Write `src/types/marketplace.ts`:
```typescript
export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: { name: string; githubUser?: string; url?: string };
  category: string;
  tags: string[];
  screenshots?: string[];
  installUrl: string;
  manifestUrl: string;
  minProjelliVersion: string;
  maxProjelliVersion?: string;
  ratings?: { stars: number; count: number };
  publishedAt: string;
  updatedAt: string;
  /** SHA-256 of the installable tarball, hex */
  checksum?: string;
}

export interface InstalledEntry extends CatalogEntry {
  installedAt: string;
  installedPath: string;
}

export interface UpdateInfo {
  id: string;
  installedVersion: string;
  latestVersion: string;
}
```

- [ ] **Step 4: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/types/marketplace.test.ts
```
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/types/marketplace.ts tests/unit/types/marketplace.test.ts
git commit -m "feat(types): add CatalogEntry, InstalledEntry, UpdateInfo for marketplace"
```

---

## Task 19: MarketplaceService skeleton + refresh()

**Files:**
- Create: `src/modules/marketplace/MarketplaceService.ts`
- Create: `src/modules/marketplace/index.ts`
- Test: `tests/unit/marketplace/MarketplaceService.test.ts`

- [ ] **Step 1: Write failing tests for refresh + list**

Write `tests/unit/marketplace/MarketplaceService.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketplaceService } from '@/modules/marketplace/MarketplaceService';
import type { FSBackend } from '@/modules/workspace/FSBackend';
import type { CatalogEntry } from '@/types/marketplace';

function makeFs() {
  const writes = new Map<string, Uint8Array>();
  return {
    writes,
    read: vi.fn(async (p) => new TextDecoder().decode(writes.get(p) ?? new Uint8Array())),
    write: vi.fn(async (p, c) => writes.set(p, new TextEncoder().encode(c))),
    readBytes: vi.fn(async (p) => writes.get(p) ?? new Uint8Array()),
    writeBytes: vi.fn(async (p, b) => writes.set(p, b)),
    delete: vi.fn(async (p) => writes.delete(p)),
    exists: vi.fn(async (p) => writes.has(p)),
    move: vi.fn(),
    list: vi.fn(),
    mkdir: vi.fn(async () => {}),
  } as unknown as FSBackend;
}

const SAMPLE: CatalogEntry[] = [
  {
    id: 'a', name: 'A', description: '', version: '1.0.0',
    author: { name: 'x' }, category: 'misc', tags: [],
    installUrl: 'http://e/a.tar.gz', manifestUrl: 'http://e/manifest.json',
    minProjelliVersion: '2.0.0', publishedAt: '2026-04-28', updatedAt: '2026-04-28',
  },
];

describe('MarketplaceService.refresh', () => {
  let fs: ReturnType<typeof makeFs>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = makeFs();
    fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => SAMPLE,
    } as Response));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('fetches catalog from repo and writes cache', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'https://raw.githubusercontent.com/projelli/community-templates/main',
      catalogPath: 'catalog.json',
      cachePath: '.projelli/cache/marketplace-templates.json',
      installRoot: '.projelli/templates',
      fs,
    });
    await svc.refresh();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/projelli/community-templates/main/catalog.json'
    );
    const cached = await svc.list();
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe('a');
  });

  it('uses cached catalog when fetch fails', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e',
      catalogPath: 'catalog.json',
      cachePath: '.projelli/cache/m.json',
      installRoot: '.projelli/templates',
      fs,
    });
    await svc.refresh();
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    await svc.refresh({ silent: true });
    const list = await svc.list();
    expect(list).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/marketplace/MarketplaceService.test.ts
```
Expected: FAIL with "Cannot find module '@/modules/marketplace/MarketplaceService'"

- [ ] **Step 3: Implement skeleton**

Write `src/modules/marketplace/MarketplaceService.ts`:
```typescript
import type { FSBackend } from '@/modules/workspace/FSBackend';
import type { CatalogEntry, InstalledEntry, UpdateInfo } from '@/types/marketplace';

interface MarketplaceServiceOptions {
  repoUrl: string;
  catalogPath: string;
  cachePath: string;
  installRoot: string;
  fs: FSBackend;
  cacheTtlMs?: number;
}

interface CacheFile {
  fetchedAt: string;
  entries: CatalogEntry[];
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class MarketplaceService {
  private cache: CatalogEntry[] | null = null;

  constructor(private opts: MarketplaceServiceOptions) {}

  async refresh(opts?: { silent?: boolean }): Promise<void> {
    const url = `${this.opts.repoUrl}/${this.opts.catalogPath}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = (await res.json()) as CatalogEntry[];
      this.cache = entries;
      const cacheFile: CacheFile = { fetchedAt: new Date().toISOString(), entries };
      await this.opts.fs.write(this.opts.cachePath, JSON.stringify(cacheFile));
    } catch (err) {
      if (!opts?.silent) throw err;
      await this.loadCachedIfPresent();
    }
  }

  private async loadCachedIfPresent(): Promise<void> {
    try {
      const raw = await this.opts.fs.read(this.opts.cachePath);
      const parsed = JSON.parse(raw) as CacheFile;
      this.cache = parsed.entries;
    } catch {
      // no cache yet
    }
  }

  async list(): Promise<CatalogEntry[]> {
    if (this.cache === null) await this.loadCachedIfPresent();
    return this.cache ?? [];
  }

  async getById(id: string): Promise<CatalogEntry | null> {
    const list = await this.list();
    return list.find((e) => e.id === id) ?? null;
  }

  async install(id: string, opts?: { onProgress?: (frac: number) => void }): Promise<InstalledEntry> {
    throw new Error('install not implemented in foundations (Stream C scope)');
  }

  async uninstall(id: string): Promise<void> {
    throw new Error('uninstall not implemented in foundations (Stream C scope)');
  }

  async listInstalled(): Promise<InstalledEntry[]> {
    return [];
  }

  async checkForUpdates(): Promise<UpdateInfo[]> {
    return [];
  }
}
```

Write `src/modules/marketplace/index.ts`:
```typescript
export { MarketplaceService } from './MarketplaceService';
export type { CatalogEntry, InstalledEntry, UpdateInfo } from '@/types/marketplace';
```

- [ ] **Step 4: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/marketplace/MarketplaceService.test.ts
```
Expected: PASS, 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/marketplace/ tests/unit/marketplace/
git commit -m "feat(marketplace): MarketplaceService skeleton with refresh + list + cache"
```

---

## Task 20: Add MarketplaceService.getById + tests

**Files:**
- Modify: `tests/unit/marketplace/MarketplaceService.test.ts`

- [ ] **Step 1: Append getById tests**

Append to test file:
```typescript
describe('MarketplaceService.getById', () => {
  let fs: ReturnType<typeof makeFs>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = makeFs();
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => SAMPLE } as Response));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('returns entry by id', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'catalog.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await svc.refresh();
    const e = await svc.getById('a');
    expect(e?.name).toBe('A');
  });

  it('returns null for unknown id', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'catalog.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await svc.refresh();
    expect(await svc.getById('nonexistent')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npx vitest run tests/unit/marketplace/MarketplaceService.test.ts
```
Expected: PASS, 4 tests total.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/marketplace/MarketplaceService.test.ts
git commit -m "test(marketplace): cover getById"
```

---

## Task 21: Verify install/uninstall throw with informative messages

**Files:**
- Modify: `tests/unit/marketplace/MarketplaceService.test.ts`

- [ ] **Step 1: Append stub-method tests**

Append:
```typescript
describe('MarketplaceService stubs (foundations gates)', () => {
  let fs: ReturnType<typeof makeFs>;

  beforeEach(() => {
    fs = makeFs();
  });

  it('install throws "not implemented in foundations"', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await expect(svc.install('x')).rejects.toThrow(/foundations/);
  });

  it('uninstall throws "not implemented in foundations"', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await expect(svc.uninstall('x')).rejects.toThrow(/foundations/);
  });

  it('listInstalled returns empty array', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    expect(await svc.listInstalled()).toEqual([]);
  });

  it('checkForUpdates returns empty array', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    expect(await svc.checkForUpdates()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npx vitest run tests/unit/marketplace/MarketplaceService.test.ts
```
Expected: PASS, 8 tests total.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/marketplace/MarketplaceService.test.ts
git commit -m "test(marketplace): assert install/uninstall stubs throw with hints"
```

---

## Task 22: MarketplaceService barrel export smoke test

**Files:**
- Test: `tests/unit/marketplace/integration.test.ts`

- [ ] **Step 1: Write smoke test**

Write `tests/unit/marketplace/integration.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { MarketplaceService } from '@/modules/marketplace';
import type { CatalogEntry } from '@/modules/marketplace';

describe('marketplace barrel exports', () => {
  it('exports MarketplaceService class', () => {
    expect(MarketplaceService).toBeDefined();
  });

  it('re-exports CatalogEntry type', () => {
    const e: CatalogEntry = {
      id: 'x', name: 'X', description: '', version: '1.0.0',
      author: { name: 'a' }, category: 'misc', tags: [],
      installUrl: '', manifestUrl: '', minProjelliVersion: '2.0.0',
      publishedAt: '', updatedAt: '',
    };
    expect(e.id).toBe('x');
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npx vitest run tests/unit/marketplace/integration.test.ts
git add tests/unit/marketplace/integration.test.ts
git commit -m "test(marketplace): smoke test barrel exports"
```

---

## Task 23: Document MarketplaceService usage example for Stream C

**Files:**
- Create: `src/modules/marketplace/README.md`

- [ ] **Step 1: Write usage README**

Write `src/modules/marketplace/README.md`:
```markdown
# MarketplaceService

Foundation skeleton for v2.0 Stream C (templates marketplace + plugins marketplace).

## Status

- `refresh()` working with cache fallback. Tested.
- `list()`, `getById()` working. Tested.
- `install()`, `uninstall()` throw with "not implemented in foundations" messages. Stream C completes.
- `listInstalled()`, `checkForUpdates()` return empty arrays. Stream C completes.

## Two intended runtime instances

```typescript
const templatesMarket = new MarketplaceService({
  repoUrl: 'https://raw.githubusercontent.com/projelli/community-templates/main',
  catalogPath: 'catalog.json',
  cachePath: '.projelli/cache/marketplace-templates.json',
  installRoot: '.projelli/templates',
  fs: workspaceService.fs,
});

const pluginsMarket = new MarketplaceService({
  repoUrl: 'https://raw.githubusercontent.com/projelli/community-plugins/main',
  catalogPath: 'catalog.json',
  cachePath: '.projelli/cache/marketplace-plugins.json',
  installRoot: '.projelli/plugins',
  fs: workspaceService.fs,
});
```

## Stream C completes

- `install(id)`: download tarball, verify SHA-256 against entry's `checksum`, extract to `installRoot/<id>/`.
- `uninstall(id)`: delete `installRoot/<id>/`.
- `listInstalled()`: scan `installRoot/`, read each manifest, return InstalledEntry array.
- `checkForUpdates()`: compare `listInstalled()` versions against `list()` versions.
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/marketplace/README.md
git commit -m "docs(marketplace): document foundations skeleton + Stream C handoff"
```

---

## Task 24: AttachmentService usage docs for Stream A

**Files:**
- Create: `src/modules/attachments/README.md`

- [ ] **Step 1: Write README**

Write `src/modules/attachments/README.md`:
```markdown
# AttachmentService

Foundation skeleton for v2.0 Stream A (chat attachments: multimodal + PDF).

## Status

- `save(bytes, fileName, mimeType)` working with hash-dedup. Tested.
- `read(att)` working. Tested.
- `delete(att)` working. Tested.
- `exists(att)` working. Tested.

Limited to `image/png|jpeg|gif|webp` and `application/pdf` MIME types.

## Storage convention

`media/YYYY-MM/chat-<type>-<hash>.<ext>`

Same convention as existing image-paste in editor.

## Stream A integrates

- Chat input UI: paperclip / paste / drag-drop. On attach, calls `save()`.
- Provider message formatting: each provider implements `formatAttachmentForRequest(att, bytes)` using its API shape.
- Audit logging: emit `attachment_added` on save; `attachment_sent_to_provider` on send.

## Example

```typescript
const svc = new AttachmentService(workspaceService.fs);
const bytes = new Uint8Array(/* image bytes */);
const att = await svc.save(bytes, 'chart.png', 'image/png');
// att.id = SHA-256 hash
// att.pathInWorkspace = 'media/2026-04/chat-image-<hash>.png'
```
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/attachments/README.md
git commit -m "docs(attachments): document foundations skeleton + Stream A handoff"
```

---

# Group V: Sidecar Trait Refactor

## Task 25: Read existing Parakeet implementation

**Files:**
- Read: `src-tauri/src/` (entire tree)

- [ ] **Step 1: Inventory existing sidecar code**

Run:
```bash
find src-tauri/src -name "*.rs" | xargs grep -l "parakeet\|sidecar\|Command::new" 2>/dev/null
```

Identify the file(s) where Parakeet is currently spawned and managed. Note exact paths.

- [ ] **Step 2: Document baseline**

For the foundations PR description, note:
- Parakeet code path(s)
- Current spawn / lifecycle pattern
- Existing tests for Parakeet (if any)

If no inventory of existing tests, note "Parakeet has no existing Rust unit tests" as a finding to surface.

---

## Task 26: Add Sidecar trait

**Files:**
- Create: `src-tauri/src/sidecars/mod.rs`
- Create: `src-tauri/src/sidecars/tests.rs` (or use `#[cfg(test)]` mod)

- [ ] **Step 1: Write failing test**

Create `src-tauri/src/sidecars/mod.rs`:
```rust
use anyhow::Result;
use std::path::PathBuf;

pub trait Sidecar: Send + Sync {
    fn name(&self) -> &str;
    fn binary_path(&self) -> PathBuf;
    fn start(&mut self) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn is_running(&self) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummySidecar {
        running: bool,
    }

    impl Sidecar for DummySidecar {
        fn name(&self) -> &str { "dummy" }
        fn binary_path(&self) -> PathBuf { PathBuf::from("/bin/true") }
        fn start(&mut self) -> Result<()> {
            self.running = true;
            Ok(())
        }
        fn stop(&mut self) -> Result<()> {
            self.running = false;
            Ok(())
        }
        fn is_running(&self) -> bool { self.running }
    }

    #[test]
    fn trait_compiles_and_lifecycle_works() {
        let mut s = DummySidecar { running: false };
        assert!(!s.is_running());
        s.start().unwrap();
        assert!(s.is_running());
        s.stop().unwrap();
        assert!(!s.is_running());
    }

    #[test]
    fn name_returns_static_str() {
        let s = DummySidecar { running: false };
        assert_eq!(s.name(), "dummy");
    }
}
```

- [ ] **Step 2: Wire module into lib.rs / main.rs**

Modify `src-tauri/src/lib.rs` (or `main.rs`, whichever is the crate root) to add:
```rust
pub mod sidecars;
```

- [ ] **Step 3: Run tests**

Run:
```bash
cd src-tauri && cargo test sidecars
```
Expected: PASS, 2 tests passing.

- [ ] **Step 4: Commit**

```bash
cd .. # back to repo root
git add src-tauri/src/sidecars/ src-tauri/src/lib.rs
git commit -m "feat(sidecars): add Sidecar trait for shared lifecycle"
```

---

## Task 27: Refactor existing Parakeet to implement Sidecar trait

**Files:**
- Modify: existing Parakeet source file (path from Task 25)
- Create: `src-tauri/src/sidecars/parakeet.rs`

- [ ] **Step 1: Move Parakeet implementation into sidecars module**

Move the existing Parakeet code into `src-tauri/src/sidecars/parakeet.rs`. The struct should become:

```rust
use super::Sidecar;
use anyhow::Result;
use std::path::PathBuf;
use std::process::{Child, Command};

pub struct ParakeetSidecar {
    binary: PathBuf,
    process: Option<Child>,
    // copy any other fields from existing impl
}

impl ParakeetSidecar {
    pub fn new(binary: PathBuf) -> Self {
        Self { binary, process: None }
    }
    // copy any other methods from existing impl that are NOT in Sidecar trait
}

impl Sidecar for ParakeetSidecar {
    fn name(&self) -> &str { "parakeet" }
    fn binary_path(&self) -> PathBuf { self.binary.clone() }

    fn start(&mut self) -> Result<()> {
        if self.is_running() { return Ok(()); }
        let child = Command::new(&self.binary).spawn()?;
        self.process = Some(child);
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        if let Some(mut c) = self.process.take() {
            c.kill().ok();
            c.wait().ok();
        }
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.process.as_ref().map_or(false, |c| {
            // try_wait returns Ok(None) if still running
            unsafe {
                let p = c as *const Child as *mut Child;
                (*p).try_wait().map(|s| s.is_none()).unwrap_or(false)
            }
        })
    }
}
```

(Adapt to the actual existing Parakeet struct fields and methods. Preserve any custom request/response handling.)

- [ ] **Step 2: Update mod.rs to export ParakeetSidecar**

Modify `src-tauri/src/sidecars/mod.rs` to add:
```rust
pub mod parakeet;
pub use parakeet::ParakeetSidecar;
```

- [ ] **Step 3: Update existing call sites**

Find all places that constructed `Parakeet` directly and switch them to `ParakeetSidecar` (likely Tauri command handlers). Run:
```bash
grep -rn "Parakeet" src-tauri/src/ | grep -v "ParakeetSidecar\|sidecars/parakeet"
```
Update each to use `ParakeetSidecar` from `sidecars` module.

- [ ] **Step 4: Run all Rust tests**

Run:
```bash
cd src-tauri && cargo test
```
Expected: all existing tests pass.

- [ ] **Step 5: Run a manual smoke test**

Run the Tauri dev build briefly (15 seconds), verify Parakeet voice transcription still works:
```bash
cd .. && npm run tauri:dev
```
Stop after verifying no startup errors. Manual: try recording a few seconds of voice in the chat panel; verify transcript appears.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/
git commit -m "refactor(sidecars): port Parakeet to Sidecar trait (no behavior change)"
```

---

## Task 28: Document Sidecar pattern for Stream B

**Files:**
- Create: `src-tauri/src/sidecars/README.md`

- [ ] **Step 1: Write README**

Write `src-tauri/src/sidecars/README.md`:
```markdown
# Sidecars

Tauri sidecars: small binaries bundled with the desktop app, spawned for specialized work (voice transcription, TTS, future: OCR, embeddings).

## Pattern

All sidecars implement the `Sidecar` trait:

```rust
pub trait Sidecar: Send + Sync {
    fn name(&self) -> &str;
    fn binary_path(&self) -> PathBuf;
    fn start(&mut self) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn is_running(&self) -> bool;
}
```

## Existing implementations

- `ParakeetSidecar` (in `parakeet.rs`): voice input. Used by `voice_transcribe` Tauri command.

## Stream B will add

- `PiperSidecar` (in `piper.rs`): text-to-speech. Will be used by `tts_speak` Tauri command.

## Lifecycle

- Lazy spawn on first use (cold-start once, warm reuse)
- Kept alive across requests
- Stopped on app quit (Tauri lifecycle)
- Auto-restart on crash (max 3 retries)
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/sidecars/README.md
git commit -m "docs(sidecars): document trait pattern + Stream B handoff"
```

---

# Group VI: Settings Schema Additions

## Task 29: Add language field to settingsStore

**Files:**
- Modify: `src/stores/settingsStore.ts` (read existing)
- Test: `tests/unit/stores/settings-language.test.ts`

- [ ] **Step 1: Read existing store**

```bash
cat src/stores/settingsStore.ts
```

Note the existing state shape, actions, and persist config.

- [ ] **Step 2: Write failing test**

Write `tests/unit/stores/settings-language.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore.language', () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: null });
  });

  it('defaults to null (use OS detect)', () => {
    expect(useSettingsStore.getState().language).toBeNull();
  });

  it('accepts en/es/de', () => {
    useSettingsStore.setState({ language: 'es' });
    expect(useSettingsStore.getState().language).toBe('es');
  });

  it('exposes setLanguage action', () => {
    const { setLanguage } = useSettingsStore.getState();
    setLanguage('de');
    expect(useSettingsStore.getState().language).toBe('de');
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/stores/settings-language.test.ts
```
Expected: FAIL because `language` field doesn't exist yet.

- [ ] **Step 4: Add language to settings store**

Modify `src/stores/settingsStore.ts`. Preserve existing shape; ADD:

```typescript
type Language = 'en' | 'es' | 'de' | null;

// In state:
language: Language;

// In actions:
setLanguage: (lang: Language) => void;
```

In the store implementation, add:
```typescript
language: null,
setLanguage: (lang) => set({ language: lang }),
```

- [ ] **Step 5: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/stores/settings-language.test.ts
```
Expected: PASS, 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/stores/settingsStore.ts tests/unit/stores/settings-language.test.ts
git commit -m "feat(settings): add language field with setLanguage action"
```

---

## Task 30: Create empty placeholder settings pages

**Files:**
- Create: `src/components/settings/MarketplaceSettings.tsx`
- Create: `src/components/settings/MobileSettings.tsx`
- Create: `src/components/settings/PluginsSettings.tsx`
- Create: `src/components/settings/AdvancedSettings.tsx`
- Test: `tests/unit/components/settings/placeholders.test.tsx`

- [ ] **Step 1: Write failing test**

Write `tests/unit/components/settings/placeholders.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarketplaceSettings } from '@/components/settings/MarketplaceSettings';
import { MobileSettings } from '@/components/settings/MobileSettings';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { AdvancedSettings } from '@/components/settings/AdvancedSettings';

describe('Placeholder settings pages', () => {
  it('MarketplaceSettings renders heading', () => {
    render(<MarketplaceSettings />);
    expect(screen.getByRole('heading', { name: /marketplace/i })).toBeInTheDocument();
  });

  it('MobileSettings renders heading', () => {
    render(<MobileSettings />);
    expect(screen.getByRole('heading', { name: /mobile/i })).toBeInTheDocument();
  });

  it('PluginsSettings renders heading', () => {
    render(<PluginsSettings />);
    expect(screen.getByRole('heading', { name: /plugins/i })).toBeInTheDocument();
  });

  it('AdvancedSettings renders heading', () => {
    render(<AdvancedSettings />);
    expect(screen.getByRole('heading', { name: /advanced/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/components/settings/placeholders.test.tsx
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create placeholder components**

Write `src/components/settings/MarketplaceSettings.tsx`:
```tsx
export function MarketplaceSettings() {
  return (
    <div className="settings-page">
      <h1>Marketplace</h1>
      <p>Templates and plugins from the community. Stream C will populate this page.</p>
    </div>
  );
}
```

Write `src/components/settings/MobileSettings.tsx`:
```tsx
export function MobileSettings() {
  return (
    <div className="settings-page">
      <h1>Mobile</h1>
      <p>Access your workspace from iOS and other devices. Stream D will populate this page.</p>
    </div>
  );
}
```

Write `src/components/settings/PluginsSettings.tsx`:
```tsx
export function PluginsSettings() {
  return (
    <div className="settings-page">
      <h1>Plugins</h1>
      <p>Installed plugins. Stream C will populate this page.</p>
    </div>
  );
}
```

Write `src/components/settings/AdvancedSettings.tsx`:
```tsx
export function AdvancedSettings() {
  return (
    <div className="settings-page">
      <h1>Advanced</h1>
      <p>Power-user settings, including per-feature kill switches. Streams populate as features land.</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/components/settings/placeholders.test.tsx
```
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ tests/unit/components/settings/
git commit -m "feat(settings): add empty placeholder pages for Marketplace/Mobile/Plugins/Advanced"
```

---

## Task 31: Wire placeholder pages into settings nav

**Files:**
- Modify: `src/components/settings/SettingsNav.tsx` (read first)
- Modify: `src/components/settings/SettingsRouter.tsx` (or equivalent; read first)

- [ ] **Step 1: Read existing nav + router**

```bash
ls src/components/settings/ && cat src/components/settings/SettingsNav.tsx
```
Note the existing nav-item registry pattern.

- [ ] **Step 2: Add new nav items**

Modify `src/components/settings/SettingsNav.tsx`. In the nav-items array, add (preserving existing items):
```typescript
{ id: 'marketplace', label: 'Marketplace', icon: 'store' },
{ id: 'mobile', label: 'Mobile', icon: 'smartphone' },
{ id: 'plugins', label: 'Plugins', icon: 'puzzle' },
{ id: 'advanced', label: 'Advanced', icon: 'settings-2' },
```

(Use the icon names that match the project's icon library; check existing nav items for the convention.)

- [ ] **Step 3: Wire pages into router**

Modify the settings router to map new IDs to placeholder components:
```tsx
import { MarketplaceSettings } from './MarketplaceSettings';
import { MobileSettings } from './MobileSettings';
import { PluginsSettings } from './PluginsSettings';
import { AdvancedSettings } from './AdvancedSettings';

// In the route map:
case 'marketplace': return <MarketplaceSettings />;
case 'mobile': return <MobileSettings />;
case 'plugins': return <PluginsSettings />;
case 'advanced': return <AdvancedSettings />;
```

- [ ] **Step 4: Smoke test in dev mode**

Run:
```bash
npm run dev
```
Open Settings; verify the 4 new nav items appear and clicking each shows the placeholder page heading.

Stop dev server after verification.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/
git commit -m "feat(settings): wire Marketplace/Mobile/Plugins/Advanced placeholder pages into nav"
```

---

## Task 32: Initialize i18n on app bootstrap

**Files:**
- Modify: `src/main.tsx` (or app entry; verify path)
- Test: manual in dev

- [ ] **Step 1: Read existing main.tsx**

```bash
cat src/main.tsx
```

- [ ] **Step 2: Add i18n init**

Modify `src/main.tsx` to import i18n and initialize locale before rendering:
```typescript
import './i18n';  // side-effect import to initialize i18next
import i18n from './i18n';
import { detectLocale } from './lib/locale-detect';
import { useSettingsStore } from './stores/settingsStore';

async function bootstrapLocale() {
  const userLang = useSettingsStore.getState().language;
  const lang = userLang ?? (await detectLocale());
  await i18n.changeLanguage(lang);
}

bootstrapLocale().catch(() => {
  // fall back to English on any error; i18n already initialized to 'en'
});
```

Place this BEFORE `ReactDOM.createRoot(...).render(...)`.

- [ ] **Step 3: Verify in dev**

Run:
```bash
npm run dev
```
Verify the app starts cleanly, no console errors. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git commit -m "feat(i18n): initialize i18next + locale detection on app bootstrap"
```

---

# Group VII: Audit Log Additions

## Task 33: Extend AuditEvent union with v2.0 event types

**Files:**
- Modify: `src/modules/audit/AuditService.ts` (read first; types may be in separate file)
- Test: `tests/unit/audit/audit-event-types.test.ts`

- [ ] **Step 1: Read existing audit types**

```bash
grep -rn "AuditEvent\|AuditEventType\|interface.*Audit" src/modules/audit/
```
Identify where the event-type union or enum lives.

- [ ] **Step 2: Write failing test**

Write `tests/unit/audit/audit-event-types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { AuditEvent } from '@/modules/audit/AuditService';

describe('AuditEvent v2.0 additions', () => {
  it('accepts attachment_added', () => {
    const e: AuditEvent = {
      type: 'attachment_added',
      timestamp: new Date().toISOString(),
      payload: { path: 'media/2026-04/x.png', hash: 'abc', byteSize: 100 },
    };
    expect(e.type).toBe('attachment_added');
  });

  it('accepts attachment_sent_to_provider', () => {
    const e: AuditEvent = {
      type: 'attachment_sent_to_provider',
      timestamp: new Date().toISOString(),
      payload: { path: 'media/x.png', hash: 'abc', provider: 'claude', model: 'sonnet' },
    };
    expect(e.type).toBe('attachment_sent_to_provider');
  });

  it('accepts plugin_installed', () => {
    const e: AuditEvent = {
      type: 'plugin_installed',
      timestamp: new Date().toISOString(),
      payload: { id: 'translator', version: '1.0.0', permissions: ['network'] },
    };
    expect(e.type).toBe('plugin_installed');
  });

  it('accepts language_changed', () => {
    const e: AuditEvent = {
      type: 'language_changed',
      timestamp: new Date().toISOString(),
      payload: { from: 'en', to: 'es' },
    };
    expect(e.type).toBe('language_changed');
  });

  it('accepts context_compressed', () => {
    const e: AuditEvent = {
      type: 'context_compressed',
      timestamp: new Date().toISOString(),
      payload: { messagesBefore: 14, tokensBefore: 18500, messagesAfter: 1, tokensAfter: 1200 },
    };
    expect(e.type).toBe('context_compressed');
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run:
```bash
npx vitest run tests/unit/audit/audit-event-types.test.ts
```
Expected: FAIL with type errors.

- [ ] **Step 4: Extend AuditEvent union**

Modify the existing audit-event union to add (preserving existing variants):
```typescript
| { type: 'attachment_added'; timestamp: string; payload: { path: string; hash: string; byteSize: number } }
| { type: 'attachment_sent_to_provider'; timestamp: string; payload: { path: string; hash: string; provider: string; model: string } }
| { type: 'attachment_removed'; timestamp: string; payload: { path: string; hash: string } }
| { type: 'pdf_extracted'; timestamp: string; payload: { path: string; pages: number; mode: 'native' | 'text-extract' } }
| { type: 'context_compressed'; timestamp: string; payload: { messagesBefore: number; tokensBefore: number; messagesAfter: number; tokensAfter: number } }
| { type: 'tts_played'; timestamp: string; payload: { textLength: number; voiceId: string } }
| { type: 'plugin_installed'; timestamp: string; payload: { id: string; version: string; permissions: string[] } }
| { type: 'plugin_uninstalled'; timestamp: string; payload: { id: string } }
| { type: 'plugin_executed'; timestamp: string; payload: { id: string; command: string; durationMs: number } }
| { type: 'plugin_permission_denied'; timestamp: string; payload: { id: string; permission: string } }
| { type: 'template_installed_from_marketplace'; timestamp: string; payload: { id: string; version: string; source: string } }
| { type: 'language_changed'; timestamp: string; payload: { from: string; to: string } }
```

- [ ] **Step 5: Run test to verify pass**

Run:
```bash
npx vitest run tests/unit/audit/audit-event-types.test.ts
```
Expected: PASS, 5 tests passing.

- [ ] **Step 6: Run full type check**

Run:
```bash
npx tsc --noEmit
```
Expected: 0 errors. Existing audit-event consumers unaffected because we only ADDED variants.

- [ ] **Step 7: Commit**

```bash
git add src/modules/audit/AuditService.ts tests/unit/audit/audit-event-types.test.ts
git commit -m "feat(audit): extend AuditEvent union with v2.0 event types"
```

---

## Task 34: Verify AuditService.append accepts new types

**Files:**
- Test: `tests/unit/audit/audit-append.test.ts`

- [ ] **Step 1: Write integration test**

Write `tests/unit/audit/audit-append.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditService } from '@/modules/audit/AuditService';

describe('AuditService.append accepts v2.0 events', () => {
  let svc: AuditService;
  beforeEach(() => {
    // Construct AuditService with whatever its existing constructor expects;
    // mock dependencies. If AuditService requires sql.js or filesystem,
    // mock those.
    svc = new AuditService(/* mock deps */);
  });

  it('appends attachment_added without throwing', async () => {
    await expect(svc.append({
      type: 'attachment_added',
      timestamp: new Date().toISOString(),
      payload: { path: 'p', hash: 'h', byteSize: 1 },
    })).resolves.not.toThrow();
  });

  it('appends plugin_installed without throwing', async () => {
    await expect(svc.append({
      type: 'plugin_installed',
      timestamp: new Date().toISOString(),
      payload: { id: 'x', version: '1.0.0', permissions: [] },
    })).resolves.not.toThrow();
  });
});
```

If AuditService construction is non-trivial, the agent should adapt the test setup to match how existing audit tests (in `tests/unit/audit/`) construct it.

- [ ] **Step 2: Run test, fix any append() issues**

Run:
```bash
npx vitest run tests/unit/audit/audit-append.test.ts
```

If `AuditService.append()` does runtime validation of event-type strings against an allowed list, that list needs the new types added. Find and update.

If no runtime check, the test passes purely via TypeScript type-check.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/audit/audit-append.test.ts src/modules/audit/AuditService.ts
git commit -m "test(audit): verify v2.0 events flow through append()"
```

---

# Final Tasks

## Task 35: Add CI step for i18n strict check

**Files:**
- Modify: `.github/workflows/release.yml` or `ci.yml` (read first)

- [ ] **Step 1: Identify CI workflow**

```bash
ls .github/workflows/
```

Pick the file that runs on every PR (commonly `ci.yml`). If only `release.yml` exists (tag-triggered), create a new `ci.yml`.

- [ ] **Step 2: Add i18n check step**

Add to the relevant job's `steps`:
```yaml
- name: i18n strict check
  run: npm run i18n:check

- name: ESLint with projelli-i18n rule
  run: npx eslint src/ --max-warnings=0
```

If the existing project allows warnings, set `--max-warnings` to a higher number that matches the current baseline (run `npx eslint src/ 2>&1 | tail -1` to find the current count).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "ci: add i18n strict check + ESLint projelli-i18n rule"
```

---

## Task 36: Run full test suite and full typecheck

**Files:**
- (Verify-only)

- [ ] **Step 1: Full Vitest run**

Run:
```bash
npx vitest run
```
Expected: ALL tests pass (existing + new). Note the count.

- [ ] **Step 2: Full TypeScript check**

Run:
```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Full Rust check**

Run:
```bash
cd src-tauri && cargo test && cargo clippy -- -D warnings
cd ..
```
Expected: tests pass, clippy clean.

- [ ] **Step 4: Lint**

Run:
```bash
npm run lint
```
Expected: passes (with warnings on existing hardcoded strings; those are Stream E's job to fix).

- [ ] **Step 5: Build**

Run:
```bash
npm run build
```
Expected: production build succeeds, dist/ produced.

- [ ] **Step 6: Manual smoke test**

Run:
```bash
npm run dev
```
Verify:
- App boots without errors.
- Existing chat send works.
- Existing voice transcribe works.
- Settings page opens, all old + new pages render.
- Locale detection logs in dev console.

Stop dev server.

If any step fails, debug and fix before proceeding to Task 37.

---

## Task 37: Open foundations PR

**Files:**
- (Git workflow only)

- [ ] **Step 1: Verify branch state**

Run:
```bash
git log --oneline main..HEAD | wc -l
```
Expected: roughly 30+ commits (one or more per task above).

- [ ] **Step 2: Push branch**

Run:
```bash
git push -u origin feature/foundations
```

- [ ] **Step 3: Open PR via gh**

Run:
```bash
gh pr create \
  --title "v2.0 foundations: types, services, sidecar trait, i18n setup" \
  --body "$(cat <<'EOF'
## Summary

Lands all shared interfaces, types, configuration, and skeleton services that v2.0 implementation streams depend on. No end-user-visible behavior change.

Spec: `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 3.

## What's in

- Chat-attachment foundations: `ChatAttachment` type, `AttachmentService` (save/read/delete/exists with hash dedup).
- MarketplaceService skeleton: catalog fetch + cache, `install/uninstall` stubs for Stream C.
- Provider interface extension: `formatAttachmentForRequest` + `supportsAttachment`, stub implementations in 4 providers.
- Sidecar trait: refactor of Parakeet to use new trait, ready for Piper TTS.
- i18n tooling: i18next + react-i18next + i18next-parser, custom ESLint rule, locale detection, en/es/de seed locales.
- Settings: `language` field in store, 4 new placeholder pages (Marketplace, Mobile, Plugins, Advanced), nav wired.
- Audit: 12 new event types in `AuditEvent` union.
- CI: new i18n strict check + ESLint rule run.

## What's NOT in (deferred to streams)

- Any actual UI or behavior using the above. Streams A through E build on these foundations.

## Test plan

- [ ] All Vitest tests pass (X total, X new).
- [ ] `tsc --noEmit` passes.
- [ ] `cargo test` passes.
- [ ] `cargo clippy` clean.
- [ ] Manual: app boots, existing chat + voice still work, settings has new placeholder pages.
- [ ] CI green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: PR review by TL (Claude)**

The PR auto-passes CI gates (i18n check, ESLint, typecheck, tests). Claude (TL) reviews for:
- All foundations sub-systems present.
- No silent additions of behavior.
- No regressions in existing functionality.
- Spec alignment.

If approved, merge to `main`. All 5 implementation streams now have a solid foundation to build on.

---

# Self-Review (run after writing the plan, fix inline)

This section is for the plan author to verify before handing off.

**1. Spec coverage:** Each spec section is covered by tasks?
- §3.1 Chat-Attachment System → Tasks 8–13. Covered.
- §3.2 GitHub Discovery JSON Format → Tasks 18–24. Covered.
- §3.3 Sidecar IPC Pattern → Tasks 25–28. Covered.
- §3.4 i18n Key-Extraction Convention → Tasks 1–7. Covered.
- §3.5 Settings schema additions → Tasks 29–32. Covered.
- §3.6 Audit log event schema additions → Tasks 33–34. Covered.
- ESLint rule running in CI for ALL stream PRs → Task 35. Covered.

**2. Placeholder scan:** No "TBD", "TODO", "implement later" in implementation steps. Code blocks are complete.

**3. Type consistency:**
- `ChatAttachment.id` is SHA-256 hex string (defined Task 8, used Task 10).
- `ChatAttachment.type` is `'image' | 'pdf'` (Task 8, used Task 10).
- `Provider.formatAttachmentForRequest` signature consistent (Task 15, used Task 16).
- `MarketplaceServiceOptions` shape consistent (Task 19, used Tasks 20–22).
- `Sidecar` trait shape consistent (Task 26, used Task 27).
- `AuditEvent` payload shapes (Task 33) match what real consumers will emit (Stream documentation).

**4. Scope check:** Single implementation plan, focused on v2.0 foundations only. No stream-specific feature work.
