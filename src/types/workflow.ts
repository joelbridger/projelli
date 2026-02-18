// Workflow Types

/**
 * A single tool call made during workflow execution
 */
export interface ToolCall {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  duration: number;
}

/**
 * Status of a workflow run
 */
export type RunRecordStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Record of a workflow run
 */
export interface RunRecord {
  run_id: string;
  workflow: string;
  model: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  tool_calls: ToolCall[];
  start_time: string;
  end_time: string;
  status: RunRecordStatus;
  error: string | undefined;
}

/**
 * Workflow template step types
 */
export type WorkflowStepType = 'interview' | 'generate' | 'review';

/**
 * Interview question definition
 */
export interface InterviewQuestion {
  id: string;
  question: string;
  description?: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect';
  options?: string[];
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

/**
 * Interview step configuration
 */
export interface InterviewStepConfig {
  questions: InterviewQuestion[];
}

/**
 * Generate step configuration
 */
export interface GenerateStepConfig {
  outputFile: string;
  promptTemplate: string;
  systemPrompt?: string;
}

/**
 * Review step configuration
 */
export interface ReviewStepConfig {
  inputFile: string;
  reviewPrompt: string;
}

/**
 * Single step in a workflow
 */
export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  description?: string;
  config: InterviewStepConfig | GenerateStepConfig | ReviewStepConfig;
}

/**
 * Workflow template definition
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  category: 'kickoff' | 'research' | 'analysis' | 'planning' | 'custom';
  steps: WorkflowStep[];
  requiredInputs: string[];
  outputs: string[];
}

/**
 * Workflow execution state
 */
export interface WorkflowExecution {
  runId: string;
  template: WorkflowTemplate;
  currentStepIndex: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  inputs: Record<string, unknown>;
  stepOutputs: Record<string, unknown>[];
  startTime: Date;
  endTime?: Date;
  error?: string;
}
