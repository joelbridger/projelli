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
  AnalyzeStepConfig,
  ContradictionAnalysisResult,
} from '@/types/workflow';
import type { Provider } from '@/modules/models/Provider';
import type { RetrievalScope } from '@/utils/tauri-commands';
import {
  runContradictionAnalysis,
  type RetrieveFn,
  type VerifyCitationFn,
} from './legalAnalysis';

/**
 * Callback for interview step - receives questions, returns answers
 */
export type InterviewHandler = (
  stepId: string,
  questions: InterviewStepConfig['questions']
) => Promise<Record<string, string>>;

/**
 * Callback for file operations.
 *
 * WS-D — `writeFileBinary` is how the engine emits a real Office document
 * (`.docx` bytes) rather than markdown. It is optional so existing callers /
 * tests that only pass `writeFile`/`readFile` keep working; the engine throws a
 * clear error if a step needs binary output but no binary writer was supplied.
 */
export interface FileOperations {
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  writeFileBinary?: (path: string, bytes: Uint8Array) => Promise<void>;
}

/**
 * WS-D — Litigation-associate dependencies for the `analyze` step. INJECTED so
 * the engine stays UI- and Tauri-free and the step is fully testable with
 * mocks. When omitted, an `analyze` step fails with a clear error rather than
 * silently producing an ungrounded document.
 *
 *   - `getScope` returns the ACTIVE matter retrieval scope. The engine never
 *     searches "everything" silently — the scope is always explicit.
 *   - `retrieve` runs matter-scoped retrieval with privilege EXCLUDED.
 *   - `verifyCitation` confirms a finding's citation against the local store.
 *   - `serializeContradictions` renders the structured result to `.docx` bytes.
 */
export interface AnalyzeDeps {
  getScope: () => RetrievalScope;
  retrieve: RetrieveFn;
  verifyCitation: VerifyCitationFn;
  serializeContradictions: (
    result: ContradictionAnalysisResult,
    meta: {
      title: string;
      matterName?: string;
      witnessName?: string;
      depositionDate?: string;
      verificationBanner: string;
      /** VG-3b — honest disclosure when retrieval was unavailable or empty. */
      retrievalNote?: string;
    },
  ) => Promise<Uint8Array>;
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
 * Stream C1 — Callback returning the community-installed workflow templates
 * read from the marketplace install directory. Defaults to a resolver that
 * returns `[]`, so engines constructed without marketplace wiring continue to
 * surface only their built-ins. Throwing or returning a rejected promise
 * does not crash the engine; `availableTemplates()` falls back to built-ins
 * with a console warning.
 */
export type CommunityTemplatesProvider = () => Promise<WorkflowTemplate[]>;

export interface WorkflowEngineOptions {
  /**
   * Stream C1 — Built-in templates the engine should surface alongside any
   * community-installed templates. Caller-supplied so the engine doesn't
   * have to import from `@/features/workflows/engine` (which would create a circular
   * import via this file's barrel re-export).
   */
  builtInTemplates?: WorkflowTemplate[];
  /** Stream C1 — Source of marketplace-installed templates. */
  getCommunityTemplates?: CommunityTemplatesProvider;
  /**
   * WS-D — Dependencies for the litigation `analyze` step (matter-scoped
   * retrieval, citation verification, Word rendering). Optional: engines
   * constructed without it cannot run `analyze` steps and will fail those
   * steps with a clear error rather than emitting an ungrounded document.
   */
  analyzeDeps?: AnalyzeDeps;
}

/**
 * WorkflowEngine executes workflow templates
 */
export class WorkflowEngine {
  private execution: WorkflowExecution | null = null;
  private toolCalls: ToolCall[] = [];
  private readonly builtInTemplates: WorkflowTemplate[];
  private readonly getCommunityTemplates: CommunityTemplatesProvider;
  private readonly analyzeDeps: AnalyzeDeps | undefined;

