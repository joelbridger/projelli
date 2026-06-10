/**
 * F-106 / F-107 — Workflow provider resolution unit tests.
 *
 * Tests the REAL resolveWorkflowProvider function exported from
 * src/modules/workflow/resolveTemplateModel.ts.
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
 */

import { describe, it, expect } from 'vitest';
import {
  resolveWorkflowProvider,
  resolveTemplateModel,
  type WorkflowProviderResolution,
  type TemplateModelOverride,
} from '@/modules/workflow/resolveTemplateModel';
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
  });
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
