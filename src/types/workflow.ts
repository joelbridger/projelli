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
 * Supported AI provider identifiers for per-template model assignment.
 * Kept as a string literal so Ollama (Q7) remains a valid option once added.
 */
export type TemplateProviderId = 'claude' | 'openai' | 'gemini' | 'ollama';

/**
 * M7 — A named output produced by a template. The `id` is stable and used
 * for chain wiring; the `name` is human-readable for UI; `schema` is a free-
 * form JSON-schema-ish hint (optional — Keepance chains only require the id).
 */
export interface NamedOutput {
  id: string;
  name: string;
  schema?: string;
}

/**
 * M7 — A named input to a template that can be fed from another template's
 * output.  `acceptsOutputFrom` lists compatible output IDs so the chain UI
 * can highlight which steps naturally compose.
 */
export interface TemplateInput {
  id: string;
  name: string;
  schema?: string;
  acceptsOutputFrom?: string[];
}

/**
 * Workflow template definition
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  category: 'kickoff' | 'research' | 'analysis' | 'planning' | 'custom' | 'legal' | 'tax' | 'consulting';
  steps: WorkflowStep[];
  requiredInputs: string[];
  outputs: string[];
  /**
   * M7 — Named outputs for chain wiring. Separate from `outputs` (which is
   * a list of filenames) so chain logic can reference structured fields
   * produced by generation steps without conflicting with file artifacts.
   */
  namedOutputs?: NamedOutput[];
  /**
   * M7 — Named inputs for chain wiring. When a template declares inputs with
   * `acceptsOutputFrom` values that include an upstream template's output
   * IDs, the chain UI marks the pairing as "recommended" vs "manual map".
   */
  namedInputs?: TemplateInput[];
  /**
   * Q8 — Optional template-level default provider. When unset the user's
   * global default provider is used. A settings override takes precedence
   * over this.
   */
  defaultProvider?: TemplateProviderId;
  /**
   * Q8 — Optional template-level default model (provider-specific model id,
   * e.g. `claude-sonnet-4-6` or `gpt-4o`). When unset the provider's default
   * model is used.
   */
  defaultModel?: string;
  /**
   * Q19 — Marker for user-authored templates. Built-ins leave this
   * undefined; user templates are persisted with this flag set to `true`.
   */
  isUser?: boolean;
  /**
   * Stream C1 — Where this template came from. Built-ins leave this
   * undefined (treated as `'built-in'` by UI). Templates installed via the
   * Templates Marketplace stamp `'community'`. User-authored templates can
   * stamp `'custom'` if desired.
   */
  provenance?: 'built-in' | 'community' | 'custom';
  /**
   * Stream C1 — Original id from the marketplace catalog (without the
   * `community:` namespace prefix that the engine applies). Allows the UI
   * + uninstall flow to look the entry up in `MarketplaceService.listInstalled()`.
   * Only set on community-installed templates.
   */
  sourceId?: string;
  /**
   * Marks a profession-pack template that ships but has not yet been reviewed
   * by a practicing professional (the legal and tax packs). The UI surfaces it
   * as "Preview"; the description is also prefixed with a pending-review note.
   * Dropped per-pack once an advisor signs off.
   */
  preview?: boolean;
}

/**
 * M7 — A single step in a workflow chain: run a template and optionally map
 * fields from a previous step's output to this step's inputs.
 */
export interface WorkflowChainStep {
  templateId: string;
  /**
   * For each mapping, `fromStepIndex` selects a previous step's output (0 =
   * first step); `fromOutputId` names which field to pull; `toInputId` names
   * the input on this step that should receive it.
   */
  inputMap?: Array<{
    fromStepIndex: number;
    fromOutputId: string;
    toInputId: string;
  }>;
}

/**
 * M7 — A persisted chain definition. Saved to
 * `<workspace>/.keepance/chains/<name>.json`.
 */
export interface WorkflowChain {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  steps: WorkflowChainStep[];
  createdAt: string;
  updatedAt: string;
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

/**
 * Persisted workflow execution record stored in a `.workflow` file.
 *
 * The on-disk file is the source of truth for past runs and lets the user
 * reopen a completed (or in-progress) workflow from the file tree. Live
 * runs write a debounced snapshot of this shape on every progress update;
 * terminal states (completed / failed / cancelled) are flushed immediately.
 *
 * Designed to be JSON-serializable: dates are ISO strings, no Date objects,
 * no functions. Schema version gates future additions.
 */
export interface WorkflowFileData {
  /** Stable schema version for future backward-compatible migrations. */
  schemaVersion: 1;
  /** Run identifier — equals execution.runId once engine starts. */
  runId: string;
  /** Full template (NOT just id) so the tab can render even if the template list changes. */
  template: WorkflowTemplate;
  /** Absolute path of the workflow folder this file lives in. */
  workflowFolderPath: string;
  /** Current step index. 0 when started, template.steps.length when completed. */
  currentStepIndex: number;
  /** Live status of the run. */
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** All accumulated step inputs/outputs — same shape as WorkflowExecution.inputs. */
  inputs: Record<string, unknown>;
  /** Step-by-step outputs in execution order. */
  stepOutputs: Record<string, unknown>[];
  /** Completed interview answers, prebuilt for the tab's display. */
  completedAnswers: { stepName: string; answers: Record<string, string> }[];
  /** ISO start timestamp. */
  startTime: string;
  /** ISO end timestamp — set when status flips away from 'running'. */
  endTime?: string;
  /** If status='failed', the error message. */
  error?: string;
  /** Filenames (not absolute paths) created in the workflow folder. */
  artifacts: string[];
}
