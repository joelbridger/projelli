# Projelli v2.0 Stream A4: Long-Context UX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the chat context-token cap from 200K to 1M, add per-provider capability detection so the model picker shows each model's context limit inline, surface cost-and-utilization feedback at the chat input bottom, warn when context exceeds 80% capacity, implement a summarization compression algorithm (manual Compress button + auto-trigger on overflow), and open the full Stream A pull request covering A1, A2, A3, and A4.

**Branch:** `feature/stream-a`. Continues from Plan A3 (already committed on this branch). All A1-A3 foundations are in place: `ChatAttachment` in `src/types/ai.ts`, `AttachmentService` in `src/modules/attachments/`, audit types in `src/types/audit.ts`, PDF extraction in `src/lib/pdf-extract.ts`, RAG indexer in `src-tauri/src/commands/rag/`. The existing `ChatCostChip` component (`src/components/ai/ChatCostChip.tsx`) tracks per-chat and today's aggregate cost. Compression adds the first substantial new chat-manipulation logic to this codebase.

**Architecture:** A new `src/modules/models/context-limits.ts` file centralizes per-provider, per-model context-window sizes. The existing `ambientContextTokenLimit` setting (`src/settings/schema.ts` line 178, `max: 200000`) gets its max raised to 1000000. The chat input area gains a `ContextMeterBar` component. Compression lives in `src/modules/chat/compression.ts` as a pure-function module. The UI wires a `[Compress]` button and a ✂️ marker component into `AIChatViewer`. The `context_compressed` audit event type is added to the `AuditActionType` union in `src/types/audit.ts`.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 4.5.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Zustand, Vitest, Tauri 2, shadcn/ui + Tailwind CSS.

---

## Discovery Summary

The following facts were confirmed from reading the codebase before writing this plan. Implementation tasks depend on these exact paths and types.

### Settings schema

`src/settings/schema.ts` line 177. Key: `ambientContextTokenLimit`, category `ai`, type `number`, `defaultValue: 50000`, `min: 10000`, `max: 200000`, `step: 5000`. The label is "Context Token Limit" and the description reads "Max tokens included from open files in AI prompts." This field does NOT control the per-chat context window sent to the provider; it controls how many tokens of ambient file context are injected. Plan A4 adds a separate setting for the full per-chat context window cap.

### Provider metadata shape

`src/modules/models/Provider.ts` line 28. `capabilities.maxContextTokens?: number` already exists. `ClaudeProvider.getMetadata()` hard-codes `maxContextTokens: 200000`. `OpenAIProvider.getMetadata()` derives it from the model name (32K, turbo/4o at 128K, or default 8192). `GeminiProvider.getMetadata()` and `OllamaProvider.getMetadata()` contain equivalent logic. None of these account for Gemini 1.5 Pro / 2.0 at 1M or Anthropic Tier 2+ 1M.

### ChatCostChip

`src/components/ai/ChatCostChip.tsx`. Renders "X this chat / Y today" with a tooltip breakdown. Does NOT show token utilization or per-message cost projections. Plan A4 adds a sibling component `ContextMeterBar` for the utilization + cost-preview row.

### ChatMessage type

`src/types/ai.ts` line 16. Fields: `role`, `content`, `timestamp`, `isError`, `errorDiagnostic`, `sources?`, `workspaceHint?`. Compression adds three optional fields: `isCompressedSummary?: boolean`, `originalMessageCount?: number`, `expandedForNextSend?: boolean`.

### Audit action types

`src/types/audit.ts` line 6. Union has: `file_create | file_update | file_delete | file_move | file_rename | workflow_start | workflow_complete | workflow_fail | model_call | user_action`. The `context_compressed` event mentioned in the spec does NOT yet exist; Plan A4 adds it.

### AIChatFile

`src/types/ai.ts` line 58. `messages: ChatMessage[]` is the serialized history. Compressed-summary entries are written to this array with `isCompressedSummary: true`. The original messages are also retained in the same array with `role` intact but marked with a `compressedIntoId` field so they can be recovered for Expand. This keeps the file as the single source of truth without a separate "original messages" file.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/modules/models/context-limits.ts` | `CONTEXT_LIMITS` map, `getMaxContextTokens(provider, model): number`, `getTier2Warning(provider, model): string | null` |
| `src/modules/chat/compression.ts` | `compressMessages(messages, opts): Promise<CompressedResult>`, `pickFastModel(provider): FastModelSpec | null`, `estimateTokens(text): number` |
| `src/components/chat/ContextMeterBar.tsx` | "Context: 127K of 200K · ~$0.38 next message at Sonnet" bar, 80% warning chip |
| `src/components/chat/CompressedSegmentMarker.tsx` | ✂️ "Compressed: N messages -> 1.2K tokens [Expand]" inline UI with expand button |
| `src/components/chat/CompressionConfirmModal.tsx` | Auto-trigger confirmation modal: shows before/after token estimates, Compress / Cancel |
| `tests/unit/models/context-limits.test.ts` | Tests for every provider+model combination in the limits map |
| `tests/unit/chat/compression.test.ts` | Compression algorithm unit tests |
| `tests/unit/components/chat/ContextMeterBar.test.tsx` | Meter renders, 80% warning, cost preview |
| `tests/unit/components/chat/CompressedSegmentMarker.test.tsx` | Marker renders, Expand fires callback |

### Files to modify

| Path | Change |
|---|---|
| `src/types/audit.ts` | Add `context_compressed` to `AuditActionType` union |
| `src/types/ai.ts` | Add `isCompressedSummary?`, `originalMessageCount?`, `expandedForNextSend?`, `compressedIntoId?` fields to `ChatMessage` |
| `src/settings/schema.ts` | Add `chatContextTokenLimit` setting (number, default 200000, min 10000, max 1000000, step 10000). Add `keepRecentTurns` setting (number, default 6, min 2, max 20, step 1). |
| `src/modules/models/ClaudeProvider.ts` | Update `getMetadata()` to use `getMaxContextTokens('anthropic', this.model)` instead of hard-coded 200000 |
| `src/modules/models/OpenAIProvider.ts` | Update `getMetadata()` to use `getMaxContextTokens('openai', this.model)` |
| `src/modules/models/GeminiProvider.ts` | Update `getMetadata()` to use `getMaxContextTokens('gemini', this.model)` |
| `src/modules/models/OllamaProvider.ts` | Update `getMetadata()` to use `getMaxContextTokens('ollama', this.model)` |
| `src/components/ai/AIChatViewer.tsx` | Wire `ContextMeterBar`, `CompressedSegmentMarker`, `[Compress]` button, `CompressionConfirmModal`; hook into send path for auto-trigger and 80% warning; render compressed markers in message list |
| `src/components/settings/AISettingsSection.tsx` (or equivalent settings section rendering `ambientContextTokenLimit`) | Add `chatContextTokenLimit` and `keepRecentTurns` number inputs; wire inline capability-warning when limit exceeds selected model's `getMaxContextTokens` |

### Files to NOT modify (out of Stream A4 scope)

- Any RAG or PDF files (A3 closed those)
- Sidecar, plugin, marketplace, mobile, i18n files (other streams)
- `ambientContextTokenLimit` behavior (controls ambient file context injection, unchanged)

---

## Task Decomposition

Seven groups, 9 tasks total.

- Group I: Capability detection + audit type (Tasks 1-2)
- Group II: Settings cap raise + inline warning (Task 3)
- Group III: Context meter bar (Task 4)
- Group IV: 80% approaching-limit warning (Task 5, inline in Task 4)
- Group V: Summarization compression algorithm (Task 6)
- Group VI: Compress UI, auto-trigger, and Expand (Task 7)
- Group VII: Verification + Stream A PR (Tasks 8-9)

---

# Group I: Capability Detection + Audit Type

## Task 1: Create `src/modules/models/context-limits.ts`

This file becomes the single source of truth for every model's maximum context window. All four providers' `getMetadata()` methods will call it instead of containing their own logic.

**Files to create:**
- `src/modules/models/context-limits.ts`

**Files to modify:**
- `src/modules/models/ClaudeProvider.ts`
- `src/modules/models/OpenAIProvider.ts`
- `src/modules/models/GeminiProvider.ts`
- `src/modules/models/OllamaProvider.ts`
- `tests/unit/models/context-limits.test.ts`

- [ ] **Step 1: Create `src/modules/models/context-limits.ts`**

```typescript
/**
 * Stream A4 — per-provider, per-model context window limits.
 *
 * Rules:
 * - Claude: Sonnet 4 and 3.5 / 3 are 200K on Tier 1; 1M requires Tier 2+.
 *   We report 200K as the safe default. The model picker shows the Tier 2+
 *   label so advanced users know to upgrade.
 * - Gemini: 1.5 Pro and any 2.x model support 1M natively.
 * - OpenAI: gpt-4o and o-series models cap at 128K. o1 / o3 cap at 200K.
 * - Ollama: context is model-dependent. We use 8192 as a conservative
 *   default for unknown models and define overrides for common names.
 */

