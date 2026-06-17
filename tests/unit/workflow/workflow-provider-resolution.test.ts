/**
 * F-106 / F-107 — Workflow provider resolution unit tests.
 *
 * Tests the REAL resolveWorkflowProvider function exported from
 * src/features/workflows/engine/resolveTemplateModel.ts.
 *
 * These tests exercise the pure helper directly — no React tree, no mocks of
 * the function under test. The key invariant: reverting the ollama-first
 * ordering inside resolveWorkflowProvider MUST break the test that asserts
 * ollama-pinned + unreachable → 'ollama-unreachable' (never 'cloud').
 *
 * Coverage:
 *   1. no-key + non-testMode  → 'needs-provider'
 *   2. no-key + testMode      → 'mock'
 *   3. ollama-pinned + reachable → 'ollama'
 *   4. ollama-pinned + unreachable + cloud key present → 'ollama-unreachable'
 *      (NEVER 'cloud' — the egress invariant)
 *   5. cloud key present + no pin → 'cloud'
 *   6. settings override to ollama wins over cloud key
 *   7. explicit cloud pin wins over template default which wins over global
 *   8. F-502 — local-only mode resolves to the installed Ollama model and
 *      can NEVER yield 'cloud' or 'mock' (the mode-level egress invariant)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveWorkflowProvider,
  resolveTemplateModel,
  type ResolveWorkflowProviderInput,
  type WorkflowProviderResolution,
  type TemplateModelOverride,
} from '@/features/workflows/engine/resolveTemplateModel';
import type { TemplateProviderId, WorkflowTemplate } from '@/types/workflow';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTemplate(
  id: string,
  defaultProvider?: TemplateProviderId,
  defaultModel?: string,
): WorkflowTemplate {
  return {
    id,
    name: 'Test template',
    description: 'desc',
    version: '1.0.0',
    category: 'planning',
    steps: [],
    requiredInputs: [],
    outputs: [],
    ...(defaultProvider ? { defaultProvider } : {}),
    ...(defaultModel ? { defaultModel } : {}),
  };
}

interface HelperInput {
  template: WorkflowTemplate;
  overrides?: Record<string, TemplateModelOverride>;
  anthropicKey?: string;
  openaiKey?: string;
  googleKey?: string;
  ollamaReachable?: boolean;
  isTestMode?: boolean;
}

/**
 * End-to-end helper: calls resolveTemplateModel then resolveWorkflowProvider,
 * exactly mirroring what handleStartWorkflow does in App.tsx.
 */
function resolve(input: HelperInput): WorkflowProviderResolution {
  const {
    template,
    overrides = {},
    anthropicKey,
    openaiKey,
    googleKey,
    ollamaReachable = false,
    isTestMode = false,
  } = input;

  const globalProvider: TemplateProviderId = anthropicKey
    ? 'claude'
    : openaiKey
      ? 'openai'
      : googleKey
        ? 'gemini'
        : 'claude';

  const resolution = resolveTemplateModel({
    template,
    overrides,
    globalDefault: { provider: globalProvider, model: '' },
  });

  return resolveWorkflowProvider({
    pickedProvider: resolution.provider,
    pickedModel: resolution.model || undefined,
    anthropicKey,
    openaiKey,
    googleKey,
    ollamaReachable,
    isTestMode,
    // F-502 — the end-to-end cases above all model the default (cloud-capable)
    // confidentiality mode; local-only behavior is exercised via makeInput.
    localOnly: false,
    installedOllamaModels: [],
  });
}

/**
 * F-502 — direct input builder for resolveWorkflowProvider. The end-to-end
 * `resolve()` helper above routes through resolveTemplateModel first; these
 * defaults let the local-only cases pin the picked provider/model directly
 * and override only what each case is about.
 */