  constructor(
    private readonly provider: Provider,
    private readonly fileOps: FileOperations,
    private readonly onInterview: InterviewHandler,
    private readonly onProgress?: ProgressHandler,
    options: WorkflowEngineOptions = {}
  ) {
    this.builtInTemplates = options.builtInTemplates ?? [];
    this.getCommunityTemplates =
      options.getCommunityTemplates ?? (() => Promise.resolve([]));
    this.analyzeDeps = options.analyzeDeps;
  }

  /**
   * Stream C1 — All templates the engine knows about: built-ins (caller-
   * supplied at construction) followed by community-installed templates from
   * the marketplace. Failures fetching community templates are logged + the
   * built-in list is returned alone so the picker never goes empty.
   */
  async availableTemplates(): Promise<WorkflowTemplate[]> {
    let community: WorkflowTemplate[] = [];
    try {
      community = await this.getCommunityTemplates();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[WorkflowEngine] getCommunityTemplates failed, returning built-ins only:',
        err,
      );
    }
    return [...this.builtInTemplates, ...community];
  }

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
      case 'analyze':
        return this.executeAnalyzeStep(step);
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

    // Write the output file. WS-D: when the template targets a `.docx`
    // deliverable, render the model's markdown into a real Word document so it
    // opens in the Word-familiar editor (not raw markdown). This establishes
    // the workflow → Office pattern for every `generate` template; the legal
    // flagship adds structured findings on top via the `analyze` step.
    await this.writeDeliverable(config.outputFile, response.content);