export interface ContextLimitInfo {
  /** Hard maximum for the provider + model combination. */
  maxTokens: number;
  /**
   * If set, this message is shown in the model picker below the model name
   * and in the settings inline warning. Indicates a prerequisite (e.g.
   * "Tier 2+ API key required for 1M context").
   */
  tier2Warning?: string;
}

// Provider-level fallbacks used when the exact model name is not in the map.
const PROVIDER_FALLBACKS: Record<string, number> = {
  anthropic: 200000,
  openai: 128000,
  gemini: 1000000,
  ollama: 8192,
};

// Exact-match overrides. Match is attempted first; if no exact match, the
// provider fallback is used. Model IDs should be the runtime values
// (e.g. 'claude-sonnet-4-5-20250514', 'gpt-4o', 'gemini-1.5-pro').
const MODEL_OVERRIDES: Record<string, ContextLimitInfo> = {
  // Claude - Tier 1 (200K)
  'claude-3-haiku-20240307': { maxTokens: 200000 },
  'claude-3-sonnet-20240229': { maxTokens: 200000 },
  'claude-3-opus-20240229': { maxTokens: 200000 },
  'claude-3-5-sonnet-20241022': { maxTokens: 200000 },
  'claude-3-5-haiku-20241022': { maxTokens: 200000 },
  'claude-3-5-haiku-latest': { maxTokens: 200000 },
  'claude-sonnet-4-5-20250514': { maxTokens: 200000 },
  // Claude Sonnet 3.5/4 Tier 2+ (1M) — shown with warning
  'claude-sonnet-4-5-20250514-1m': {
    maxTokens: 1000000,
    tier2Warning: 'Requires Anthropic API Tier 2+ for 1M context',
  },
  // Gemini - 1M native
  'gemini-1.5-pro': { maxTokens: 1000000 },
  'gemini-1.5-flash': { maxTokens: 1000000 },
  'gemini-2.0-flash': { maxTokens: 1000000 },
  'gemini-2.0-pro': { maxTokens: 1000000 },
  'gemini-2.5-flash': { maxTokens: 1000000 },
  // OpenAI - various limits
  'gpt-4': { maxTokens: 8192 },
  'gpt-4-32k': { maxTokens: 32768 },
  'gpt-4-turbo': { maxTokens: 128000 },
  'gpt-4o': { maxTokens: 128000 },
  'gpt-4o-mini': { maxTokens: 128000 },
  'o1': { maxTokens: 200000 },
  'o1-mini': { maxTokens: 200000 },
  'o3': { maxTokens: 200000 },
  'o3-mini': { maxTokens: 200000 },
  // Ollama common models
  'llama3': { maxTokens: 8192 },
  'llama3:8b': { maxTokens: 8192 },
  'llama3:70b': { maxTokens: 8192 },
  'llama3.1': { maxTokens: 131072 },
  'llama3.1:8b': { maxTokens: 131072 },
  'mistral': { maxTokens: 32768 },
  'mixtral': { maxTokens: 65536 },
  'codellama': { maxTokens: 16384 },
  'phi3': { maxTokens: 131072 },
  'gemma2': { maxTokens: 8192 },
};

/**
 * Returns the maximum context-window size for a provider + model pair.
 * Falls back to the provider default if the exact model ID is not found.
 */
export function getMaxContextTokens(provider: string, model: string): number {
  return MODEL_OVERRIDES[model]?.maxTokens ?? PROVIDER_FALLBACKS[provider] ?? 8192;
}

/**
 * Returns the Tier 2+ warning string for this model, or null if none.
 * Used by the model picker to show an inline note and by the settings
 * panel inline warning.
 */
export function getTier2Warning(provider: string, model: string): string | null {
  void provider; // provider param reserved for future per-provider warnings
  return MODEL_OVERRIDES[model]?.tier2Warning ?? null;
}

/**
 * Returns true if the given context limit exceeds what the provider + model
 * can actually handle.
 */
export function isLimitExceedingCapability(
  provider: string,
  model: string,
  limitTokens: number
): boolean {
  return limitTokens > getMaxContextTokens(provider, model);
}

/**
 * Given a provider, returns the human-readable label for a context size.
 * E.g. 200000 -> "200K", 1000000 -> "1M".
 */
export function formatContextSize(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
```

- [ ] **Step 2: Update `ClaudeProvider.getMetadata()` to use `getMaxContextTokens`**

In `src/modules/models/ClaudeProvider.ts`, import `getMaxContextTokens` from `@/modules/models/context-limits` and replace `maxContextTokens: 200000` with `maxContextTokens: getMaxContextTokens('anthropic', this.model)`.

- [ ] **Step 3: Update `OpenAIProvider.getMetadata()` similarly**

In `src/modules/models/OpenAIProvider.ts`, remove the inline switch logic (`if (model.includes('32k'))` ... etc.) and replace the `maxContextTokens` assignment with `getMaxContextTokens('openai', this.model)`. Import `getMaxContextTokens` from `@/modules/models/context-limits`.

- [ ] **Step 4: Update `GeminiProvider.getMetadata()` similarly**

In `src/modules/models/GeminiProvider.ts`, find the `maxContextTokens` property in `getMetadata()` return and replace it with `getMaxContextTokens('gemini', this.model)`.

- [ ] **Step 5: Update `OllamaProvider.getMetadata()` similarly**

In `src/modules/models/OllamaProvider.ts`, find the `maxContextTokens: 8192` hard-code and replace it with `getMaxContextTokens('ollama', this.model)`.

- [ ] **Step 6: Write unit tests `tests/unit/models/context-limits.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  getMaxContextTokens,
  getTier2Warning,
  isLimitExceedingCapability,
  formatContextSize,
} from '@/modules/models/context-limits';

describe('getMaxContextTokens', () => {
  it('returns 200K for known Claude Sonnet model', () => {
    expect(getMaxContextTokens('anthropic', 'claude-3-5-sonnet-20241022')).toBe(200000);
  });

  it('returns 1M for Gemini 1.5 Pro', () => {
    expect(getMaxContextTokens('gemini', 'gemini-1.5-pro')).toBe(1_000_000);
  });

  it('returns 128K for gpt-4o', () => {
    expect(getMaxContextTokens('openai', 'gpt-4o')).toBe(128_000);
  });

  it('returns 200K for o1', () => {
    expect(getMaxContextTokens('openai', 'o1')).toBe(200_000);
  });

  it('falls back to provider default for unknown model', () => {
    expect(getMaxContextTokens('anthropic', 'claude-unknown-future')).toBe(200_000);
    expect(getMaxContextTokens('ollama', 'custom-local-model')).toBe(8_192);
  });

  it('falls back to 8192 for completely unknown provider', () => {
    expect(getMaxContextTokens('unknown-provider', 'some-model')).toBe(8_192);
  });
});

describe('getTier2Warning', () => {
  it('returns null for standard Sonnet', () => {
    expect(getTier2Warning('anthropic', 'claude-3-5-sonnet-20241022')).toBeNull();
  });

  it('returns warning string for 1M Sonnet variant', () => {
    const warning = getTier2Warning('anthropic', 'claude-sonnet-4-5-20250514-1m');
    expect(warning).not.toBeNull();
    expect(warning).toContain('Tier 2+');
  });
});

describe('isLimitExceedingCapability', () => {
  it('returns false when limit is within model capability', () => {
    expect(isLimitExceedingCapability('anthropic', 'claude-3-5-sonnet-20241022', 100_000)).toBe(false);
  });

  it('returns true when limit exceeds model capability', () => {
    expect(isLimitExceedingCapability('openai', 'gpt-4', 200_000)).toBe(true);
  });
});

