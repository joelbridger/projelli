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
 * Workflow template step types.
 *
 * WS-D — `analyze` is the litigation-associate step: it pulls matter-scoped,
 * privilege-excluded context from the local RAG store, asks the model for
 * STRUCTURED findings (each finding carrying its source citations), verifies
 * every citation against the store, and renders a structured Word (.docx)
 * deliverable rather than free-form markdown. It is the proven flagship behind
 * the Deposition Contradiction Finder; other legal templates can adopt it.
 */
export type WorkflowStepType = 'interview' | 'generate' | 'review' | 'analyze';

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
 * WS-D — what kind of grounded analysis an `analyze` step performs. Drives
 * the structured-findings schema, the Word rendering, and the verification
 * framing. Currently the litigation flagship is `'contradictions'`; the union
 * is open so the privilege-log / timeline / discovery-triage templates can add
 * their own structured kinds and reuse the same retrieve → structure → verify →
 * Word pipeline.
 */
export type AnalyzeKind = 'contradictions';

/**
 * WS-D — Configuration for an `analyze` step: matter-scoped grounded retrieval
 * + structured findings + per-finding citation verification + a Word deliverable.
 *
 * The step interpolates `{{var}}` inputs the same way `generate` does, builds a
 * retrieval query from `retrievalQueryTemplate`, and writes the rendered Word
 * document to `outputFile` (which MUST end in `.docx`).
 */
export interface AnalyzeStepConfig {
  /** Which structured analysis to run (selects schema + renderer + framing). */
  analyzeKind: AnalyzeKind;
  /**
   * Output filename for the Word deliverable. MUST end in `.docx` — the engine
   * writes binary OOXML here, not markdown.
   */
  outputFile: string;
  /**
   * Template for the matter-scoped retrieval query. Interpolated with the
   * accumulated inputs (same `{{var}}` syntax as `promptTemplate`). The result
   * is passed to the injected `retrieve(query, topK, scope)` with the ACTIVE
   * matter scope and privilege EXCLUDED.
   */
  retrievalQueryTemplate: string;
  /** How many context chunks to retrieve. Defaults to 12 when omitted. */
  topK?: number;
  /** F-510 — max retrieved chunks admitted per source document. Keeps one
   *  large low-signal file from drowning the feed. Omitted = no cap. */
  perSourceCap?: number;
  /**
   * The analysis prompt. Interpolated with inputs PLUS a `{{retrievedContext}}`
   * variable holding the formatted, numbered source list. The model is asked to
   * return findings conforming to the structured schema for `analyzeKind`.
   */
  promptTemplate: string;
  /** Optional system prompt for the structured call. */
  systemPrompt?: string;
  /**
   * Document title for the rendered Word file. Interpolated with inputs.
   * Defaults to the step name when omitted.
   */
  documentTitle?: string;
  /**
   * Banner text rendered at the top of the Word deliverable reminding the
   * attorney to verify every finding before relying on it. Defaults to the
   * template's `verificationNote` (set by the caller) when omitted.
   */
  verificationBanner?: string;
  /** VG-3b — interview input ids that count as attorney-pasted material.
   *  When retrieval is unavailable, the analysis falls back to these (and
   *  says so in the deliverable header) instead of failing; with none of
   *  them filled it refuses. */
  pastedInputIds?: string[];
}

/**
 * Single step in a workflow
 */
export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  description?: string;
  config: InterviewStepConfig | GenerateStepConfig | ReviewStepConfig | AnalyzeStepConfig;
}

/**
 * WS-D — one source reference inside a structured finding: a citation to a
 * retrieved chunk (its content-addressed `id` + matter), the human-readable
 * locator (filename + paragraph/page), and the quoted text the finding relies
 * on. `id` / `matterId` are absent only for sources the model could not ground
 * in retrieval (a hallucinated reference) — such findings are marked unverified.
 */
export interface FindingSource {
  /** Human-readable source label, e.g. `smith-depo.docx paragraph 42`. */
  locator: string;
  /** The exact quoted statement this side of the contradiction relies on. */
  quote: string;
  /** Content-addressed chunk id from retrieval (the citation key). */
  citationId?: string;
  /** The matter this chunk belongs to (the claimed scope for verification). */
  matterId?: string;
  /** Resolvable source id (file path or `mail:<id>`) for "open source". */
  sourceId?: string;
  /**
   * Per-source verification verdict against the local RAG store. `'verified'`
   * is the only safe value; anything else (or `'unverified'` when verification
   * could not run) means the locator/quote must be checked against the original.
   */
  verdict?: 'verified' | 'notFound' | 'matterMismatch' | 'textMismatch' | 'unverified';
}

/**
 * WS-D — a single candidate contradiction the associate flagged for the lawyer.
 * Carries BOTH conflicting statements (each with its own citation + locator),
 * why they conflict, and an optional topic + follow-up questions. `verified`
 * is true only when BOTH sides verified against the store.
 */
export interface ContradictionFinding {
  /** Topic / theme this finding sits under (for grouping in the deliverable). */
  topic: string;
  /** The first conflicting statement + its source. */
  statementA: FindingSource;
  /** The second conflicting statement + its source. */
  statementB: FindingSource;
  /** Plain-language explanation of why the two statements conflict. */
  conflictRationale: string;
  /** Suggested follow-up deposition questions (may be empty). */
  followUpQuestions?: string[];
  /**
   * True only when BOTH `statementA` and `statementB` verified against the
   * local store. A single unverified side flips this to false so the UI /
   * document flags the whole finding for attorney verification.
   */
  verified: boolean;
}

/**
 * WS-D — the structured result of a contradictions analyze step, persisted into
 * the RunRecord outputs (under `<stepId>_findings`) and rendered to Word.
 */
export interface ContradictionAnalysisResult {
  findings: ContradictionFinding[];
  /** Total candidate findings produced by the model. */
  totalCount: number;
  /** How many findings had BOTH citations verified against the store. */
  verifiedCount: number;
  /** How many findings have at least one unverified side. */
  unverifiedCount: number;
}

/**
 * Supported AI provider identifiers for per-template model assignment.
 * Kept as a string literal so Ollama (Q7) remains a valid option once added.
 */
export type TemplateProviderId = 'claude' | 'openai' | 'gemini' | 'ollama';

/**
 * M7 — A named output produced by a template. The `id` is stable and used
 * for chain wiring; the `name` is human-readable for UI; `schema` is a free-
 * form JSON-schema-ish hint (optional — Advisor Prep Hero chains only require the id).
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
  category: 'kickoff' | 'research' | 'analysis' | 'planning' | 'custom' | 'legal' | 'tax' | 'consulting' | 'advisors';
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
  /**
   * Workstream G — Research reliability flag. When true, the workflow output
   * display shows a non-dismissable verification banner reminding the user to
   * verify all citations and regulatory references against primary authority.
   * Set on templates that produce legal or tax research outputs where AI
   * hallucination of citation details creates professional liability exposure.
   */
  requiresVerification?: boolean;
  /**
   * Optional banner text displayed when requiresVerification is true.
   * If omitted, the UI falls back to a generic verification message.
   */
  verificationNote?: string;
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