    return {
      [`${step.id}_output`]: response.content,
      [`${step.id}_file`]: config.outputFile,
      [`${step.id}_tokens`]: response.usage.totalTokens,
      [`${step.id}_cost`]: response.cost,
    };
  }

  /**
   * WS-D — Write a workflow deliverable. If the target file is a `.docx`,
   * render `markdownContent` to a real Word document and write the bytes via
   * `writeFileBinary`; otherwise write the markdown as-is. Falls back to a
   * markdown sibling when the path is `.docx` but no binary writer is wired
   * (keeps browser/test callers that only supply `writeFile` working).
   */
  private async writeDeliverable(outputFile: string, markdownContent: string): Promise<void> {
    const isDocx = outputFile.toLowerCase().endsWith('.docx');
    if (isDocx && this.fileOps.writeFileBinary) {
      const { markdownToDocxBytes, applyLetterheadIfConfigured } = await import('@/utils/docx-io');
      const bytes = await markdownToDocxBytes(markdownContent, outputFile);
      // VG-4c — put the deliverable on the firm letterhead if one is configured
      // (opt-in; fail-open: pass-through when unset, not in Tauri, or on error).
      const finalBytes = await applyLetterheadIfConfigured(bytes);
      await this.fileOps.writeFileBinary(outputFile, finalBytes);
      return;
    }
    if (isDocx) {
      // No binary writer available — degrade to a markdown sibling so the run
      // still produces a readable artifact rather than corrupt bytes.
      const mdPath = outputFile.replace(/\.docx$/i, '.md');
      await this.fileOps.writeFile(mdPath, markdownContent);
      return;
    }
    await this.fileOps.writeFile(outputFile, markdownContent);
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
   * WS-D — Execute a litigation `analyze` step: matter-scoped, privilege-
   * excluded retrieval → structured findings → per-finding citation
   * verification → a structured Word (.docx) deliverable.
   *
   * The deliverable is written to the matter's workflow folder via
   * `writeFileBinary`; the structured result (findings + verified/unverified
   * counts) is returned into the run's outputs so the RunRecord captures what
   * was flagged and what verified. Requires `analyzeDeps` + `writeFileBinary`
   * to be wired; both throw a clear error if missing rather than emitting an
   * ungrounded or markdown-only artifact.
   */
  private async executeAnalyzeStep(step: WorkflowStep): Promise<Record<string, unknown>> {
    const config = step.config as AnalyzeStepConfig;

    if (!this.analyzeDeps) {
      throw new Error(
        'This workflow needs matter-scoped retrieval, which is only available in the Keepance desktop app with an active matter.',
      );
    }
    if (!this.fileOps.writeFileBinary) {
      throw new Error('Cannot produce the Word deliverable: no binary file writer is available.');
    }

    const scope = this.analyzeDeps.getScope();
    const inputs = this.execution!.inputs;

    const callStart = Date.now();
    const callId = this.generateCallId();

    // Grounded, cited analysis. `analyzeKind` selects the pipeline; today the
    // litigation flagship is `'contradictions'`.
    const { result, chunks, retrievalQuery, retrievalUnavailable } = await runContradictionAnalysis({
      provider: this.provider,
      config,
      inputs,
      scope,
      retrieve: this.analyzeDeps.retrieve,
      verify: this.analyzeDeps.verifyCitation,
      interpolate: (tpl, values) => this.interpolateTemplate(tpl, values),
    });

    // Render the structured findings to a real Word document. The matter +
    // witness + date come from the interview inputs; the verification banner
    // comes from the step config (falling back to the template's note).
    const title = config.documentTitle
      ? this.interpolateTemplate(config.documentTitle, inputs)
      : step.name;
    const meta = {
      title,
      verificationBanner:
        config.verificationBanner ??
        'Verify every flagged contradiction against the original source before relying on it.',
      ...(typeof inputs['matterName'] === 'string' ? { matterName: inputs['matterName'] as string } : {}),
      ...(typeof inputs['witnessName'] === 'string' ? { witnessName: inputs['witnessName'] as string } : {}),
      ...(typeof inputs['depositionDate'] === 'string'
        ? { depositionDate: inputs['depositionDate'] as string }
        : {}),
      // VG-3b — the deliverable says what grounded it. Retrieval down but
      // excerpts pasted → analyzed only those, and the header says so. Empty
      // (but working) retrieval → the no-documents disclosure.
      ...(retrievalUnavailable
        ? { retrievalNote: 'Analyzed only the excerpts you provided; workspace retrieval was unavailable for this run.' }
        : chunks.length === 0
          ? { retrievalNote: 'No matter documents were retrieved; this analysis covers only the excerpts you provided.' }
          : {}),
    };
    const bytes = await this.analyzeDeps.serializeContradictions(result, meta);
    // VG-4c — put the deliverable on the firm letterhead if one is configured
    // (opt-in; fail-open). Applied to the serialized bytes, AFTER the retrieval
    // note is rendered into `meta`, so the disclosure is never disturbed.
    const { applyLetterheadIfConfigured } = await import('@/utils/docx-io');
    const finalBytes = await applyLetterheadIfConfigured(bytes);
    await this.fileOps.writeFileBinary(config.outputFile, finalBytes);

    // Record the analyze tool call. The scope + retrieval query + counts make
    // the run auditable: what matter it was confined to, what it searched for,
    // and how many findings verified.
    this.toolCalls.push({
      id: callId,
      tool: 'analyze',
      params: {
        analyzeKind: config.analyzeKind,
        retrievalQuery,
        scope,
        outputFile: config.outputFile,
        retrievedChunks: chunks.length,
        // VG-3b — the run record carries whether retrieval was down.
        retrievalUnavailable,
      },
      result: {
        totalFindings: result.totalCount,
        verifiedFindings: result.verifiedCount,
        unverifiedFindings: result.unverifiedCount,
      },
      timestamp: new Date().toISOString(),
      duration: Date.now() - callStart,
    });

    return {
      [`${step.id}_findings`]: result.findings,
      [`${step.id}_summary`]: {
        total: result.totalCount,
        verified: result.verifiedCount,
        unverified: result.unverifiedCount,
      },
      [`${step.id}_file`]: config.outputFile,
      [`${step.id}_scope`]: scope,
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
  onProgress?: ProgressHandler,
  options?: WorkflowEngineOptions
): WorkflowEngine {
  return new WorkflowEngine(
    provider,
    fileOps,
    onInterview,
    onProgress,
    options
  );
}