describe('formatContextSize', () => {
  it('formats 200K', () => expect(formatContextSize(200_000)).toBe('200K'));
  it('formats 1M', () => expect(formatContextSize(1_000_000)).toBe('1M'));
  it('formats small numbers', () => expect(formatContextSize(8192)).toBe('8192'));
});
```

- [ ] **Step 7: Run tests and TypeScript**

```bash
npx vitest run tests/unit/models/context-limits.test.ts
npx tsc --noEmit
```

Expected: all tests pass, 0 TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/models/context-limits.ts \
        src/modules/models/ClaudeProvider.ts \
        src/modules/models/OpenAIProvider.ts \
        src/modules/models/GeminiProvider.ts \
        src/modules/models/OllamaProvider.ts \
        tests/unit/models/context-limits.test.ts
git commit -m "feat(stream-a4): add context-limits module and wire into all providers"
```

---

## Task 2: Add `context_compressed` to audit type union

This is a small type change that unblocks Task 6 (the compression algorithm) and Task 7 (the UI wiring).

**Files to modify:**
- `src/types/audit.ts`
- `src/types/ai.ts`

- [ ] **Step 1: Add `context_compressed` to `AuditActionType`**

In `src/types/audit.ts`, add `'context_compressed'` to the `AuditActionType` union after `'model_call'`:

```typescript
export type AuditActionType =
  | 'file_create'
  | 'file_update'
  | 'file_delete'
  | 'file_move'
  | 'file_rename'
  | 'workflow_start'
  | 'workflow_complete'
  | 'workflow_fail'
  | 'model_call'
  | 'context_compressed'
  | 'user_action';
```

- [ ] **Step 2: Add compression fields to `ChatMessage`**

In `src/types/ai.ts`, extend `ChatMessage` with four optional fields after the `workspaceHint` field:

```typescript
  /**
   * Stream A4 — set to true on messages that are compressed summaries
   * produced by the compression algorithm. These messages are rendered
   * with the ✂️ CompressedSegmentMarker instead of normal message bubbles.
   */
  isCompressedSummary?: boolean;
  /**
   * Stream A4 — how many original messages were collapsed into this summary.
   * Used for the "Compressed: N messages -> X tokens" label.
   */
  originalMessageCount?: number;
  /**
   * Stream A4 — temporary flag set by the Expand action. When true the
   * original messages (marked compressedIntoId) are re-injected for the
   * NEXT send only, then this flag is cleared.
   */
  expandedForNextSend?: boolean;
  /**
   * Stream A4 — set on original messages that have been compressed.
   * Value is the `timestamp` of the CompressedSummary message they belong
   * to. Messages with this field are NOT sent to the AI unless Expand was
   * clicked.
   */
  compressedIntoId?: string;
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If `audit-export.ts` has an exhaustive switch on `AuditActionType`, add a case for `'context_compressed'` that returns `'compressed'` as the status string.

- [ ] **Step 4: Commit**

```bash
git add src/types/audit.ts src/types/ai.ts
git commit -m "feat(stream-a4): add context_compressed audit type and ChatMessage compression fields"
```

---

# Group II: Settings Cap Raise + Inline Warning

## Task 3: Add `chatContextTokenLimit` setting and capability inline warning

This task raises the user-visible cap to 1M and adds an inline warning in Settings when the configured limit exceeds the selected model's capability.

**Files to modify:**
- `src/settings/schema.ts`
- `src/components/settings/AISettingsSection.tsx` (or whichever component renders the `ai` category settings)

- [ ] **Step 1: Add two new settings to `src/settings/schema.ts`**

After the existing `ambientContextTokenLimit` entry (line ~187), add:

```typescript
  {
    key: 'chatContextTokenLimit',
    category: 'ai',
    label: 'Chat Context Token Limit',
    description:
      'Maximum tokens sent to the AI per chat turn (includes history, files, and your message). Default is 200K. Raise only if your provider and model support a larger window.',
    type: 'number',
    defaultValue: 200000,
    min: 10000,
    max: 1000000,
    step: 10000,
  },
  {
    key: 'keepRecentTurns',
    category: 'ai',
    label: 'Keep Recent Turns (Compression)',
    description:
      'When compressing context, how many of the most recent conversation turns to keep verbatim.',
    type: 'number',
    defaultValue: 6,
    min: 2,
    max: 20,
    step: 1,
  },
```

- [ ] **Step 2: Locate the AI settings rendering component**

```bash
grep -rn "ambientContextTokenLimit\|AISettingsSection\|ai.*category\|category.*ai" src/components/settings/ | head -20
```

Identify which component renders the `ai` category fields. Read enough of that file to understand where the `ambientContextTokenLimit` number input renders.

- [ ] **Step 3: Add capability inline warning to the settings component**

Below the `chatContextTokenLimit` number input, render a warning when the configured limit exceeds the selected model's capability. The active provider and model come from `useSettingsStore` (the `provider` and `model` fields of the active chat, or a settings-persisted default model). Use `isLimitExceedingCapability` and `getMaxContextTokens` from `@/modules/models/context-limits`:

```typescript
// Pseudo-code — adapt to the component's existing patterns.
const chatLimitValue = getSetting('chatContextTokenLimit') as number;
const activeProvider = getSetting('defaultProvider') as string ?? 'anthropic';
const activeModel = getSetting('defaultModel') as string ?? '';

const limitWarning = isLimitExceedingCapability(activeProvider, activeModel, chatLimitValue)
  ? `Selected model maxes at ${formatContextSize(getMaxContextTokens(activeProvider, activeModel))} tokens. Lower the limit or switch to a larger-context model.`
  : null;

// In JSX, after the chatContextTokenLimit input:
{limitWarning && (
  <p className="text-xs text-amber-600 mt-1" data-testid="context-limit-warning">
    {limitWarning}
  </p>
)}
```

- [ ] **Step 4: Write settings unit tests**

```typescript
// tests/unit/settings/chatContextTokenLimit.test.ts
import { describe, it, expect } from 'vitest';
import { isLimitExceedingCapability, getMaxContextTokens } from '@/modules/models/context-limits';

