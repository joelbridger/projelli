/**
 * Unit tests for WorkflowEngine.availableTemplates() — the Stream C1 surface
 * that combines built-in templates with marketplace-installed templates
 * supplied by an injected `getCommunityTemplates` callback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WorkflowEngine,
  createWorkflowEngine,
  type InterviewHandler,
  type FileOperations,
} from '@/features/workflows/engine/WorkflowEngine';
import { createMockProvider } from '@/platform/providers/MockProvider';
import type { WorkflowTemplate } from '@/types/workflow';

function makeTemplate(id: string, overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id,
    name: id,
    description: '',
    version: '1.0.0',
    category: 'custom',
    steps: [],
    requiredInputs: [],
    outputs: [],
    ...overrides,
  };
}

const noopFileOps: FileOperations = {
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ''),
};

const noopInterview: InterviewHandler = vi.fn(async () => ({}));

describe('WorkflowEngine.availableTemplates', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns built-ins only when no community-template provider is supplied', async () => {
    const builtIns = [makeTemplate('built-a'), makeTemplate('built-b')];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      { builtInTemplates: builtIns }
    );

    const all = await engine.availableTemplates();

    expect(all.map((t) => t.id)).toEqual(['built-a', 'built-b']);
  });

  it('appends community templates after built-ins', async () => {
    const builtIns = [makeTemplate('built-a')];
    const community = [
      makeTemplate('community:investor', { provenance: 'community', sourceId: 'investor' }),
    ];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: builtIns,
        getCommunityTemplates: async () => community,
      }
    );

    const all = await engine.availableTemplates();

    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe('built-a');
    expect(all[1]?.id).toBe('community:investor');
    expect(all[1]?.provenance).toBe('community');
  });

  it('falls back to built-ins when getCommunityTemplates throws', async () => {
    const builtIns = [makeTemplate('built-a')];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: builtIns,
        getCommunityTemplates: async () => {
          throw new Error('disk read failure');
        },
      }
    );

    const all = await engine.availableTemplates();

    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('built-a');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back to built-ins when getCommunityTemplates returns a rejected promise', async () => {
    const builtIns = [makeTemplate('built-a')];
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: builtIns,
        getCommunityTemplates: () => Promise.reject(new Error('offline')),
      }
    );

    const all = await engine.availableTemplates();

    expect(all.map((t) => t.id)).toEqual(['built-a']);
  });

  it('returns an empty array when no built-ins and no community templates', async () => {
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
    );

    const all = await engine.availableTemplates();

    expect(all).toEqual([]);
  });

  it('createWorkflowEngine factory accepts options and wires getCommunityTemplates', async () => {
    const community = [makeTemplate('community:x', { provenance: 'community', sourceId: 'x' })];
    const engine = createWorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
      undefined,
      {
        builtInTemplates: [makeTemplate('built-a')],
        getCommunityTemplates: async () => community,
      }
    );

    const all = await engine.availableTemplates();

    expect(all.map((t) => t.id)).toEqual(['built-a', 'community:x']);
  });

  it('does not crash existing constructor calls that omit options', async () => {
    // Backward compatibility: existing tests + App.tsx call sites pass only
    // the original 4 args. The 5th arg defaults to {} and the engine acts as
    // before (built-ins empty, community resolver returns []).
    const engine = new WorkflowEngine(
      createMockProvider(),
      noopFileOps,
      noopInterview,
    );

    const all = await engine.availableTemplates();

    expect(all).toEqual([]);
  });
});
