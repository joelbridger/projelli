/**
 * Q8 (Wave 1.6) — per-template model resolution priority.
 *
 * Verifies the precedence: settings-store override > template's own
 * `defaultProvider`/`defaultModel` > global user default.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTemplateModel,
  type TemplateModelOverride,
} from '@/features/workflows/engine/resolveTemplateModel';
import type { WorkflowTemplate } from '@/platform/types/workflow';

function templateFixture(
  partial: Partial<WorkflowTemplate> & { id: string }
): WorkflowTemplate {
  return {
    name: partial.name ?? 'Test template',
    description: partial.description ?? 'desc',
    version: partial.version ?? '1.0.0',
    category: partial.category ?? 'planning',
    steps: partial.steps ?? [],
    requiredInputs: partial.requiredInputs ?? [],
    outputs: partial.outputs ?? [],
    ...partial,
  };
}

const globalDefault: TemplateModelOverride = {
  provider: 'claude',
  model: 'claude-sonnet-4-6',
};

describe('resolveTemplateModel — Q8 priority rules', () => {
  it('falls back to global default when the template has no defaults and no override', () => {
    const template = templateFixture({ id: 'tpl-plain' });
    const out = resolveTemplateModel({
      template,
      overrides: {},
      globalDefault,
    });
    expect(out).toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      source: 'global',
    });
  });

  it('uses the template default when set, over the global default', () => {
    const template = templateFixture({
      id: 'tpl-with-default',
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
    });
    const out = resolveTemplateModel({
      template,
      overrides: {},
      globalDefault,
    });
    expect(out).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      source: 'template',
    });
  });

  it('uses the settings override when set, over both template and global defaults', () => {
    const template = templateFixture({
      id: 'tpl-has-both',
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
    });
    const overrides = {
      'tpl-has-both': { provider: 'gemini', model: 'gemini-1.5-pro' },
    } as Record<string, TemplateModelOverride>;
    const out = resolveTemplateModel({
      template,
      overrides,
      globalDefault,
    });
    expect(out).toEqual({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      source: 'override',
    });
  });

  it('ignores an override that targets a different template id', () => {
    const template = templateFixture({ id: 'tpl-other' });
    const overrides = {
      'tpl-elsewhere': { provider: 'gemini', model: 'gemini-1.5-pro' },
    } as Record<string, TemplateModelOverride>;
    const out = resolveTemplateModel({
      template,
      overrides,
      globalDefault,
    });
    expect(out.source).toBe('global');
    expect(out.provider).toBe('claude');
  });

  it('ignores overrides with empty model strings and falls through to template/global', () => {
    const template = templateFixture({
      id: 'tpl-empty-override',
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o-mini',
    });
    // Empty model should be treated as "no override".
    const overrides = {
      'tpl-empty-override': { provider: 'openai', model: '' },
    } as Record<string, TemplateModelOverride>;
    const out = resolveTemplateModel({
      template,
      overrides,
      globalDefault,
    });
    expect(out).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      source: 'template',
    });
  });

  it('requires both defaultProvider AND defaultModel on the template to count as a template default', () => {
    // defaultProvider set but model missing — should fall back to global.
    const template = templateFixture({
      id: 'tpl-partial',
      defaultProvider: 'gemini',
    });
    const out = resolveTemplateModel({
      template,
      overrides: {},
      globalDefault,
    });
    expect(out.source).toBe('global');
    expect(out.provider).toBe('claude');
  });

  it('accepts an undefined overrides map (treated as empty)', () => {
    const template = templateFixture({
      id: 'tpl-no-map',
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
    });
    const out = resolveTemplateModel({
      template,
      overrides: undefined,
      globalDefault,
    });
    expect(out.source).toBe('template');
    expect(out.provider).toBe('openai');
    expect(out.model).toBe('gpt-4o');
  });
});