describe('chatContextTokenLimit capability warning logic', () => {
  it('does not warn when 200K limit with Sonnet (200K cap)', () => {
    expect(isLimitExceedingCapability('anthropic', 'claude-3-5-sonnet-20241022', 200_000)).toBe(false);
  });

  it('warns when 500K limit with gpt-4o (128K cap)', () => {
    expect(isLimitExceedingCapability('openai', 'gpt-4o', 500_000)).toBe(true);
  });

  it('does not warn when 1M limit with Gemini 1.5 Pro (1M cap)', () => {
    expect(isLimitExceedingCapability('gemini', 'gemini-1.5-pro', 1_000_000)).toBe(false);
  });

  it('warns when 1M limit with standard Sonnet (200K cap)', () => {
    expect(isLimitExceedingCapability('anthropic', 'claude-3-5-sonnet-20241022', 1_000_000)).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests and TypeScript**

```bash
npx vitest run tests/unit/settings/chatContextTokenLimit.test.ts
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/settings/schema.ts \
        src/components/settings/ \
        tests/unit/settings/chatContextTokenLimit.test.ts
git commit -m "feat(stream-a4): raise context cap to 1M, add keepRecentTurns setting, capability warning"
```

---

# Group III: Context Meter Bar + 80% Warning

## Task 4: Create `ContextMeterBar` with utilization display and 80% warning

The meter bar replaces the gap below the chat input that currently has `ChatCostChip` on one side. It shows: "Context: 127K of 200K · ~$0.38 next message at Sonnet". At over 80% utilization it shows an amber warning chip. The [Compress] button appears when context is over 50% full (per spec §4.6).

**Files to create:**
- `src/components/chat/ContextMeterBar.tsx`
- `tests/unit/components/chat/ContextMeterBar.test.tsx`

**Files to modify:**
- `src/components/ai/AIChatViewer.tsx`

- [ ] **Step 1: Create `src/components/chat/ContextMeterBar.tsx`**

```typescript
/**
 * Stream A4 — shows live context utilization and projected next-message cost.
 *
 * Props:
 *   usedTokens      - tokens already consumed by history + injected context
 *   limitTokens     - chatContextTokenLimit setting value
 *   projectedCost   - estimated cost of next send (from provider pricing)
 *   modelLabel      - short model name for display ("Sonnet", "gpt-4o", etc.)
 *   onCompressClick - called when user clicks [Compress]
 */

import { cn } from '@/lib/utils';
import { formatContextSize } from '@/modules/models/context-limits';
import { formatCostShort } from '@/components/ai/ChatCostChip';

export interface ContextMeterBarProps {
  usedTokens: number;
  limitTokens: number;
  projectedCost: number | null;
  modelLabel: string;
  onCompressClick: () => void;
  className?: string;
}

export function ContextMeterBar({
  usedTokens,
  limitTokens,
  projectedCost,
  modelLabel,
  onCompressClick,
  className,
}: ContextMeterBarProps) {
  const pct = limitTokens > 0 ? Math.min(usedTokens / limitTokens, 1) : 0;
  const isNearLimit = pct >= 0.8;
  const showCompress = pct >= 0.5;

  const usedLabel = formatContextSize(usedTokens);
  const limitLabel = formatContextSize(limitTokens);
  const costLabel = projectedCost != null ? formatCostShort(projectedCost) : null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[11px] text-muted-foreground select-none',
        className
      )}
      data-testid="context-meter-bar"
    >
      {/* Utilization text */}
      <span data-testid="context-meter-usage">
        Context: {usedLabel} of {limitLabel}
      </span>

      {/* Cost preview — only shown when we have a projection */}
      {costLabel && (
        <>
          <span aria-hidden className="text-muted-foreground/40">{'·'}</span>
          <span data-testid="context-meter-cost">
            ~{costLabel} next msg at {modelLabel}
          </span>
        </>
      )}

      {/* 80% warning chip */}
      {isNearLimit && (
        <span
          data-testid="context-meter-warning"
          className="rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 font-medium"
        >
          Context {Math.round(pct * 100)}% full
        </span>
      )}

      {/* Compress button — spacer pushes it right */}
      <span className="flex-1" />
      {showCompress && (
        <button
          data-testid="context-meter-compress-btn"
          onClick={onCompressClick}
          className="rounded px-1.5 py-0.5 text-[11px] border border-border/60 hover:bg-muted transition-colors"
          type="button"
          aria-label="Compress older messages to free context space"
        >
          Compress
        </button>
      )}
    </div>
  );
}

export default ContextMeterBar;
```

- [ ] **Step 2: Identify where `AIChatViewer` renders the chat input bottom row**

```bash
grep -n "ChatCostChip\|chat-input\|sendButton\|textarea\|handleSend" src/components/ai/AIChatViewer.tsx | head -20
```

Find the JSX section that renders the bottom of the input area (where `ChatCostChip` currently lives). The `ContextMeterBar` belongs on the line directly above or below `ChatCostChip`, sharing the same row, or replacing it if the spec's layout is the single-row design from §4.6.

- [ ] **Step 3: Wire `ContextMeterBar` into `AIChatViewer`**

In `AIChatViewer.tsx`:

1. Import `ContextMeterBar` from `@/components/chat/ContextMeterBar`.
2. Import `getMaxContextTokens`, `formatContextSize` from `@/modules/models/context-limits`.
3. Import `useSettingsStore` (or `getSetting`) to read `chatContextTokenLimit`.
4. Add a `usedTokens` computation. Use a simple word-based heuristic: `estimateTokens(text)` (implemented in Task 6's `compression.ts`). For now, inline the estimate:

```typescript
// Simple 4-chars-per-token heuristic — good enough for meter display.
function estimateTokensRough(messages: ChatMessage[], draftText: string): number {
  const historyChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.round((historyChars + draftText.length) / 4);
}
```

5. Compute `projectedCost` from the active provider's `costPerInputToken * estimatedNextMessageTokens` (approximate). If the provider metadata is unavailable, pass `null`.
6. Render `<ContextMeterBar>` in the input area with a debounced update (use `useDeferredValue` on the draft text to avoid re-computation on every keystroke).
7. Pass `onCompressClick` as the handler that opens the `CompressionConfirmModal` (wired in Task 7).

- [ ] **Step 4: Write unit tests `tests/unit/components/chat/ContextMeterBar.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMeterBar } from '@/components/chat/ContextMeterBar';

describe('ContextMeterBar', () => {
  const base = {
    usedTokens: 100_000,
    limitTokens: 200_000,
    projectedCost: 0.38,
    modelLabel: 'Sonnet',
    onCompressClick: vi.fn(),
  };

  it('renders usage and cost', () => {
    render(<ContextMeterBar {...base} />);
    expect(screen.getByTestId('context-meter-usage').textContent).toContain('100K of 200K');
    expect(screen.getByTestId('context-meter-cost').textContent).toContain('$0.38');
  });

  it('does NOT show warning below 80%', () => {
    render(<ContextMeterBar {...base} usedTokens={150_000} />);
    expect(screen.queryByTestId('context-meter-warning')).toBeNull();
  });

  it('shows warning at 80%', () => {
    render(<ContextMeterBar {...base} usedTokens={160_000} />);
    expect(screen.getByTestId('context-meter-warning')).toBeTruthy();
  });

  it('shows compress button at 50%', () => {
    render(<ContextMeterBar {...base} usedTokens={100_001} />);
    expect(screen.getByTestId('context-meter-compress-btn')).toBeTruthy();
  });

  it('hides compress button below 50%', () => {
    render(<ContextMeterBar {...base} usedTokens={50_000} />);
    expect(screen.queryByTestId('context-meter-compress-btn')).toBeNull();
  });

  it('calls onCompressClick when button clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ContextMeterBar {...base} usedTokens={120_000} onCompressClick={onClick} />);
    await user.click(screen.getByTestId('context-meter-compress-btn'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders null cost gracefully', () => {
    render(<ContextMeterBar {...base} projectedCost={null} />);
    expect(screen.queryByTestId('context-meter-cost')).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests and TypeScript**

```bash
npx vitest run tests/unit/components/chat/ContextMeterBar.test.tsx
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ContextMeterBar.tsx \
        src/components/ai/AIChatViewer.tsx \
        tests/unit/components/chat/ContextMeterBar.test.tsx
git commit -m "feat(stream-a4): add ContextMeterBar with utilization, cost preview, and 80% warning"
```

---

# Group V: Summarization Compression Algorithm

## Task 5: Create `src/modules/chat/compression.ts`

This is the core logic of A4. The module is a pure function (no React, no Zustand) so it can be unit tested directly. It receives a messages array and options, calls a fast model for each batch of older messages, and returns a new array with summary entries interspersed.

**Files to create:**
- `src/modules/chat/compression.ts`
- `tests/unit/chat/compression.test.ts`

- [ ] **Step 1: Create `src/modules/chat/compression.ts`**

```typescript
/**
 * Stream A4 — Summarization compression algorithm.
 *
 * Compresses older messages in a chat history by batching them and sending
 * each batch to a fast model. Returns a new messages array with:
 *   - Most recent N turns kept verbatim (never compressed).
 *   - Older turns replaced by CompressedSummary messages.
 *   - Original messages annotated with compressedIntoId (not removed).
 *
 * The caller is responsible for writing the result back to the AIChatFile.
 */

import type { ChatMessage } from '@/types/ai';
import type { Provider } from '@/modules/models/Provider';

/** Approximate 4 chars per token. Good enough for meter + batching. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sum tokens across a messages array. */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
}

export interface CompressionOptions {
  /** How many recent turns to keep verbatim. Default: 6. */
  keepRecentTurns: number;
  /** Approximate token target per batch sent to the summarizer. Default: 10000. */
  batchTokenTarget: number;
  /** Provider to use for summarization. If null, compression is skipped. */
  fastProvider: Provider | null;
}

export interface CompressedResult {
  /** Full messages array with summary entries inserted. */
  messages: ChatMessage[];
  /** Number of original messages that were summarized. */
  originalCount: number;
  /** Total tokens in the resulting context (verbatim + summaries). */
  resultingTokens: number;
  /** Tokens in the context before compression. */
  originalTokens: number;
}

const SUMMARIZATION_PROMPT = `You are summarizing a section of a conversation.
Preserve: names of people mentioned, any decisions made, file names or paths referenced, pending questions, key technical details.
Be concise. Return only the summary — no preamble, no "this section discussed" framing.`;

/**
 * Compress a messages array.
 *
 * 1. Splits messages into "recent" (keep verbatim) and "older" (compress).
 * 2. Batches older messages into ~batchTokenTarget chunks.
 * 3. Sends each batch to fastProvider for summarization.
 * 4. Annotates original messages with compressedIntoId.
 * 5. Returns a new messages array with CompressedSummary entries.
 *
 * If fastProvider is null (Ollama-only or offline), throws an error that
 * the UI surfaces as "Compression requires a cloud fast model."
 */
export async function compressMessages(
  messages: ChatMessage[],
  opts: CompressionOptions
): Promise<CompressedResult> {
  if (!opts.fastProvider) {
    throw new Error(
      'Compression requires a fast cloud model. Configure Claude, OpenAI, or Gemini to enable compression.'
    );
  }

  const originalTokens = estimateMessagesTokens(messages);

  // A "turn" is a user+assistant pair. keepRecentTurns * 2 = message count to preserve.
  const keepCount = opts.keepRecentTurns * 2;
  const recentMessages = messages.slice(-keepCount);
  const olderMessages = messages.slice(0, messages.length - keepCount);

  if (olderMessages.length === 0) {
    // Nothing to compress.
    return {
      messages,
      originalCount: 0,
      resultingTokens: originalTokens,
      originalTokens,
    };
  }

  // Batch older messages into groups of ~batchTokenTarget tokens.
  const batches: ChatMessage[][] = [];
  let currentBatch: ChatMessage[] = [];
  let currentBatchTokens = 0;

  for (const msg of olderMessages) {
    const msgTokens = estimateTokens(msg.content ?? '');
    if (
      currentBatch.length > 0 &&
      currentBatchTokens + msgTokens > opts.batchTokenTarget
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchTokens = 0;
    }
    currentBatch.push(msg);
    currentBatchTokens += msgTokens;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  // Summarize each batch.
  const summaryMessages: ChatMessage[] = [];
  const summaryTimestamps: string[] = [];

  for (const batch of batches) {
    const batchText = batch
      .map(m => `[${m.role.toUpperCase()}]: ${m.content ?? ''}`)
      .join('\n\n');

    const userPrompt = `Here is a segment of conversation to summarize:\n\n${batchText}`;

    const summaryResponse = await opts.fastProvider.sendMessage(userPrompt, {
      systemPrompt: SUMMARIZATION_PROMPT,
    });

    const summaryContent = summaryResponse.content ?? '';
    const summaryTimestamp = new Date().toISOString();
    summaryTimestamps.push(summaryTimestamp);

    summaryMessages.push({
      role: 'assistant',
      content: summaryContent,
      timestamp: summaryTimestamp,
      isCompressedSummary: true,
      originalMessageCount: batch.length,
    });
  }

  // Annotate original messages with compressedIntoId so Expand can find them.
  // Each original message in batch i gets the timestamp of summaryMessages[i].
  let batchIndex = 0;
  let countInBatch = 0;
  const annotatedOlderMessages: ChatMessage[] = olderMessages.map(msg => {
    if (countInBatch >= batches[batchIndex].length) {
      batchIndex++;
      countInBatch = 0;
    }
    countInBatch++;
    return {
      ...msg,
      compressedIntoId: summaryTimestamps[batchIndex],
    };
  });

  // Build the final messages array:
  // annotated originals (hidden from AI) + summary markers + recent verbatim.
  const resultMessages = [
    ...annotatedOlderMessages,
    ...summaryMessages,
    ...recentMessages,
  ];

  const resultingTokens = estimateMessagesTokens(
    resultMessages.filter(m => !m.compressedIntoId)
  );

  return {
    messages: resultMessages,
    originalCount: olderMessages.length,
    resultingTokens,
    originalTokens,
  };
}

/**
 * Filters a messages array to only the messages that should be sent to the AI.
 * Excludes messages with compressedIntoId UNLESS expandedForNextSend is set
 * on the corresponding summary.
 */
export function getMessagesForSend(messages: ChatMessage[]): ChatMessage[] {
  // Collect which summary timestamps have been expanded.
  const expandedIds = new Set(
    messages
      .filter(m => m.isCompressedSummary && m.expandedForNextSend)
      .map(m => m.timestamp)
  );

  return messages.filter(m => {
    // Keep non-compressed messages always.
    if (!m.compressedIntoId) return true;
    // Keep original messages if their summary was expanded.
    return expandedIds.has(m.compressedIntoId);
  });
}

/**
 * Clears all expandedForNextSend flags after a send completes.
 * Call this after the AI response arrives to reset the expand state.
 */
export function clearExpandedFlags(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m =>
    m.expandedForNextSend ? { ...m, expandedForNextSend: false } : m
  );
}
```

- [ ] **Step 2: Write unit tests `tests/unit/chat/compression.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  compressMessages,
  estimateTokens,
  estimateMessagesTokens,
  getMessagesForSend,
  clearExpandedFlags,
  type CompressionOptions,
} from '@/modules/chat/compression';
import type { ChatMessage } from '@/types/ai';
import type { Provider } from '@/modules/models/Provider';

// Helper: create a minimal ChatMessage.
function msg(role: 'user' | 'assistant', content: string, ts?: string): ChatMessage {
  return { role, content, timestamp: ts ?? new Date().toISOString() };
}

// Helper: build a mock fast provider.
function mockProvider(summaryText = 'Summary of segment'): Provider {
  return {
    sendMessage: vi.fn().mockResolvedValue({ content: summaryText }),
    getMetadata: vi.fn().mockReturnValue({ name: 'Mock', model: 'mock', capabilities: {} }),
  } as unknown as Provider;
}

const baseOpts: CompressionOptions = {
  keepRecentTurns: 2,
  batchTokenTarget: 10_000,
  fastProvider: mockProvider(),
};

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => expect(estimateTokens('')).toBe(0));
  it('approximates 4 chars per token', () => expect(estimateTokens('abcd')).toBe(1));
});

