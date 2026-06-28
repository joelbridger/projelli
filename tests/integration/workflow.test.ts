/**
 * Integration Tests for Workflow Engine
 *
 * Tests the complete workflow execution cycle including:
 * - Interview step handling
 * - Document generation
 * - File operations
 * - Run record creation
 * - Progress callbacks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine, type InterviewHandler, type FileOperations, type ProgressHandler } from '@/features/workflows/engine/WorkflowEngine';
import { MockProvider, createMockProvider } from '@/platform/providers/MockProvider';
import { ClientIntakeSynthesizer } from '@/features/workflows/engine/templates/legal/ClientIntakeSynthesizer';
import type { AuditEntry } from '@/platform/types/audit';

describe('Workflow Integration Tests', () => {
  let mockProvider: MockProvider;
  let fileSystem: Map<string, string>;
  let fileOps: FileOperations;
  let interviewHandler: InterviewHandler;
  let progressHandler: ProgressHandler;
  let progressCalls: { stepIndex: number; stepName: string; status: string }[];

  beforeEach(() => {
    // Set up mock provider with realistic responses
    mockProvider = createMockProvider();

    // Set up in-memory file system
    fileSystem = new Map<string, string>();
    fileOps = {
      writeFile: vi.fn(async (path: string, content: string) => {
        fileSystem.set(path, content);
      }),
      readFile: vi.fn(async (path: string) => {
        const content = fileSystem.get(path);
        if (!content) throw new Error(`File not found: ${path}`);
        return content;
      }),
    };

    // Set up interview handler with mock answers matching ClientIntakeSynthesizer questions
    interviewHandler = vi.fn(async () => ({
      clientName: 'Robert Tran',
      matterType: 'Civil litigation',
      howTheyFoundYou: 'Referral from existing client',
      intakeNotes: 'Client called about dispute with former business partner. Partner withdrew $80k from company account.',
      matterComplexity: 'Moderate',
      potentialConflicts: '',
    }));

    // Track progress calls
    progressCalls = [];
    progressHandler = vi.fn((stepIndex, stepName, status) => {
      progressCalls.push({ stepIndex, stepName, status });
    });
  });

  describe('ClientIntakeSynthesizer Workflow', () => {
    it('executes complete workflow and generates all documents', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      // Verify run record structure
      expect(runRecord).toBeDefined();
      expect(runRecord.run_id).toBeTruthy();
      expect(runRecord.workflow).toBe('legal-client-intake-synthesizer');
      expect(runRecord.status).toBe('completed');
      expect(runRecord.start_time).toBeTruthy();
      expect(runRecord.end_time).toBeTruthy();

      // Verify files were created. The test harness only supplies writeFile
      // (no writeFileBinary), so the engine falls back to a .md sibling.
      expect(fileSystem.has('CLIENT_INTAKE_PACKAGE.md')).toBe(true);

      // Verify file operations were called correctly
      expect(fileOps.writeFile).toHaveBeenCalledTimes(1);

      // Verify interview handler was called
      expect(interviewHandler).toHaveBeenCalledTimes(1);
      expect(interviewHandler).toHaveBeenCalledWith(
        'interview',
        expect.arrayContaining([
          expect.objectContaining({ id: 'clientName' }),
          expect.objectContaining({ id: 'matterType' }),
        ])
      );
    });

    it('captures all inputs and outputs in run record', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      // Verify inputs are captured
      expect(runRecord.inputs).toHaveProperty('clientName');
      expect(runRecord.inputs).toHaveProperty('matterType');
      expect(runRecord.inputs).toHaveProperty('intakeNotes');

      // Verify outputs are captured. The step id is 'generate-intake-package'
      // so the engine records the key as 'generate-intake-package_file'.
      expect(runRecord.outputs).toHaveProperty('generate-intake-package_file', 'CLIENT_INTAKE_PACKAGE.docx');
    });

    it('records tool calls for all AI interactions', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      // Should have 1 tool call (one generate step)
      expect(runRecord.tool_calls).toHaveLength(1);

      // Verify tool call structure
      for (const toolCall of runRecord.tool_calls) {
        expect(toolCall.id).toBeTruthy();
        expect(toolCall.tool).toBe('generate');
        expect(toolCall.params).toHaveProperty('prompt');
        expect(toolCall.params).toHaveProperty('outputFile');
        expect(toolCall.result).toHaveProperty('content');
        expect(toolCall.timestamp).toBeTruthy();
        expect(toolCall.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('reports progress for each step', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      await engine.execute(ClientIntakeSynthesizer);

      // Should have progress updates for each step (started + completed)
      expect(progressHandler).toHaveBeenCalledTimes(4); // 2 steps * 2 events

      // Verify correct step order
      const startedSteps = progressCalls.filter((c) => c.status === 'started');
      expect(startedSteps[0]?.stepName).toBe('Intake Call Information');
      expect(startedSteps[1]?.stepName).toBe('Generate Intake Package');
    });

    it('interpolates template variables correctly', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      await engine.execute(ClientIntakeSynthesizer);

      // The provider should have received prompts with interpolated values
      const lastPrompt = mockProvider.getLastPrompt();
      expect(lastPrompt).toContain('Robert Tran');
    });

    it('BUG-080 records workflow egress, model call, generated file, and completion audit events', async () => {
      const auditEntries: Omit<AuditEntry, 'id' | 'timestamp'>[] = [];
      const template = {
        id: 'bug-080-one-step',
        name: 'BUG-080 One Step',
        description: 'Small audit regression template',
        category: 'Legal',
        icon: 'FileText',
        estimatedTime: '1 min',
        steps: [
          {
            id: 'generate-memo',
            type: 'generate' as const,
            name: 'Generate Memo',
            config: {
              outputFile: 'memo.md',
              promptTemplate: 'Draft a memo for {{clientName}}.',
            },
          },
        ],
      };

      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler,
        {
          audit: {
            onAuditLog: (entry) => auditEntries.push(entry),
            providerId: 'openai',
            model: 'gpt-4o-mini',
            getConfidentialityMode: () => 'direct',
            getScope: () => ({ kind: 'matter', matterId: 'matter-123' }),
          },
        },
      );

      await engine.execute(template, { clientName: 'Robert Tran' });

      expect(auditEntries.map((entry) => entry.action)).toEqual([
        'workflow_start',
        'egress',
        'model_call',
        'file_create',
        'workflow_complete',
      ]);

      const egress = auditEntries.find((entry) => entry.action === 'egress');
      expect(egress?.metadata).toMatchObject({
        provider: 'openai',
        model: 'gpt-4o-mini',
        mode: 'direct',
        destination: 'provider-direct',
        dataLeaves: true,
        scope: { kind: 'matter', matterId: 'matter-123' },
      });

      const fileCreate = auditEntries.find((entry) => entry.action === 'file_create');
      expect(fileCreate?.inputs).toMatchObject({ path: 'memo.md' });

      const completion = auditEntries.find((entry) => entry.action === 'workflow_complete');
      expect(completion?.metadata).toMatchObject({ workflowId: 'bug-080-one-step' });
    });

    it('BUG-094 records the provider resolved model in workflow egress when audit model is blank', async () => {
      const auditEntries: Omit<AuditEntry, 'id' | 'timestamp'>[] = [];
      const provider = new MockProvider('workflow-default-model');
      const template = {
        id: 'bug-094-one-step',
        name: 'BUG-094 One Step',
        description: 'Small audit model regression template',
        category: 'Legal',
        icon: 'FileText',
        estimatedTime: '1 min',
        steps: [
          {
            id: 'generate-memo',
            type: 'generate' as const,
            name: 'Generate Memo',
            config: {
              outputFile: 'memo.md',
              promptTemplate: 'Draft a memo for {{clientName}}.',
            },
          },
        ],
      };

      const engine = new WorkflowEngine(
        provider,
        fileOps,
        interviewHandler,
        progressHandler,
        {
          audit: {
            onAuditLog: (entry) => auditEntries.push(entry),
            providerId: 'openai',
            getConfidentialityMode: () => 'direct',
            getScope: () => ({ kind: 'matter', matterId: 'matter-123' }),
          },
        },
      );

      await engine.execute(template, { clientName: 'Robert Tran' });

      const egress = auditEntries.find((entry) => entry.action === 'egress');
      expect(egress?.model).toBe(provider.getMetadata().model);
      expect(egress?.metadata).toMatchObject({
        provider: 'openai',
        model: provider.getMetadata().model,
        mode: 'direct',
        destination: 'provider-direct',
        dataLeaves: true,
        scope: { kind: 'matter', matterId: 'matter-123' },
      });
      expect(egress?.model).not.toBe('unknown');
    });
  });

  describe('Error Handling', () => {
    it('handles provider errors gracefully', async () => {
      // Create a new provider that will throw for the generate step
      const errorProvider = new MockProvider();
      errorProvider.setDefaultResponse({
        content: '',
        error: {
          message: 'API rate limit exceeded',
          type: 'rate_limit',
        },
      });

      const engine = new WorkflowEngine(
        errorProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      // Should complete with failed status
      expect(runRecord.status).toBe('failed');
      expect(runRecord.end_time).toBeTruthy();

      // Should report failed progress
      const failedCalls = progressCalls.filter((c) => c.status === 'failed');
      expect(failedCalls.length).toBeGreaterThan(0);
    });

    it('handles file operation errors', async () => {
      const failingFileOps: FileOperations = {
        writeFile: vi.fn(async () => {
          throw new Error('Disk full');
        }),
        readFile: vi.fn(async () => 'content'),
      };

      const engine = new WorkflowEngine(
        mockProvider,
        failingFileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      expect(runRecord.status).toBe('failed');
    });

    it('handles interview cancellation', async () => {
      const cancellingInterviewHandler: InterviewHandler = vi.fn(async () => {
        throw new Error('User cancelled');
      });

      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        cancellingInterviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      expect(runRecord.status).toBe('failed');
      expect(cancellingInterviewHandler).toHaveBeenCalled();
    });

    it('NEW-024: cancelling at the first interview emits NO workflow audit (no phantom run)', async () => {
      const auditEntries: { action: string }[] = [];
      const cancellingInterviewHandler: InterviewHandler = vi.fn(async () => {
        throw new Error('User cancelled');
      });

      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        cancellingInterviewHandler,
        progressHandler,
        {
          audit: {
            onAuditLog: (entry) => auditEntries.push(entry),
            providerId: 'openai',
            model: 'gpt-4o-mini',
            getConfidentialityMode: () => 'direct',
            getScope: () => ({ kind: 'matter', matterId: 'm-1' }),
          },
        },
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      // The run never really started: no 'Workflow Started' and no
      // 'Workflow Failed' should be logged for a mis-clicked Run + Cancel.
      const actions = auditEntries.map((e) => e.action);
      expect(actions).not.toContain('workflow_start');
      expect(actions).not.toContain('workflow_fail');
      expect(runRecord.status).toBe('failed');
      expect(runRecord.error).toBe('User cancelled');
    });
  });

  describe('Execution State', () => {
    it('tracks execution state during workflow via progress callback', async () => {
      const capturedStates: { stepIndex: number; stepName: string; status: string }[] = [];

      const trackingProgressHandler: ProgressHandler = (
        stepIndex,
        stepName,
        status
      ) => {
        capturedStates.push({ stepIndex, stepName, status });
      };

      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        trackingProgressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      // Verify we captured progress events during execution
      expect(capturedStates.length).toBeGreaterThan(0);

      // Verify each step had started and completed events
      const startedEvents = capturedStates.filter((s) => s.status === 'started');
      const completedEvents = capturedStates.filter((s) => s.status === 'completed');
      expect(startedEvents.length).toBe(2); // 2 steps
      expect(completedEvents.length).toBe(2);

      // After workflow completes, execution is null or completed
      expect(runRecord.status).toBe('completed');
    });
  });

  describe('Workflow Metadata', () => {
    it('includes model metadata in run record', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      expect(runRecord.model).toBe('mock-model');
    });

    it('preserves workflow template information', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      expect(runRecord.workflow).toBe(ClientIntakeSynthesizer.id);
    });
  });

  describe('Run Record Timing', () => {
    it('records accurate timestamps', async () => {
      const beforeStart = new Date();

      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(ClientIntakeSynthesizer);

      const afterEnd = new Date();

      const startTime = new Date(runRecord.start_time);
      const endTime = new Date(runRecord.end_time);

      expect(startTime.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      expect(endTime.getTime()).toBeLessThanOrEqual(afterEnd.getTime());
      expect(endTime.getTime()).toBeGreaterThanOrEqual(startTime.getTime());
    });
  });
});

describe('Custom Workflow Templates', () => {
  it('executes minimal workflow with single step', async () => {
    const mockProvider = createMockProvider();
    const fileSystem = new Map<string, string>();
    const fileOps: FileOperations = {
      writeFile: vi.fn(async (path, content) => {
        fileSystem.set(path, content);
      }),
      readFile: vi.fn(async (path) => fileSystem.get(path) || ''),
    };
    const interviewHandler: InterviewHandler = vi.fn(async () => ({
      name: 'Test Business',
    }));

    const minimalTemplate = {
      id: 'minimal-test',
      name: 'Minimal Test',
      description: 'A minimal workflow for testing',
      version: '1.0.0',
      category: 'test',
      steps: [
        {
          id: 'interview',
          type: 'interview' as const,
          name: 'Quick Interview',
          description: 'Just one question',
          config: {
            questions: [
              {
                id: 'name',
                question: 'What is the name?',
                type: 'text',
                required: true,
              },
            ],
          },
        },
      ],
      requiredInputs: [],
      outputs: [],
    };

    const engine = new WorkflowEngine(
      mockProvider,
      fileOps,
      interviewHandler
    );

    const runRecord = await engine.execute(minimalTemplate);

    expect(runRecord.status).toBe('completed');
    expect(runRecord.inputs).toHaveProperty('name', 'Test Business');
  });
});
