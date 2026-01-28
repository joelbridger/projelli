// Workflow Engine
// Executes workflow templates step-by-step

import type {
  WorkflowTemplate,
  WorkflowStep,
  WorkflowExecution,
  RunRecord,
  ToolCall,
  InterviewStepConfig,
  GenerateStepConfig,
} from '@/types/workflow';
import type { Provider } from '@/modules/models/Provider';

/**
 * Callback for interview step - receives questions, returns answers
 */
export type InterviewHandler = (
  stepId: string,
  questions: InterviewStepConfig['questions']
) => Promise<Record<string, string>>;

/**
 * Callback for file operations
 */
export interface FileOperations {
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
}

/**
 * Callback for progress updates
 */
export type ProgressHandler = (
  stepIndex: number,
  stepName: string,
  status: 'started' | 'completed' | 'failed'
) => void;

/**
 * WorkflowEngine executes workflow templates
 */
export class WorkflowEngine {
  private execution: WorkflowExecution | null = null;
  private toolCalls: ToolCall[] = [];

  constructor(
    private readonly provider: Provider,
    private readonly fileOps: FileOperations,
    private readonly onInterview: InterviewHandler,
    private readonly onProgress?: ProgressHandler
  ) {}

  /**
   * Start executing a workflow template
   */
  async execute(
    template: WorkflowTemplate,
    initialInputs: Record<string, unknown> = {}
  ): Promise<RunRecord> {
    const runId = this.generateRunId();
    const startTime = new Date();

    this.execution = {
      runId,
      template,
      currentStepIndex: 0,
      status: 'running',
      inputs: { ...initialInputs },
      stepOutputs: [],
      startTime,
    };

    this.toolCalls = [];

    try {
      // Execute each step in sequence
      for (let i = 0; i < template.steps.length; i++) {
        this.execution.currentStepIndex = i;
        const step = template.steps[i];

        if (!step) continue;

        this.onProgress?.(i, step.name, 'started');

        const stepOutput = await this.executeStep(step);
        this.execution.stepOutputs.push(stepOutput);
        this.execution.inputs = { ...this.execution.inputs, ...stepOutput };

        this.onProgress?.(i, step.name, 'completed');
      }

      this.execution.status = 'completed';
      this.execution.endTime = new Date();

      return this.createRunRecord();
    } catch (error) {
      this.execution.status = 'failed';
      this.execution.endTime = new Date();
      this.execution.error = error instanceof Error ? error.message : 'Unknown error';

      const stepIndex = this.execution.currentStepIndex;
      const step = template.steps[stepIndex];
      if (step) {
        this.onProgress?.(stepIndex, step.name, 'failed');
      }

      return this.createRunRecord();
    }
  }

  /**
   * Get current execution state
   */
  getExecution(): WorkflowExecution | null {
    return this.execution;
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: WorkflowStep): Promise<Record<string, unknown>> {
    switch (step.type) {
      case 'interview':
        return this.executeInterviewStep(step);
      case 'generate':
        return this.executeGenerateStep(step);
      case 'review':
        return this.executeReviewStep(step);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * Execute an interview step
   */
  private async executeInterviewStep(step: WorkflowStep): Promise<Record<string, unknown>> {
    const config = step.config as InterviewStepConfig;
    const answers = await this.onInterview(step.id, config.questions);
    return { [`${step.id}_answers`]: answers, ...answers };
  }

  /**
   * Execute a generate step
   */
  private async executeGenerateStep(step: WorkflowStep): Promise<Record<string, unknown>> {
    const config = step.config as GenerateStepConfig;

    // Build the prompt from template with current inputs
    const prompt = this.interpolateTemplate(config.promptTemplate, this.execution!.inputs);

    // Record tool call start
    const callStart = Date.now();
    const callId = this.generateCallId();

    // Call the provider
    const sendOptions = config.systemPrompt ? { systemPrompt: config.systemPrompt } : undefined;
    const response = await this.provider.sendMessage(prompt, sendOptions);

    // Record tool call
    this.toolCalls.push({
      id: callId,
      tool: 'generate',
      params: {
        prompt,
        outputFile: config.outputFile,
      },
      result: {
        content: response.content,
        tokens: response.usage.totalTokens,
        cost: response.cost,
      },
      timestamp: new Date().toISOString(),
      duration: Date.now() - callStart,
    });

    // Write the output file
    await this.fileOps.writeFile(config.outputFile, response.content);

    return {
      [`${step.id}_output`]: response.content,
      [`${step.id}_file`]: config.outputFile,
      [`${step.id}_tokens`]: response.usage.totalTokens,
      [`${step.id}_cost`]: response.cost,
    };
  }

  /**
   * Execute a review step
   */
  private async executeReviewStep(step: WorkflowStep): Promise<Record<string, unknown>> {
    const config = step.config as { inputFile: string; reviewPrompt: string };

    // Read the input file
    const content = await this.fileOps.readFile(config.inputFile);

    // Build the review prompt
    const prompt = this.interpolateTemplate(config.reviewPrompt, {
      ...this.execution!.inputs,
      content,
    });

    // Record tool call start
    const callStart = Date.now();
    const callId = this.generateCallId();

    // Call the provider
    const response = await this.provider.sendMessage(prompt);

    // Record tool call
    this.toolCalls.push({
      id: callId,
      tool: 'review',
      params: {
        prompt,
        inputFile: config.inputFile,
      },
      result: {
        content: response.content,
        tokens: response.usage.totalTokens,
        cost: response.cost,
      },
      timestamp: new Date().toISOString(),
      duration: Date.now() - callStart,
    });

    return {
      [`${step.id}_review`]: response.content,
      [`${step.id}_tokens`]: response.usage.totalTokens,
      [`${step.id}_cost`]: response.cost,
    };
  }

  /**
   * Interpolate variables in a template string
   */
  private interpolateTemplate(
    template: string,
    values: Record<string, unknown>
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = values[key];
      if (value === undefined) {
        return `{{${key}}}`;
      }
      return String(value);
    });
  }

  /**
   * Create a run record from the current execution
   */
  private createRunRecord(): RunRecord {
    if (!this.execution) {
      throw new Error('No execution in progress');
    }

    return {
      run_id: this.execution.runId,
      workflow: this.execution.template.id,
      model: this.provider.getMetadata().model,
      inputs: this.execution.inputs,
      outputs: Object.fromEntries(
        this.execution.stepOutputs.flatMap((output) => Object.entries(output))
      ),
      tool_calls: this.toolCalls,
      start_time: this.execution.startTime.toISOString(),
      end_time: this.execution.endTime?.toISOString() ?? new Date().toISOString(),
      status: this.execution.status === 'running' || this.execution.status === 'paused'
        ? 'completed'
        : this.execution.status,
      error: this.execution.error,
    };
  }

  /**
   * Generate a unique run ID
   */
  private generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate a unique call ID
   */
  private generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

/**
 * Create a workflow engine instance
 */
export function createWorkflowEngine(
  provider: Provider,
  fileOps: FileOperations,
  onInterview: InterviewHandler,
  onProgress?: ProgressHandler
): WorkflowEngine {
  return new WorkflowEngine(provider, fileOps, onInterview, onProgress);
}