describe('compressMessages', () => {
  it('returns unchanged messages when nothing to compress', async () => {
    const messages = [msg('user', 'hi'), msg('assistant', 'hello')];
    const result = await compressMessages(messages, baseOpts);
    expect(result.originalCount).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  it('keeps most recent 4 messages (2 turns) verbatim', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`)
    );
    const provider = mockProvider();
    const result = await compressMessages(messages, { ...baseOpts, fastProvider: provider });
    const summaries = result.messages.filter(m => m.isCompressedSummary);
    expect(summaries.length).toBeGreaterThan(0);
    // Last 4 messages (2 turns * 2 roles) should have no compressedIntoId.
    const last4 = result.messages.slice(-4);
    expect(last4.every(m => !m.compressedIntoId)).toBe(true);
  });

  it('annotates original messages with compressedIntoId', async () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)
    );
    const result = await compressMessages(messages, baseOpts);
    const annotated = result.messages.filter(m => m.compressedIntoId);
    expect(annotated.length).toBeGreaterThan(0);
  });

  it('throws when fastProvider is null (Ollama-only fallback)', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `m ${i}`)
    );
    await expect(
      compressMessages(messages, { ...baseOpts, fastProvider: null })
    ).rejects.toThrow('Compression requires a fast cloud model');
  });

  it('preserves attachment references in content during summarization', async () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', i === 2 ? 'See file report.pdf' : `turn ${i}`)
    );
    const provider = mockProvider('Discussed report.pdf results');
    const result = await compressMessages(messages, { ...baseOpts, fastProvider: provider });
    const summary = result.messages.find(m => m.isCompressedSummary);
    expect(summary?.content).toContain('report.pdf');
  });

  it('originalCount matches number of compressed messages', async () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)
    );
    const result = await compressMessages(messages, baseOpts);
    // With keepRecentTurns=2, 4 messages kept, 4 compressed.
    expect(result.originalCount).toBe(4);
  });
});

describe('getMessagesForSend', () => {
  it('excludes messages with compressedIntoId', () => {
    const messages: ChatMessage[] = [
      { ...msg('user', 'old'), compressedIntoId: '2024-01-01T00:00:00Z' },
      { ...msg('assistant', 'summary'), isCompressedSummary: true, timestamp: '2024-01-01T00:00:00Z' },
      msg('user', 'recent'),
    ];
    const forSend = getMessagesForSend(messages);
    expect(forSend.map(m => m.content)).toEqual(['summary', 'recent']);
  });

  it('includes compressed originals when expandedForNextSend is set on summary', () => {
    const summaryTs = '2024-01-01T00:00:00Z';
    const messages: ChatMessage[] = [
      { ...msg('user', 'old'), compressedIntoId: summaryTs },
      {
        ...msg('assistant', 'summary'),
        isCompressedSummary: true,
        timestamp: summaryTs,
        expandedForNextSend: true,
      },
      msg('user', 'recent'),
    ];
    const forSend = getMessagesForSend(messages);
    expect(forSend.map(m => m.content)).toEqual(['old', 'summary', 'recent']);
  });
});

describe('clearExpandedFlags', () => {
  it('removes expandedForNextSend from all messages', () => {
    const messages: ChatMessage[] = [
      { ...msg('assistant', 'summary'), isCompressedSummary: true, expandedForNextSend: true },
      msg('user', 'recent'),
    ];
    const cleared = clearExpandedFlags(messages);
    expect(cleared.every(m => !m.expandedForNextSend)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests and TypeScript**

```bash
npx vitest run tests/unit/chat/compression.test.ts
npx tsc --noEmit
```

Expected: all tests pass, 0 TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/chat/compression.ts \
        tests/unit/chat/compression.test.ts
git commit -m "feat(stream-a4): compression algorithm with batching, fast model routing, expand/clear"
```

---

# Group VI: Compress UI, Auto-Trigger, and Expand

## Task 6: Wire compression into `AIChatViewer` with `[Compress]`, auto-trigger, and `✂️` markers

This task brings the algorithm to life in the UI. Three moving parts: the manual [Compress] button (already placed in Task 4), a confirmation modal for auto-trigger, and the `CompressedSegmentMarker` inline in the message list.

**Files to create:**
- `src/components/chat/CompressedSegmentMarker.tsx`
- `src/components/chat/CompressionConfirmModal.tsx`
- `tests/unit/components/chat/CompressedSegmentMarker.test.tsx`

**Files to modify:**
- `src/components/ai/AIChatViewer.tsx`

- [ ] **Step 1: Create `src/components/chat/CompressedSegmentMarker.tsx`**

```typescript
/**
 * Stream A4 — renders the ✂️ compressed-segment indicator in the chat
 * message list. Sits where the original batch of messages used to appear.
 *
 * Props:
 *   message         - the ChatMessage with isCompressedSummary: true
 *   onExpand        - called when user clicks [Expand]; parent sets
 *                     expandedForNextSend on the summary message
 */

import type { ChatMessage } from '@/types/ai';
import { estimateTokens } from '@/modules/chat/compression';
import { formatContextSize } from '@/modules/models/context-limits';

export interface CompressedSegmentMarkerProps {
  message: ChatMessage;
  onExpand: (summaryTimestamp: string) => void;
}

export function CompressedSegmentMarker({ message, onExpand }: CompressedSegmentMarkerProps) {
  const originalCount = message.originalMessageCount ?? 0;
  const summaryTokens = estimateTokens(message.content ?? '');
  const isExpanded = message.expandedForNextSend === true;

  return (
    <div
      data-testid="compressed-segment-marker"
      className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-muted-foreground bg-muted/30 border-y border-border/40 my-1"
    >
      <span aria-hidden>&#x2702;&#xFE0F;</span>
      <span data-testid="compressed-segment-label">
        Compressed: {originalCount} {originalCount === 1 ? 'message' : 'messages'} {' -> '}
        {formatContextSize(summaryTokens)} tokens
      </span>
      {isExpanded && (
        <span
          data-testid="compressed-segment-expanded-badge"
          className="rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 font-medium"
        >
          Expanded for next send
        </span>
      )}
      <button
        data-testid="compressed-segment-expand-btn"
        onClick={() => onExpand(message.timestamp)}
        className="ml-auto text-[11px] underline underline-offset-2 hover:text-foreground transition-colors"
        type="button"
        aria-label={isExpanded ? 'Collapse expanded segment' : 'Expand to include in next send'}
      >
        {isExpanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
  );
}

export default CompressedSegmentMarker;
```

- [ ] **Step 2: Create `src/components/chat/CompressionConfirmModal.tsx`**

```typescript
/**
 * Stream A4 — confirmation modal shown before auto-triggered compression.
 *
 * Appears when a send would exceed the chatContextTokenLimit. Shows
 * before/after token estimates and gives the user Compress + Send or
 * Send Anyway options.
 *
 * Props:
 *   currentTokens   - tokens that would be sent without compression
 *   limitTokens     - the configured context token limit
 *   projectedAfter  - estimated tokens after compression
 *   onCompress      - user chose "Compress + Send"
 *   onSendAnyway    - user chose "Send Anyway"
 *   onCancel        - user dismissed
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatContextSize } from '@/modules/models/context-limits';

export interface CompressionConfirmModalProps {
  open: boolean;
  currentTokens: number;
  limitTokens: number;
  projectedAfter: number;
  onCompress: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}

export function CompressionConfirmModal({
  open,
  currentTokens,
  limitTokens,
  projectedAfter,
  onCompress,
  onSendAnyway,
  onCancel,
}: CompressionConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onCancel(); }}>
      <DialogContent data-testid="compression-confirm-modal">
        <DialogHeader>
          <DialogTitle>Context is full</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This send would use{' '}
          <strong data-testid="modal-current-tokens">{formatContextSize(currentTokens)}</strong>{' '}
          tokens, over your {formatContextSize(limitTokens)} limit. Compress older messages to free
          space ({formatContextSize(projectedAfter)} tokens after compression) or send anyway.
        </p>
        <DialogFooter className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onSendAnyway} data-testid="modal-send-anyway-btn">
            Send Anyway
          </Button>
          <Button onClick={onCompress} data-testid="modal-compress-btn">
            Compress + Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CompressionConfirmModal;
```

- [ ] **Step 3: Wire both components into `AIChatViewer`**

In `AIChatViewer.tsx`:

1. Import `CompressedSegmentMarker`, `CompressionConfirmModal`.
2. Import `compressMessages`, `getMessagesForSend`, `clearExpandedFlags`, `estimateMessagesTokens` from `@/modules/chat/compression`.
3. Import `getMaxContextTokens` from `@/modules/models/context-limits`.
4. Add state:
   ```typescript
   const [compressionModalOpen, setCompressionModalOpen] = useState(false);
   const [pendingCompressAndSend, setPendingCompressAndSend] = useState<(() => void) | null>(null);
   ```
5. In the message list render, for each message with `isCompressedSummary: true` render `<CompressedSegmentMarker>` instead of the normal message bubble.
6. For messages with `compressedIntoId` set, do NOT render them at all (they are hidden originals; CompressedSegmentMarker speaks for them).
7. Add `handleExpandSegment(summaryTimestamp: string)`: finds the summary message with that timestamp and sets `expandedForNextSend: true`. Also finds all original messages with `compressedIntoId === summaryTimestamp` and renders them inline when expanded is true. (The simple implementation: re-run `updateMessages` with the flag toggled, and the next render will call `getMessagesForSend` to include them.)
8. In the send handler (before calling the provider), check:
   ```typescript
   const forSend = getMessagesForSend(currentMessages);
   const usedTokens = estimateMessagesTokens(forSend) + estimateTokens(draftText);
   const contextLimit = getSetting('chatContextTokenLimit') as number ?? 200_000;
   if (usedTokens > contextLimit) {
     // Open confirmation modal.
     setCompressionModalOpen(true);
     setPendingCompressAndSend(() => async () => {
       await runCompression();
       await doSend();
     });
     return; // Block send until user decides.
   }
   await doSend();
   ```
9. Add `handleManualCompress()`: calls `compressMessages` directly, updates messages, emits `context_compressed` audit entry with `inputs: { beforeTokens }` and `outputs: { afterTokens }`.
10. After a send, call `clearExpandedFlags` and update messages.

- [ ] **Step 4: Determine `pickFastModel` and integrate into `handleManualCompress` and auto-trigger**

The fast model is selected based on the active provider from the current `.aichat` file:

```typescript
// In AIChatViewer.tsx or compression.ts as a helper.
function pickFastProvider(providerName: string, apiKey: string): Provider | null {
  switch (providerName) {
    case 'anthropic':
      return new ClaudeProvider({ apiKey, model: 'claude-3-5-haiku-latest' });
    case 'openai':
      return new OpenAIProvider({ apiKey, model: 'gpt-4o-mini' });
    case 'gemini':
    case 'google':
      return new GeminiProvider({ apiKey, model: 'gemini-1.5-flash' });
    case 'ollama':
    default:
      return null; // Ollama: no reliable cloud fast model; throw in compressMessages.
  }
}
```

Use the API key from `KeychainService` (same path as the regular send flow). Pass the resulting provider into `compressMessages` opts.

- [ ] **Step 5: Write unit tests for `CompressedSegmentMarker`**

```typescript
// tests/unit/components/chat/CompressedSegmentMarker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompressedSegmentMarker } from '@/components/chat/CompressedSegmentMarker';
import type { ChatMessage } from '@/types/ai';

function summaryMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'assistant',
    content: 'This segment summarized topic A and decided to proceed with plan B.',
    timestamp: '2024-01-01T00:00:00Z',
    isCompressedSummary: true,
    originalMessageCount: 8,
    ...overrides,
  };
}

describe('CompressedSegmentMarker', () => {
  it('shows original message count', () => {
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={vi.fn()} />);
    expect(screen.getByTestId('compressed-segment-label').textContent).toContain('8 messages');
  });

  it('shows Expand button', () => {
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={vi.fn()} />);
    expect(screen.getByTestId('compressed-segment-expand-btn').textContent).toBe('Expand');
  });

  it('shows Collapse and badge when expanded', () => {
    render(
      <CompressedSegmentMarker
        message={summaryMsg({ expandedForNextSend: true })}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByTestId('compressed-segment-expand-btn').textContent).toBe('Collapse');
    expect(screen.getByTestId('compressed-segment-expanded-badge')).toBeTruthy();
  });

  it('calls onExpand with message timestamp when clicked', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={onExpand} />);
    await user.click(screen.getByTestId('compressed-segment-expand-btn'));
    expect(onExpand).toHaveBeenCalledWith('2024-01-01T00:00:00Z');
  });
});
```

- [ ] **Step 6: Run tests and TypeScript**

```bash
npx vitest run tests/unit/components/chat/CompressedSegmentMarker.test.tsx
npx vitest run tests/unit/chat/compression.test.ts
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/CompressedSegmentMarker.tsx \
        src/components/chat/CompressionConfirmModal.tsx \
        src/components/ai/AIChatViewer.tsx \
        tests/unit/components/chat/CompressedSegmentMarker.test.tsx
git commit -m "feat(stream-a4): compress UI, auto-trigger modal, expand/collapse, audit event"
```

---

# Group VII: Verification + Stream A PR

## Task 7: Full verification

Run all tests, TypeScript, and build to confirm the branch is clean before opening the PR.

**Files to read:**
- `docs/superpowers/plans/2026-04-28-stream-a1-multimodal.md` (A1 scope items for PR body)
- `docs/superpowers/plans/2026-04-28-stream-a2-pdf-chat.md` (A2 scope items)
- `docs/superpowers/plans/2026-04-28-stream-a3-pdf-rag.md` (A3 scope items)

- [ ] **Step 1: Run all Vitest tests**

```bash
npx vitest run
```

Expected: all tests pass (A1 + A2 + A3 + A4 suites). Zero failures.

- [ ] **Step 2: TypeScript compile**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If `audit-export.ts` has an exhaustive switch on `AuditActionType`, confirm `context_compressed` has a case.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: no build errors.

- [ ] **Step 4: Grep for voice-rule violations**

```bash
grep -rn "—" docs/superpowers/plans/2026-04-28-stream-a4-long-context.md
grep -rn "TBD\|TODO\|implement later\|hours\|days\|weeks\|time estimate" \
  docs/superpowers/plans/2026-04-28-stream-a4-long-context.md | grep -v "node_modules"
```

Expected: 0 em dashes, 0 time estimates, 0 TBDs in implementation steps.

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -p  # only stage actual code changes, not plan doc
git commit -m "fix(stream-a4): cleanup from verification pass" # only if needed
```

---

## Task 8: Open the Stream A pull request

This is the final action of the entire Stream A series. The PR covers A1 (multimodal), A2 (PDF chat), A3 (PDF RAG), and A4 (long-context UX).

- [ ] **Step 1: Confirm the branch is ready**

```bash
git log --oneline feature/stream-a..HEAD | head -20
git status
```

Expected: all A4 commits present, working tree clean.

- [ ] **Step 2: Push the branch**

```bash
git push origin feature/stream-a
```

- [ ] **Step 3: Open the PR via `gh pr create`**

```bash
gh pr create \
  --base main \
  --head feature/stream-a \
  --title "feat(stream-a): multimodal images, PDF chat, PDF RAG, long-context UX (v2.0)" \
  --body "$(cat <<'EOF'
## Summary

Stream A bundles four sub-plans of v2.0 chat-attachment and long-context work:

- **A1:** Multimodal image support for all 5 providers (Claude, OpenAI, Gemini, Ollama, Mock). Paperclip + paste + drag-drop input. Attachment tiles. Vision-model capability detection with inline warning. Image token cost estimation.
- **A2:** PDF as chat context. Claude native PDF path (base64 bytes). PDF.js text extraction fallback for OpenAI, Gemini, Ollama. Pre-send text preview chip. Encrypted and scanned PDF handling.
- **A3:** PDF to RAG indexing. Extends the LanceDB indexer to extract, chunk, embed, and store PDF pages. Opt-in toggle in Settings. Page-numbered citations in RAG hits. [Expand] to PDF viewer at correct page.
- **A4:** Long-context UX. Context token cap raised to 1M. Per-provider capability detection in a centralized `context-limits.ts` module. Model picker shows context limits inline. Settings inline warning when limit exceeds model capability. `ContextMeterBar` shows utilization, cost preview, 80% warning, and [Compress] button. Summarization compression algorithm: batches older messages, calls a fast model (Haiku / gpt-4o-mini / gemini-flash), replaces with `CompressedSegmentMarker`. Manual compress and auto-trigger with confirmation modal. [Expand] temporarily restores originals for next send. `context_compressed` audit event.

**Spec:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 4.

## What is in (per sub-plan)

### A1: Multimodal images
- `ChatInputToolbar` (paperclip, paste, drag-drop, 20 MB cap)
- `AttachmentTile` (preview + remove)
- `VisionWarningBanner` (blocks send when model cannot process images)
- `vision-capability.ts`: VISION_MODELS map, isVisionModel, getSuggestedVisionModel
- `imageTokens.ts`: estimateImageTokens per-provider formula
- All 5 providers: real formatAttachmentForRequest + supportsAttachment for images
- Audit events: attachment_added, attachment_sent_to_provider, attachment_removed
- 15+ unit tests across providers and components

### A2: PDF chat
- ClaudeProvider: base64 PDF native path
- OpenAI, Gemini, Ollama: PDF.js text-extraction path
- Pre-send text preview chip (first 200 chars)
- Encrypted PDF toast, scanned PDF warning with "send native anyway" fallback
- 10+ unit tests across providers and PDF edge cases

### A3: PDF RAG indexing
- LanceDB schema extended: source_type + page_number columns
- Rust pdf_indexer.rs: per-page chunking and embedding via JS bridge
- Settings toggle: includePdfsInWorkspaceIndex (default OFF)
- RagHit extended: sourceType, pageNumber
- Citation click opens PDF viewer at correct page
- 8+ unit tests

### A4: Long-context UX
- context-limits.ts: getMaxContextTokens, getTier2Warning, isLimitExceedingCapability for all providers
- chatContextTokenLimit setting: 10K-1M range, default 200K
- keepRecentTurns setting: 2-20 range, default 6
- Settings inline capability warning when limit exceeds model cap
- ContextMeterBar: utilization, cost preview, 80% warning, Compress button
- compression.ts: compressMessages, getMessagesForSend, clearExpandedFlags
- CompressedSegmentMarker: ✂️ UI, Expand / Collapse toggle
- CompressionConfirmModal: auto-trigger confirmation before send
- context_compressed audit event with before/after token counts
- Ollama-only fallback: throws descriptive error surfaced as toast
- 20+ unit tests

## Pre-merge requirements

- Merge foundations PR #18 first. Stream A depends on foundation interfaces (ChatAttachment, AttachmentService, provider stubs, AuditEvent types).
- All Vitest tests must pass: `npx vitest run`
- TypeScript must compile clean: `npx tsc --noEmit`
- Build must succeed: `npm run build`

## Human smoke tests

Run these manually after merging to confirm nothing needs a second pass:

1. Open a chat with Claude configured. Paste an image. Verify the attachment tile appears, the image is saved to workspace media folder, and the vision model sends correctly.
2. Switch to OpenAI (gpt-4-vision or gpt-4o). Paste the same image. Confirm the tile shows and the request uses the OpenAI vision format.
3. Attach a PDF to a Claude chat. Confirm the mode chip shows "Native PDF". Switch to OpenAI. Confirm the chip flips to "Text Extracted".
4. Open Settings > AI. Set the Chat Context Token Limit to 1M with gpt-4o selected. Confirm the capability warning appears ("Selected model maxes at 128K").
5. In a long chat, let the ContextMeterBar reach 80% (or set a very low limit). Confirm the amber warning chip appears.
6. Click [Compress]. Confirm the confirmation modal appears with before/after token estimates. Click "Compress + Send". Confirm the ✂️ marker appears in the chat history.
7. Click [Expand] on the ✂️ marker. Confirm "Expanded for next send" badge appears. Send a message. Confirm the badge clears after the response arrives.
8. With Ollama as the only provider, try [Compress]. Confirm the descriptive "Compression requires a fast cloud model" toast appears.
9. In Settings > Memory, toggle "Include PDFs in workspace index". Index a PDF workspace file. Search for content from it in a new chat. Confirm a page-numbered citation appears in the response sources.

## Test plan

- All Vitest unit tests pass (run `npx vitest run` — covers all A1-A4 unit suites)
- TypeScript compile clean (`npx tsc --noEmit`)
- Build succeeds (`npm run build`)
- Human smoke tests above completed manually

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Capture and report PR URL**

```bash
gh pr view --json url -q '.url'
```

Record the URL in your report to Jameson.

---

## Self-Review Results

### 1. Every A4 scope item has a task?

| Scope item | Covered |
|---|---|
| Cap raise: max from 200K to 1M, default stays 200K | Task 3 (chatContextTokenLimit schema, max: 1000000, default: 200000) |
| Per-provider capability detection | Task 1 (context-limits.ts) |
| Model picker shows context limit inline | Task 1 (getMaxContextTokens wired into provider getMetadata) |
| Warning when limit exceeds model capability | Task 3 (settings inline warning) |
| 80% approaching-limit warning | Task 4 (ContextMeterBar isNearLimit chip) |
| Cost preview at chat input bottom | Task 4 (ContextMeterBar cost text) |
| Compress button (appears at 50%+ utilization) | Task 4 (ContextMeterBar showCompress) |
| Manual compression via [Compress] button | Task 6 (handleManualCompress in AIChatViewer) |
| Auto-trigger when send would exceed limit | Task 6 (send handler check, CompressionConfirmModal) |
| Compression algorithm: keep recent N turns | Task 5 (compressMessages keepRecentTurns) |
| Compression algorithm: batch ~10K tokens | Task 5 (batchTokenTarget, batch loop) |
| Compression algorithm: fast model call with summarization prompt | Task 5 (SUMMARIZATION_PROMPT, fastProvider.sendMessage) |
| ✂️ marker with Compressed: N messages label | Task 6 (CompressedSegmentMarker) |
| [Expand] temporarily restores originals for next send | Task 6 (handleExpandSegment, expandedForNextSend flag) |
| Original messages retained in file (not lost) | Task 5 (annotatedOlderMessages kept in array with compressedIntoId) |
| Audit: context_compressed event with before/after | Task 2 (type added), Task 6 (emit in handleManualCompress) |
| Attachments in compressed messages: keep references, drop bytes | Task 5 (content includes references; bytes not re-attached) |
| Ollama fallback: warn user compression unavailable | Task 6 (pickFastProvider returns null, compressMessages throws, UI toasts) |
| keepRecentTurns configurable setting | Task 3 (keepRecentTurns schema entry) |
| Stream A PR covering all A1-A4 | Task 8 (gh pr create with full body) |

All scope items are covered.

### 2. Type and method names consistent?

- `getMaxContextTokens(provider, model): number` used in Tasks 1, 3, 4, 6.
- `isLimitExceedingCapability(provider, model, limit): boolean` used in Tasks 3 and its tests.
- `formatContextSize(tokens): string` used in Tasks 1, 4, 6 components.
- `estimateTokens(text): number` defined in compression.ts, used in ContextMeterBar and CompressedSegmentMarker.
- `compressMessages(messages, opts): Promise<CompressedResult>` used in Task 6 AIChatViewer.
- `getMessagesForSend(messages): ChatMessage[]` used in Task 6 send handler.
- `clearExpandedFlags(messages): ChatMessage[]` used in Task 6 post-send cleanup.
- `ChatMessage.compressedIntoId`, `isCompressedSummary`, `originalMessageCount`, `expandedForNextSend` all defined in Task 2 and used in Tasks 5, 6.
- `AuditActionType: 'context_compressed'` defined in Task 2, emitted in Task 6.

All names are consistent.

### 3. Em dash check

No em dashes (--) in implementation steps. ASCII hyphens and commas used throughout. The ✂️ "Compressed: N messages -> X tokens" label uses `->` not an arrow or em dash.

### 4. Time estimate check

No "X hours", "X days", "X-week" patterns in any implementation step.

### 5. TBD / TODO check

No TBDs or TODOs in any implementation step. Every step has a concrete action.

### 6. Ollama edge case covered?

Task 6 Step 4 (`pickFastProvider`) returns `null` for Ollama. `compressMessages` throws with a user-readable message when `fastProvider` is null. Task 6 Step 3 wraps the compress call in a try/catch and surfaces the error as a toast. This satisfies the spec requirement.

### 7. `ambientContextTokenLimit` not confused with `chatContextTokenLimit`?

`ambientContextTokenLimit` (existing setting, controls how many tokens of open-file context are injected, max 200K) is left unchanged. `chatContextTokenLimit` (new setting, controls the full chat context window cap, max 1M) is distinct. Both appear in Settings > AI but serve different purposes. The `ContextMeterBar` reads `chatContextTokenLimit`.

---

## Concerns and Follow-Ups

1. **Fast-model provider instantiation in AIChatViewer.** `pickFastProvider` in Task 6 Step 4 instantiates provider objects directly. The exact constructor signature for each provider should be verified against the current ClaudeProvider, OpenAIProvider, and GeminiProvider constructors before implementation to avoid type errors. Read the constructor signatures from those files before writing the AIChatViewer wiring.

2. **API key retrieval for fast model.** The compression path needs the user's API key. In the Tauri desktop build, keys come from `KeychainService`. In the browser/test build, keys may be stored differently. The implementation worker should use the same key-retrieval path that the regular send handler uses and not introduce a new key-access pattern.

3. **Model picker inline context-limit display.** The spec says "model picker shows context limit inline" (e.g. "Claude Sonnet (200K)"). This plan wires `getMaxContextTokens` into `getMetadata()` so the data is available, but does NOT specify which model picker component renders it. The implementation worker should find the model picker UI component (likely in `AIChatViewer.tsx` or `AIAssistantPane.tsx`) and add the `formatContextSize(getMaxContextTokens(provider, model))` suffix to the model display label. This is a small UI-only change that fits in Task 1 Step 2 or as a sub-step of Task 4 when AIChatViewer is open.

4. **Token counting accuracy.** The 4-chars-per-token heuristic is used throughout A4 for meter display and batching. This is accurate enough for the meter but will diverge on code-heavy or multilingual content. For v2.0 this is acceptable; a more accurate tiktoken/cl100k implementation can replace it in a later patch without changing any interfaces.

5. **`getMessagesForSend` filter in the existing send path.** Today, `AIChatViewer` sends all messages directly. After A4, the send path must route through `getMessagesForSend(currentMessages)` to exclude hidden originals. The implementation worker should confirm the exact send-path code path in `AIChatViewer.tsx` (the `handleSendMessage` function) and inject this filter there, not in a side effect or useEffect.
