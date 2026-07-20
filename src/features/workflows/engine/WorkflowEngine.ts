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
} from '@/platform/types/workflow';
import type {
  Provider,
  ProviderResponse,
  SendOptions,
  StreamOptions,
} from '@/platform/providers/Provider';
import type { RetrievalScope } from '@/platform/utils/tauri-commands';
import type { AuditEntry, AuditScope } from '@/platform/types/audit';
import { type ConfidentialityMode } from '@/platform/privacy/egress';
import {
  sendPreparedMessageWithEgressAudit,
  sendPreparedStreamingWithEgressAudit,
} from '@/platform/privacy/promptPreparation';
import {
  runContradictionAnalysis,
  type RetrieveFn,
  type VerifyCitationFn,
} from './legalAnalysis';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

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

export interface WorkflowAuditOptions {
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  providerId: string;
  model?: string;
  getConfidentialityMode: () => ConfidentialityMode;
  getScope?: () => AuditScope;
  assuredAvailable?: boolean;
  isDemo?: boolean;
  /** Headless runs cannot display a send-review dialog and must stop safely. */
  background?: boolean;
}

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
  /**
   * BUG-080 — audit callback supplied by the app runner. The engine owns the
   * exact provider-call and artifact-write moments, so it emits the same audit
   * rows chat does without creating a second audit sink.
   */
  audit?: WorkflowAuditOptions;
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
  private readonly audit: WorkflowAuditOptions | undefined;

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
    this.audit = options.audit;
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
    // NEW-024: log 'workflow_start' only once the run has genuinely begun (the
    // first step has produced output), NOT eagerly before the first interview.
    // A run the user cancels at the very first question — before any work — then
    // leaves NO audit trail at all, instead of a phantom "Started"/"Failed" pair
    // (and the runner deletes its empty output folder).
    // Object (not a `let` boolean) so the compiler's control-flow analysis can't
    // wrongly narrow it to a constant across the closure mutation below — which
    // would make the `!startAudit.emitted` guards read as "always truthy".
    const startAudit = { emitted: false };
    const ensureWorkflowStartAudited = () => {
      if (startAudit.emitted) return;
      startAudit.emitted = true;
      this.emitWorkflowAudit('workflow_start', template, {
        runId,
        startedAt: startTime.toISOString(),
      });
    };

    try {
      // Execute each step in sequence
      for (let i = 0; i < template.steps.length; i++) {
        this.execution.currentStepIndex = i;
        const step = template.steps[i];

        if (!step) continue;

        this.onProgress?.(i, step.name, 'started');

        // Bracket the run with 'workflow_start' BEFORE the first step does any
        // work, so the audit reads start-first. The one exception is a first
        // step that is an INTERVIEW: it emits no audit events of its own and can
        // be cancelled, so we defer the start-audit until it resolves — a cancel
        // then leaves no audit trace at all (NEW-024). Ordering is preserved
        // either way because an interview contributes nothing before it returns.
        if (!startAudit.emitted && step.type !== 'interview') ensureWorkflowStartAudited();

        const stepOutput = await this.executeStep(step);
        // Covers the interview-first case: the run has genuinely started once the
        // first step yields output. Cancelling the interview throws above this
        // line, so 'workflow_start' is never emitted for a never-started run.
        ensureWorkflowStartAudited();
        this.execution.stepOutputs.push(stepOutput);
        this.execution.inputs = { ...this.execution.inputs, ...stepOutput };

        this.onProgress?.(i, step.name, 'completed');
      }

      this.execution.status = 'completed';
      this.execution.endTime = new Date();

      ensureWorkflowStartAudited(); // 0-step templates still bracket cleanly
      this.emitWorkflowAudit('workflow_complete', template, {
        runId,
        startedAt: startTime.toISOString(),
        completedAt: this.execution.endTime.toISOString(),
      });

      return this.createRunRecord();
    } catch (error) {
      // A user-cancelled interview rejects with Error('User cancelled'). We keep
      // the live status as 'failed' (the WorkflowExecution status enum has no
      // 'cancelled'); the error message is the signal the runner reads to tell a
      // deliberate cancel apart from a real failure.
      const userCancelled = error instanceof Error && error.message === 'User cancelled';
      this.execution.status = 'failed';
      this.execution.endTime = new Date();
      this.execution.error = error instanceof Error ? error.message : 'Unknown error';

      const stepIndex = this.execution.currentStepIndex;
      const step = template.steps[stepIndex];
      if (step) {
        this.onProgress?.(stepIndex, step.name, 'failed');
      }

      // Cancelled before any work began: never really started, so log nothing.
      // The runner removes the empty output folder it pre-created.
      if (userCancelled && !startAudit.emitted) {
        return this.createRunRecord();
      }

      // A genuine failure (or a cancel after some work) still brackets the run.
      ensureWorkflowStartAudited();
      this.emitWorkflowAudit('workflow_fail', template, {
        runId,
        startedAt: startTime.toISOString(),
        failedAt: this.execution.endTime.toISOString(),
        error: this.execution.error,
      });

      return this.createRunRecord();
    }
  }

  private emitAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    this.audit?.onAuditLog?.(entry);
  }

  private workflowAuditBase(
    template: WorkflowTemplate,
    extras: Record<string, unknown>,
  ): Omit<AuditEntry, 'id' | 'timestamp'> {
    return {
      action: 'workflow_start',
      description: `Started workflow: ${template.name}`,
      model: this.audit?.model ?? this.provider.getMetadata().model,
      inputs: { workflowId: template.id, workflowName: template.name },
      outputs: {},
      userDecision: 'auto',
      metadata: {
        feature: 'workflow',
        workflowId: template.id,
        workflowName: template.name,
        provider: this.audit?.providerId ?? this.provider.getMetadata().providerId,
        ...(this.audit?.getScope ? { scope: this.audit.getScope() } : {}),
        ...extras,
      },
    };
  }

  private emitWorkflowAudit(
    action: 'workflow_start' | 'workflow_complete' | 'workflow_fail',
    template: WorkflowTemplate,
    extras: Record<string, unknown>,
  ): void {
    const entry = this.workflowAuditBase(template, extras);
    const descriptions = {
      workflow_start: `Started workflow: ${template.name}`,
      workflow_complete: `Completed workflow: ${template.name}`,
      workflow_fail: `Workflow failed: ${template.name}`,
    };
    this.emitAudit({
      ...entry,
      action,
      description: descriptions[action],
      outputs: action === 'workflow_fail'
        ? { success: false, error: extras['error'] }
        : action === 'workflow_complete'
          ? { success: true }
          : {},
    });
  }

  private emitModelCallAudit(
    step: WorkflowStep,
    callKind: 'generate' | 'review' | 'analyze',
    prompt: string,
    response: unknown,
  ): void {
    if (!this.audit?.onAuditLog) return;
    const provider = this.audit.providerId;
    const model = this.audit.model ?? this.provider.getMetadata().model;
    const isProviderResponse =
      typeof response === 'object' &&
      response !== null &&
      'usage' in response &&
      'cost' in response;
    const usage = isProviderResponse ? (response as ProviderResponse).usage : undefined;
    const cost = isProviderResponse ? (response as ProviderResponse).cost : undefined;
    const contentLength = isProviderResponse
      ? (response as ProviderResponse).content.length
      : JSON.stringify(response ?? null).length;
    this.emitAudit({
      action: 'model_call',
      description: `Workflow ${callKind}: ${step.name}`,
      model,
      inputs: { promptLength: prompt.length, workflowId: this.execution?.template.id, stepId: step.id },
      outputs: { contentLength },
      userDecision: 'auto',
      metadata: {
        feature: 'workflow',
        runId: this.execution?.runId,
        workflowId: this.execution?.template.id,
        workflowName: this.execution?.template.name,
        stepId: step.id,
        stepName: step.name,
        callKind,
        provider,
      },
      ...(usage ? { tokensIn: usage.inputTokens, tokensOut: usage.outputTokens } : {}),
      ...(typeof cost === 'number' ? { costUsd: cost } : {}),
      provider,
    });
  }

  private emitFileCreateAudit(path: string, step: WorkflowStep): void {
    if (!this.audit?.onAuditLog) return;
    this.emitAudit({
      action: 'file_create',
      description: `Workflow created file: ${path}`,
      model: this.audit.model ?? this.provider.getMetadata().model,
      inputs: { path },
      outputs: { success: true },
      userDecision: 'auto',
      metadata: {
        feature: 'workflow',
        runId: this.execution?.runId,
        workflowId: this.execution?.template.id,
        workflowName: this.execution?.template.name,
        stepId: step.id,
        stepName: step.name,
        provider: this.audit.providerId,
        ...(this.audit.getScope ? { scope: this.audit.getScope() } : {}),
      },
      provider: this.audit.providerId,
    });
  }

  private async auditedSendMessage(
    step: WorkflowStep,
    callKind: 'generate' | 'review',
    prompt: string,
    options?: SendOptions,
  ): Promise<ProviderResponse> {
    const response = await sendPreparedMessageWithEgressAudit({
      provider: this.provider,
      providerId: this.audit?.providerId ?? this.provider.getMetadata().providerId ?? 'unknown',
      model: this.audit?.model ?? this.provider.getMetadata().model,
      prompt,
      ...(options ? { options } : {}),
      surface: `workflow_${callKind}`,
      background: this.audit?.background ?? false,
      parts: [
        { id: 'prompt', origin: 'workflow_input', label: `Workflow ${callKind} request`, text: prompt },
        ...Object.entries(this.execution?.inputs ?? {}).map(([key, value]) => ({
          id: `workflow-input-${key}`,
          origin: 'workflow_input' as const,
          label: `Workflow answer: ${key}`,
          text: String(value),
        })),
      ],
      ...(this.audit?.onAuditLog ? { onAuditLog: this.audit.onAuditLog } : {}),
      ...(this.audit?.getScope ? { scope: this.audit.getScope() } : {}),
    });
    this.emitModelCallAudit(step, callKind, prompt, response);
    return response;
  }

  private auditedProvider(step: WorkflowStep): Provider {
    const base = this.provider;
    const sendMessageStreaming = base.sendMessageStreaming?.bind(base);
    const toolCall = base.toolCall?.bind(base);
    const supportsNativePdf = base.supportsNativePdf?.bind(base);
    const audited = {
      getMetadata: () => base.getMetadata(),
      ...(base.isConfigured ? { isConfigured: () => base.isConfigured?.() ?? false } : {}),
      sendMessage: (prompt: string, options?: SendOptions) =>
        this.auditedSendMessage(step, 'generate', prompt, options),
      ...(sendMessageStreaming
        ? {
          sendMessageStreaming: async (prompt: string, options: StreamOptions) => {
            const response = await sendPreparedStreamingWithEgressAudit({
              provider: base,
              providerId: this.audit?.providerId ?? base.getMetadata().providerId ?? 'unknown',
              model: this.audit?.model ?? base.getMetadata().model,
              prompt,
              options,
              surface: 'workflow_streaming',
              background: this.audit?.background ?? false,
              parts: [{ id: 'prompt', origin: 'workflow_input', label: 'Workflow streaming request', text: prompt }],
              ...(this.audit?.onAuditLog ? { onAuditLog: this.audit.onAuditLog } : {}),
              ...(this.audit?.getScope ? { scope: this.audit.getScope() } : {}),
            });
            this.emitModelCallAudit(step, 'generate', prompt, response);
            return response;
          },
        }
        : {}),
      ...(toolCall
        ? {
          toolCall: <T,>(tool: string, params: Record<string, unknown>, options?: SendOptions) =>
            toolCall<T>(tool, params, options),
        }
        : {}),
      // `runContradictionAnalysis` owns this send through
      // sendPreparedStructuredWithEgressAudit. Binding preserves the concrete
      // adapter's receiver without creating a second, unprepared send route.
      structuredOutput: base.structuredOutput.bind(base),
      formatAttachmentForRequest: (att, bytes) => base.formatAttachmentForRequest(att, bytes),
      supportsAttachment: (att, model) => base.supportsAttachment(att, model),
      ...(supportsNativePdf
        ? { supportsNativePdf: (model: string) => supportsNativePdf(model) }
        : {}),
    } satisfies Provider;
    return audited;
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
        throw new Error('Unknown workflow step type');
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
    const execution = this.execution;
    if (!execution) throw new Error('No workflow execution is active.');
    const inputs = execution.inputs;

    // Build the prompt from template with current inputs
    const prompt = this.interpolateTemplate(config.promptTemplate, inputs);

    // Record tool call start
    const callStart = Date.now();
    const callId = this.generateCallId();

    // Call the provider
    const sendOptions = config.systemPrompt ? { systemPrompt: config.systemPrompt } : undefined;
    const response = await this.auditedSendMessage(step, 'generate', prompt, sendOptions);

    // BUG F3(1a) — interpolate the output path (sanitizing substituted VALUES,
    // not the template's own `/` separators) so a template like
    // `Estate Planning/{{clientName}} - Planning Summary.docx` lands under the
    // real client's name instead of the literal `{{clientName}}` placeholder.
    const outputFile = this.interpolateOutputPath(config.outputFile, inputs);

    // Record tool call
    this.toolCalls.push({
      id: callId,
      tool: 'generate',
      params: {
        prompt,
        outputFile,
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
    await this.writeDeliverable(step, outputFile, response.content);

    return {
      [`${step.id}_output`]: response.content,
      [`${step.id}_file`]: outputFile,
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
  private async writeDeliverable(
    step: WorkflowStep,
    outputFile: string,
    markdownContent: string,
  ): Promise<void> {
    const isDocx = outputFile.toLowerCase().endsWith('.docx');
    if (isDocx && this.fileOps.writeFileBinary) {
      const { markdownToDocxBytes, applyLetterheadIfConfigured } = await import('@/platform/utils/docx-io');
      const bytes = await markdownToDocxBytes(markdownContent, outputFile);
      // VG-4c — put the deliverable on the firm letterhead if one is configured
      // (opt-in; fail-open: pass-through when unset, not in Tauri, or on error).
      const finalBytes = await applyLetterheadIfConfigured(bytes);
      await this.fileOps.writeFileBinary(outputFile, finalBytes);
      this.emitFileCreateAudit(outputFile, step);
      return;
    }
    if (isDocx) {
      // No binary writer available — degrade to a markdown sibling so the run
      // still produces a readable artifact rather than corrupt bytes.
      const mdPath = outputFile.replace(/\.docx$/i, '.md');
      await this.fileOps.writeFile(mdPath, markdownContent);
      this.emitFileCreateAudit(mdPath, step);
      return;
    }
    await this.fileOps.writeFile(outputFile, markdownContent);
    this.emitFileCreateAudit(outputFile, step);
  }

  /**
   * Execute a review step
   */
  private async executeReviewStep(step: WorkflowStep): Promise<Record<string, unknown>> {
    const config = step.config as { inputFile: string; reviewPrompt: string };
    const execution = this.execution;
    if (!execution) throw new Error('No workflow execution is active.');

    // Read the input file
    const content = await this.fileOps.readFile(config.inputFile);

    // Build the review prompt
    const prompt = this.interpolateTemplate(config.reviewPrompt, {
      ...execution.inputs,
      content,
    });

    // Record tool call start
    const callStart = Date.now();
    const callId = this.generateCallId();

    // Call the provider
    const response = await this.auditedSendMessage(step, 'review', prompt);

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
        brandText(`This workflow needs client-scoped retrieval, which is only available in the ${BRAND.name} desktop app with an active client.`),
      );
    }
    if (!this.fileOps.writeFileBinary) {
      throw new Error('Cannot produce the Word deliverable: no binary file writer is available.');
    }

    const scope = this.analyzeDeps.getScope();
    // BUG (isolation/data-leak) — an `analyze` step is matter-scoped by
    // design (see the doc comment above). `getScope()` falls back to
    // `{ kind: 'allMatters' }` when no client is active; proceeding would
    // silently pull retrieval chunks from EVERY client's documents into one
    // generated report. Fail closed instead, mirroring the guard-throws above
    // for missing dependencies rather than degrading silently.
    if (scope.kind !== 'matter') {
      throw new Error(
        'Pick your client first.',
      );
    }
    const execution = this.execution;
    if (!execution) throw new Error('No workflow execution is active.');
    const inputs = execution.inputs;

    const callStart = Date.now();
    const callId = this.generateCallId();

    // Grounded, cited analysis. `analyzeKind` selects the pipeline; today the
    // litigation flagship is `'contradictions'`.
    const { result, chunks, retrievalQuery, retrievalUnavailable } = await runContradictionAnalysis({
      provider: this.auditedProvider(step),
      config,
      inputs,
      scope,
      retrieve: this.analyzeDeps.retrieve,
      verify: this.analyzeDeps.verifyCitation,
      interpolate: (tpl, values) => this.interpolateTemplate(tpl, values),
      promptPreparation: {
        ...(this.audit?.providerId ? { providerId: this.audit.providerId } : {}),
        ...(this.audit?.model ? { model: this.audit.model } : {}),
        ...(this.audit?.background !== undefined ? { background: this.audit.background } : {}),
        ...(this.audit?.onAuditLog ? { onAuditLog: this.audit.onAuditLog } : {}),
        ...(this.audit?.getScope ? { scope: this.audit.getScope() } : { scope }),
      },
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
      ...(typeof inputs['matterName'] === 'string' ? { matterName: inputs['matterName'] } : {}),
      ...(typeof inputs['witnessName'] === 'string' ? { witnessName: inputs['witnessName'] } : {}),
      ...(typeof inputs['depositionDate'] === 'string'
        ? { depositionDate: inputs['depositionDate'] }
        : {}),
      // VG-3b — the deliverable says what grounded it. Retrieval down but
      // excerpts pasted → analyzed only those, and the header says so. Empty
      // (but working) retrieval → the no-documents disclosure.
      ...(retrievalUnavailable
        ? { retrievalNote: 'Analyzed only the excerpts you provided; workspace retrieval was unavailable for this run.' }
        : chunks.length === 0
          ? { retrievalNote: 'No client documents were retrieved; this analysis covers only the excerpts you provided.' }
          : {}),
    };
    const bytes = await this.analyzeDeps.serializeContradictions(result, meta);
    // VG-4c — put the deliverable on the firm letterhead if one is configured
    // (opt-in; fail-open). Applied to the serialized bytes, AFTER the retrieval
    // note is rendered into `meta`, so the disclosure is never disturbed.
    const { applyLetterheadIfConfigured } = await import('@/platform/utils/docx-io');
    const finalBytes = await applyLetterheadIfConfigured(bytes);
    // BUG F3(1a) — interpolate (and sanitize) the output path the same way
    // `generate` does, so e.g. `{{matterName}}/Contract Review - {{contractType}}.docx`
    // lands under the real client's folder instead of the literal placeholder.
    const outputFile = this.interpolateOutputPath(config.outputFile, inputs);
    await this.fileOps.writeFileBinary(outputFile, finalBytes);
    this.emitFileCreateAudit(outputFile, step);

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
        outputFile,
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
      [`${step.id}_file`]: outputFile,
      [`${step.id}_scope`]: scope,
    };
  }

  /**
   * Interpolate variables in a template string. `transform`, when supplied,
   * post-processes each SUBSTITUTED VALUE (never the template's own literal
   * text) after it's been stringified — used by `interpolateOutputPath`
   * below to sanitize values going into a filesystem path without
   * duplicating the substitution loop.
   */
  private interpolateTemplate(
    template: string,
    values: Record<string, unknown>,
    transform?: (value: string) => string,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = values[key];
      if (value === undefined) {
        return `{{${key}}}`;
      }
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      return transform ? transform(stringValue) : stringValue;
    });
  }

  /**
   * BUG F3(1a) — interpolate `{{var}}` placeholders in an `outputFile`
   * template, but sanitize each SUBSTITUTED VALUE before insertion: `/`,
   * `\`, control characters, and the other characters Windows forbids in a
   * file/folder name (`: ? * " < > |` — the same set `PathValidator.
   * validateName` blocks elsewhere in this codebase) are replaced with a
   * dash/stripped, so a user-entered interview answer (e.g. a household name
   * like "Smith / Jones", a contract type like "NDA: Vendor") can never (a)
   * inject extra path segments or something resembling a traversal
   * sequence, or (b) produce a filename that fails to save on the app's
   * primary Windows target after the AI work is already done.
   *
   * The template's OWN literal `/` separators (e.g. the folder in
   * `{{matterName}}/Contract Review - {{contractType}}.docx`) are left
   * untouched, since `transform` only ever sees the replaced VALUES, never
   * the template string itself. This is a light guard, not full
   * path-traversal validation — `PathValidator`/`WorkspaceService` downstream
   * already reject `../` and workspace-escaping paths; this just avoids
   * defeating that backstop by handing it an already-mangled path.
   */
  private interpolateOutputPath(
    template: string,
    values: Record<string, unknown>
  ): string {
    return this.interpolateTemplate(template, values, (value) =>
      value
        // Sanitization choice: `/`, `\`, and the Windows-forbidden filename
        // characters all become `-` — a single dash reads cleanly (e.g.
        // "Smith / Jones" -> "Smith - Jones", "NDA: Vendor" -> "NDA- Vendor").
        .replace(/[/\\:?*"<>|]/g, '-')
        // Strip control characters outright (avoid a regex control-char
        // range so this doesn't trip `no-control-regex`).
        .split('')
        .filter((ch) => ch.charCodeAt(0) > 0x1f)
        .join(''),
    );
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
    return `run_${Date.now().toString()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate a unique call ID
   */
  private generateCallId(): string {
    return `call_${Date.now().toString()}_${Math.random().toString(36).slice(2, 9)}`;
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
