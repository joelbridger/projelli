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
import { WorkflowEngine, type InterviewHandler, type FileOperations, type ProgressHandler } from '@/modules/workflow/WorkflowEngine';
import { MockProvider, createMockProvider } from '@/modules/models/MockProvider';
import { NewBusinessKickoff } from '@/modules/workflow/templates/NewBusinessKickoff';
import type { RunRecord, RunRecordStatus } from '@/types/workflow';

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

    // Set up interview handler with mock answers
    interviewHandler = vi.fn(async () => ({
      problem: 'Solo founders waste time on disorganized business planning',
      solution: 'An AI-assisted local workspace for business documents',
      targetCustomer: 'Solo founders starting tech businesses',
      uniqueValue: 'Local-first, privacy-focused, AI-assisted planning',
      channels: 'Product Hunt, indie hackers community, content marketing',
      revenueModel: 'Lifetime license at $99, premium features at $199',
      competitors: 'Notion, Obsidian, spreadsheets',
      stage: 'Idea',
    }));

    // Track progress calls
    progressCalls = [];
    progressHandler = vi.fn((stepIndex, stepName, status) => {
      progressCalls.push({ stepIndex, stepName, status });
    });
  });

  describe('NewBusinessKickoff Workflow', () => {
    it('executes complete workflow and generates all documents', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(NewBusinessKickoff);

      // Verify run record structure
      expect(runRecord).toBeDefined();
      expect(runRecord.run_id).toBeTruthy();
      expect(runRecord.workflow).toBe('new-business-kickoff');
      expect(runRecord.status).toBe('completed');
      expect(runRecord.start_time).toBeTruthy();
      expect(runRecord.end_time).toBeTruthy();

      // Verify files were created
      expect(fileSystem.has('VISION.md')).toBe(true);
      expect(fileSystem.has('PRD.md')).toBe(true);
      expect(fileSystem.has('LEAN_CANVAS.md')).toBe(true);

      // Verify file operations were called correctly
      expect(fileOps.writeFile).toHaveBeenCalledTimes(3);

      // Verify interview handler was called
      expect(interviewHandler).toHaveBeenCalledTimes(1);
      expect(interviewHandler).toHaveBeenCalledWith(
        'interview',
        expect.arrayContaining([
          expect.objectContaining({ id: 'problem' }),
          expect.objectContaining({ id: 'solution' }),
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

      const runRecord = await engine.execute(NewBusinessKickoff);

      // Verify inputs are captured
      expect(runRecord.inputs).toHaveProperty('problem');
      expect(runRecord.inputs).toHaveProperty('solution');
      expect(runRecord.inputs).toHaveProperty('targetCustomer');

      // Verify outputs are captured
      expect(runRecord.outputs).toHaveProperty('generate-vision_file', 'VISION.md');
      expect(runRecord.outputs).toHaveProperty('generate-prd_file', 'PRD.md');
      expect(runRecord.outputs).toHaveProperty('generate-lean-canvas_file', 'LEAN_CANVAS.md');
    });

    it('records tool calls for all AI interactions', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(NewBusinessKickoff);

      // Should have 3 tool calls (one per generate step)
      expect(runRecord.tool_calls).toHaveLength(3);

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

      await engine.execute(NewBusinessKickoff);

      // Should have progress updates for each step (started + completed)
      expect(progressHandler).toHaveBeenCalledTimes(8); // 4 steps * 2 events

      // Verify correct step order
      const startedSteps = progressCalls.filter((c) => c.status === 'started');
      expect(startedSteps[0]?.stepName).toBe('Business Interview');
      expect(startedSteps[1]?.stepName).toBe('Generate Vision Document');
      expect(startedSteps[2]?.stepName).toBe('Generate PRD');
      expect(startedSteps[3]?.stepName).toBe('Generate Lean Canvas');
    });

    it('interpolates template variables correctly', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      await engine.execute(NewBusinessKickoff);

      // The provider should have received prompts with interpolated values
      const lastPrompt = mockProvider.getLastPrompt();
      expect(lastPrompt).toContain('Solo founders');
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

      const runRecord = await engine.execute(NewBusinessKickoff);

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

      const runRecord = await engine.execute(NewBusinessKickoff);

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

      const runRecord = await engine.execute(NewBusinessKickoff);

      expect(runRecord.status).toBe('failed');
      expect(cancellingInterviewHandler).toHaveBeenCalled();
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

      const runRecord = await engine.execute(NewBusinessKickoff);

      // Verify we captured progress events during execution
      expect(capturedStates.length).toBeGreaterThan(0);

      // Verify each step had started and completed events
      const startedEvents = capturedStates.filter((s) => s.status === 'started');
      const completedEvents = capturedStates.filter((s) => s.status === 'completed');
      expect(startedEvents.length).toBe(4); // 4 steps
      expect(completedEvents.length).toBe(4);

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

      const runRecord = await engine.execute(NewBusinessKickoff);

      expect(runRecord.model).toBe('mock-model');
    });

    it('preserves workflow template information', async () => {
      const engine = new WorkflowEngine(
        mockProvider,
        fileOps,
        interviewHandler,
        progressHandler
      );

      const runRecord = await engine.execute(NewBusinessKickoff);

      expect(runRecord.workflow).toBe(NewBusinessKickoff.id);
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

      const runRecord = await engine.execute(NewBusinessKickoff);

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