function makeInput(
  overrides: Partial<ResolveWorkflowProviderInput> = {},
): ResolveWorkflowProviderInput {
  return {
    pickedProvider: 'claude',
    pickedModel: undefined,
    anthropicKey: undefined,
    openaiKey: undefined,
    googleKey: undefined,
    ollamaReachable: false,
    isTestMode: false,
    localOnly: false,
    installedOllamaModels: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// F-106 — No-key resolution
// ---------------------------------------------------------------------------

describe('F-106 — no-key workflow provider resolution', () => {
  it('resolves to needs-provider when no keys and not testMode', () => {
    const result = resolve({ template: makeTemplate('t1'), isTestMode: false });
    expect(result.kind).toBe('needs-provider');
  });

  it('resolves to mock in testMode with no keys (E2E suites still work)', () => {
    const result = resolve({ template: makeTemplate('t1'), isTestMode: true });
    expect(result.kind).toBe('mock');
  });

  it('resolves to cloud/claude when an anthropic key is present, no pin', () => {
    const result = resolve({
      template: makeTemplate('t1'),
      anthropicKey: 'sk-ant-test',
      isTestMode: false,
    });
    expect(result.kind).toBe('cloud');
    if (result.kind === 'cloud') {
      expect(result.provider).toBe('claude');
    }
  });

  it('resolves to cloud/openai when only an openai key is present', () => {
    const result = resolve({
      template: makeTemplate('t1'),
      openaiKey: 'sk-oai-test',
      isTestMode: false,
    });
    expect(result.kind).toBe('cloud');
    if (result.kind === 'cloud') {
      expect(result.provider).toBe('openai');
    }
  });

  it('falls back to claude key when template is pinned to gemini but no gemini key', () => {
    const result = resolve({
      template: makeTemplate('t1', 'gemini', 'gemini-1.5-pro'),
      anthropicKey: 'sk-ant-test',
      isTestMode: false,
    });
    expect(result.kind).toBe('cloud');
    if (result.kind === 'cloud') {
      expect(result.provider).toBe('claude');
    }
  });
});

// ---------------------------------------------------------------------------
// F-107 — Ollama-pinned template resolution
// ---------------------------------------------------------------------------

describe('F-107 — Ollama-pinned template resolution', () => {
  it('resolves to ollama when template is pinned to ollama and reachable', () => {
    const result = resolve({
      template: makeTemplate('t-local', 'ollama', 'llama3.2:3b'),
      anthropicKey: 'sk-ant-test', // present but must NOT be used
      ollamaReachable: true,
      isTestMode: false,
    });
    expect(result.kind).toBe('ollama');
    if (result.kind === 'ollama') {
      expect(result.model).toBe('llama3.2:3b');
    }
  });

  it('resolves to ollama via settings override even with a cloud key present', () => {
    const overrides: Record<string, TemplateModelOverride> = {
      'tpl-x': { provider: 'ollama', model: 'llama3.2:3b' },
    };
    const result = resolve({
      template: makeTemplate('tpl-x'),
      anthropicKey: 'sk-ant-test',
      overrides,
      ollamaReachable: true,
      isTestMode: false,
    });
    expect(result.kind).toBe('ollama');
  });
});

// ---------------------------------------------------------------------------
// F-107 — Ollama reachability guard (the egress invariant)
// ---------------------------------------------------------------------------

describe('F-107 — Ollama reachability guard', () => {
  it('returns ollama-unreachable when Ollama is down', () => {
    const result = resolve({
      template: makeTemplate('t-local', 'ollama', 'llama3.2:3b'),
      anthropicKey: 'sk-ant-test',
      ollamaReachable: false,
      isTestMode: false,
    });
    expect(result.kind).toBe('ollama-unreachable');
  });

  it('NEVER falls back to cloud when Ollama is pinned but unreachable', () => {
    // This is the critical regression lock. If the ollama branch inside
    // resolveWorkflowProvider is removed or reordered so that the cloud
    // fallback runs for ollama-pinned templates, this test MUST fail.
    const result = resolve({
      template: makeTemplate('t-local', 'ollama', 'llama3.2:3b'),
      anthropicKey: 'sk-ant-test',
      openaiKey: 'sk-oai-test',
      googleKey: 'goog-test',
      ollamaReachable: false,
      isTestMode: false,
    });
    expect(result.kind).toBe('ollama-unreachable');
    expect(result.kind).not.toBe('cloud');
    expect(result.kind).not.toBe('mock');
  });

  it('returns ollama provider when Ollama is up', () => {
    const result = resolve({
      template: makeTemplate('t-local', 'ollama', 'llama3.2:3b'),
      anthropicKey: 'sk-ant-test',
      ollamaReachable: true,
      isTestMode: false,
    });
    expect(result.kind).toBe('ollama');
  });
});

// ---------------------------------------------------------------------------
// F-107 — Resolution precedence end-to-end
// ---------------------------------------------------------------------------

describe('F-107 — resolution precedence end-to-end', () => {
  it('explicit settings override wins over template default which wins over global', () => {
    const overrides: Record<string, TemplateModelOverride> = {
      'tpl-prio': { provider: 'openai', model: 'gpt-4o' },
    };
    const result = resolve({
      template: makeTemplate('tpl-prio', 'claude', 'claude-sonnet-4-6'),
      openaiKey: 'sk-oai-test',
      anthropicKey: 'sk-ant-test',
      overrides,
      isTestMode: false,
    });
    expect(result.kind).toBe('cloud');
    if (result.kind === 'cloud') {
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    }
  });

  it('cloud key present + no pin → cloud (unchanged behavior)', () => {
    const result = resolve({
      template: makeTemplate('t-cloud'),
      anthropicKey: 'sk-ant-test',
      isTestMode: false,
    });
    expect(result.kind).toBe('cloud');
    if (result.kind === 'cloud') {
      expect(result.provider).toBe('claude');
    }
  });

  it('no-key + testMode → mock, even when template is pinned to cloud provider', () => {
    const result = resolve({
      template: makeTemplate('t1', 'claude', 'claude-sonnet-4-6'),
      isTestMode: true,
    });
    // No keys, but testMode — should get mock, not needs-provider.
    expect(result.kind).toBe('mock');
  });

  it('no-key + !testMode → needs-provider even when template is pinned to cloud provider', () => {
    const result = resolve({
      template: makeTemplate('t1', 'claude', 'claude-sonnet-4-6'),
      isTestMode: false,
    });
    expect(result.kind).toBe('needs-provider');
  });
});

// ---------------------------------------------------------------------------
// F-502 — Local-only confidentiality mode (the mode-level egress invariant)
// ---------------------------------------------------------------------------

describe('F-502 — local-only mode', () => {
  it('resolves a cloud-pinned template to ollama in local-only mode (never cloud, even with keys)', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'claude', pickedModel: 'claude-sonnet-4-6',
      anthropicKey: 'sk-real', localOnly: true,
      ollamaReachable: true, installedOllamaModels: ['llama3.2:3b', 'qwen2.5:7b'],
    }));
    expect(r).toEqual({ kind: 'ollama', model: 'llama3.2:3b' });
  });

  it('keeps an explicit ollama pin in local-only mode', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'ollama', pickedModel: 'qwen2.5:7b',
      localOnly: true, ollamaReachable: true,
      installedOllamaModels: ['llama3.2:3b', 'qwen2.5:7b'],
    }));
    expect(r).toEqual({ kind: 'ollama', model: 'qwen2.5:7b' });
  });

  it('local-only + ollama unreachable is ollama-unreachable, never needs-provider/cloud/mock', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'claude', anthropicKey: 'sk-real',
      localOnly: true, ollamaReachable: false, isTestMode: true,
    }));
    expect(r).toEqual({ kind: 'ollama-unreachable' });
  });

  it('local-only with no installed models still resolves to ollama with model undefined (constructor default applies)', () => {
    const r = resolveWorkflowProvider(makeInput({
      pickedProvider: 'claude', localOnly: true,
      ollamaReachable: true, installedOllamaModels: [],
    }));
    expect(r).toEqual({ kind: 'ollama', model: undefined });
  });
});
