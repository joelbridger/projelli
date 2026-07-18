/**
 * useWorkflowRunner — owns workflow execution state and handlers.
 *
 * Extracted from App.tsx (Phase 3 decomposition). The 6 handler bodies are
 * copied VERBATIM from App.tsx; only the source of the referenced values
 * changed (they now come from the options object instead of App's local
 * scope, or from the hook's own state directly).
 */
import { useState, useCallback, useRef } from 'react';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { saveFile } from '@/platform/utils/saveFile';
import { workspacePath } from '@/platform/fs/appPath';
import { readSelectionOperationDecision } from '@/platform/client-context';
import { matterLabel } from '@/platform/rag/matterResolver';
import {
  resolveTemplateModel,
  resolveWorkflowProvider,
  TEMPLATE_MODEL_OVERRIDES_KEY,
  type TemplateModelOverride,
} from '@/features/workflows/engine/resolveTemplateModel';
import { createWorkflowEngine } from '@/features/workflows/engine/WorkflowEngine';
import {
  appendCompletedInterviewAnswers,
  buildWorkflowFilename,
  executionToFileData,
  resolveWorkflowArtifactPath,
  resolveWorkflowReadPath,
} from '@/features/workflows/engine/workflowFile';
import { retryWithBackoff } from '@/lib/retryWithBackoff';
import { createMockProvider } from '@/platform/providers/MockProvider';
import { OPENAI_DEFAULT_MODEL } from '@/platform/providers/OpenAIProvider';
import { detectOllama, OLLAMA_DEFAULT_MODEL } from '@/platform/providers/OllamaProvider';
import { createProvider } from '@/platform/providers/providerFactory';
import { isEmbeddedLocalModelReady } from '@/platform/providers/resolveLocalProvider';
import { modeRestrictsToLocal } from '@/platform/privacy/egress';
import { assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import {
  cloudKeyPresenceFromValues,
  resolveCloudSettingsDefaults,
  resolvePreferredCloudProvider,
  toTemplateProviderId,
  type CloudProviderKeyValues,
} from '@/platform/providers/resolvePreferredCloudProvider';
import { getInvalidProviders, getVerifiedProviders } from '@/platform/providers/keyVerification';
import {
  PROFESSION_MODEL_STORAGE_KEY,
  PROFESSION_PROVIDER_STORAGE_KEY,
} from '@/platform/profile/professionModel';
import { MemoryService } from '@/platform/rag/MemoryService';
import { filterHitsForExportConsent } from '@/platform/rag/exportConsent';
import { ragVerifyCitation, type RetrievalScope } from '@/platform/utils/tauri-commands';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import type { AuditEntry, AuditScope } from '@/platform/types/audit';
import type { Provider } from '@/platform/providers/Provider';
import type {
  WorkflowTemplate,
  WorkflowExecution,
  InterviewQuestion,
  WorkflowFileData,
} from '@/platform/types/workflow';
import type { APIKey } from '@/platform/types/ai';
import type { RunRecord } from '@/platform/types/workflow';
import type { FileNode } from '@/platform/types/workspace';
import type { Matter } from '@/platform/types/matter';
import type {
  TemplateMetadataReader,
  MarketplaceService,
} from '@/features/workflows/marketplace/svc';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';
import { SK_FIRM_NAME } from '@/config/identity';

export interface UseWorkflowRunnerOptions {
  rootPath: string | null;
  isTestMode: boolean;
  apiKeys: APIKey[];
  completeRun: (run: RunRecord) => void;
  openTab: (
    path: string,
    name: string,
    content: string,
    type?: 'file' | 'browser' | 'ai-assistant' | 'workflow-execution' | 'email',
    metadata?: { url?: string; favicon?: string; mailSourceId?: string },
  ) => void;
  setFileTree: (tree: FileNode[]) => void;
  addAuditEntry: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  workspaceServiceRef: React.MutableRefObject<{
    exists: (path: string) => Promise<boolean>;
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    writeFileBinary: (path: string, content: ArrayBuffer) => Promise<void>;
    mkdir: (path: string) => Promise<void>;
    delete: (path: string) => Promise<void>;
    getFileTree: () => Promise<FileNode[]>;
  } | null>;
  templatesMetadataReaderRef: React.MutableRefObject<TemplateMetadataReader | null>;
  templatesMarketplaceServiceRef: React.MutableRefObject<MarketplaceService | null>;
}

function resolveWorkflowRunFolderPath(
  _rootPath: string,
  activeMatter: Matter,
  workflowFolderName: string,
): string {
  const clientRoot = activeMatter.folderPaths[0];
  if (!clientRoot) {
    throw new Error('Pick your client first.');
  }
  return workspacePath(clientRoot, `Documents/Workflows/${workflowFolderName}`);
}

function workflowDocumentType(path: string | undefined): string {
  const lower = path?.toLowerCase() ?? '';
  if (lower.endsWith('.docx')) return 'Word document';
  if (lower.endsWith('.pdf')) return 'PDF';
  if (lower.endsWith('.pptx')) return 'presentation';
  if (lower.endsWith('.xlsx')) return 'spreadsheet';
  if (lower.endsWith('.md')) return 'Markdown document';
  if (lower.endsWith('.txt')) return 'text document';
  return 'workflow document';
}

function enrichWorkflowRunRecord(opts: {
  runRecord: RunRecord;
  workflowFolderPath: string;
  artifacts: string[];
  clientName: string | null;
  templateName: string;
}): RunRecord {
  const firstArtifact = opts.artifacts[0];
  const primaryArtifactPath = firstArtifact
    ? resolveWorkflowArtifactPath(opts.workflowFolderPath, firstArtifact)
    : null;
  const documentType = workflowDocumentType(firstArtifact);
  const displayTitle = opts.clientName
    ? `${opts.clientName} - ${documentType}`
    : `${opts.templateName} - ${documentType}`;
  return {
    ...opts.runRecord,
    outputs: {
      ...opts.runRecord.outputs,
      displayTitle,
      documentType,
      ...(opts.clientName ? { clientName: opts.clientName } : {}),
      ...(firstArtifact ? { primaryArtifactName: firstArtifact } : {}),
      ...(primaryArtifactPath ? { primaryArtifactPath } : {}),
    },
  };
}

export function useWorkflowRunner(options: UseWorkflowRunnerOptions) {
  const {
    rootPath,
    isTestMode,
    apiKeys,
    completeRun,
    openTab,
    setFileTree,
    addAuditEntry,
    workspaceServiceRef,
    templatesMetadataReaderRef,
    templatesMarketplaceServiceRef,
  } = options;

  // Workflow state (moved verbatim from App.tsx)
  const [currentExecution, setCurrentExecution] = useState<WorkflowExecution | null>(null);
  const [activeWorkflowTemplate, setActiveWorkflowTemplate] = useState<WorkflowTemplate | null>(null);
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[] | null>(null);
  const [interviewResolver, setInterviewResolver] = useState<((answers: Record<string, string>) => void) | null>(null);
  const [interviewRejecter, setInterviewRejecter] = useState<((error: Error) => void) | null>(null);
  const [showInterviewDialog, setShowInterviewDialog] = useState(false);
  const [activeWorkflowFilePath, setActiveWorkflowFilePath] = useState<string | null>(null);
  const [workflowProviderError, setWorkflowProviderError] = useState<'needs-provider' | 'ollama-unreachable' | 'needs-client' | null>(null);
  // Existing surfaced workflow error channel. It carries terminal record-write
  // failures and authoritative selection refusals, so neither disk risk nor a
  // stale/unresolved client is reduced to a silent early return.
  const [workflowSaveError, setWorkflowSaveError] = useState<string | null>(null);
  const workflowStartInFlightRef = useRef(false);

  // Handle starting a workflow
  const handleStartWorkflow = useCallback(
    async (template: WorkflowTemplate) => {
      if (workflowStartInFlightRef.current) return;
      workflowStartInFlightRef.current = true;
      try {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Fix 4 — clear any error from a previous blocked run so that the
      // currently-active tab (which may be a completed workflow) is not
      // rendered as a blocking screen while this new attempt is in flight.
      // The error is scoped to this invocation and set/cleared only here.
      setWorkflowProviderError(null);
      // A fresh run gets a fresh chance to save its record cleanly.
      setWorkflowSaveError(null);

      // Compute the folder path early so we can derive the run metadata.
      // The folder itself is NOT created yet — we wait until provider
      // resolution succeeds so a blocked run leaves nothing on disk (Fix 3).
      const startTime = new Date();
      const timestamp = startTime.toISOString().replace(/:/g, '-').replace(/\..+/, '').replace('T', '_');
      const workflowFolderName = `${template.name} - ${timestamp}`;
      const initialSelection = readSelectionOperationDecision({
        operationClass: 'matter-scoped',
        allowAllMatters: false,
        requireFollowerAgreement: true,
      });
      if (initialSelection.kind !== 'matter' || !initialSelection.matter.folderPaths[0]) {
        setWorkflowProviderError('needs-client');
        setWorkflowSaveError(
          initialSelection.kind === 'refused'
            ? initialSelection.message
            : 'Choose one client before running this workflow.',
        );
        return;
      }
      const activeMatter = initialSelection.matter;
      const assertCurrentWorkflowSelection = (): void => {
        const current = readSelectionOperationDecision({
          operationClass: 'matter-scoped',
          allowAllMatters: false,
          requireFollowerAgreement: true,
          expectedScope: { kind: 'matter', matterId: activeMatter.id },
        });
        if (current.kind === 'refused') {
          setWorkflowProviderError('needs-client');
          setWorkflowSaveError(current.message);
          throw new Error(current.message);
        }
      };
      const clientName = matterLabel(activeMatter);
      const workflowFolderPath = resolveWorkflowRunFolderPath(rootPath, activeMatter, workflowFolderName);

      // Load AI Rules if available — needed before resolution so it can be
      // threaded into the provider constructor below.
      let aiRulesContent: string | undefined;
      try {
        const rulesPath = workspacePath(rootPath, 'ai-rules.md');
        const exists = await workspaceServiceRef.current.exists(rulesPath);
        if (exists) {
          aiRulesContent = await workspaceServiceRef.current.readFile(rulesPath);
        }
      } catch (error) {
        console.debug('No AI rules file found:', error);
      }

      // F-106/F-107 — Provider resolution for workflows.
      //
      // Resolution order (highest priority first):
      //   1. Explicit per-template override (user pinned in Settings > Templates)
      //   2. Template's own defaultProvider / defaultModel
      //   3. Global default (first available cloud key)
      //
      // Safety invariants (enforced by the pure resolveWorkflowProvider helper
      // which is unit-tested in tests/unit/workflow/):
      //   - ollama-pinned + unreachable  → 'ollama-unreachable' (NEVER 'cloud')
      //   - no key + !testMode           → 'needs-provider'     (NEVER 'mock')
      //   - no key + testMode            → 'mock'
      const invalidProviders = getInvalidProviders();
      const verifiedProviders = getVerifiedProviders();
      const rawAnthropicKey = apiKeys.find((k) => k.provider === 'anthropic')?.key;
      const rawOpenaiKey = apiKeys.find((k) => k.provider === 'openai')?.key;
      const rawGoogleKey = apiKeys.find((k) => k.provider === 'google')?.key;
      const anthropicKey = invalidProviders.has('anthropic') ? undefined : rawAnthropicKey;
      const openaiKey = invalidProviders.has('openai') ? undefined : rawOpenaiKey;
      const googleKey = invalidProviders.has('google') ? undefined : rawGoogleKey;
      const cloudKeys: CloudProviderKeyValues = {
        anthropic: anthropicKey,
        openai: openaiKey,
        google: googleKey,
      };

      // Q8 — honor the template's own default provider/model plus any
      // per-template override the user pinned in Settings.
      const overrides =
        (useSettingsStore.getState().getSetting<
          Record<string, TemplateModelOverride> | undefined
        >(TEMPLATE_MODEL_OVERRIDES_KEY) ?? {});
      const settings = useSettingsStore.getState();
      const globalCloudDefault = resolvePreferredCloudProvider({
        availableKeys: cloudKeyPresenceFromValues(cloudKeys),
        settings: resolveCloudSettingsDefaults(
          settings.getSetting('defaultProvider'),
          settings.getSetting('defaultModel'),
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)
            : null,
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)
            : null,
        ),
        verifiedProviders,
        invalidProviders,
      });
      const globalDefault: TemplateModelOverride = globalCloudDefault
        ? {
            provider: toTemplateProviderId(globalCloudDefault.provider),
            model: globalCloudDefault.model,
          }
        : { provider: 'claude', model: '' };
      const resolution = resolveTemplateModel({
        template,
        overrides,
        globalDefault,
      });

      const pickedProvider = resolution.provider;
      const pickedModel = resolution.model || undefined;

      // F-107 — probe Ollama reachability when the template is pinned to it.
      // We pass the result into the pure helper rather than doing the async
      // check inside it, keeping resolveWorkflowProvider synchronous/testable.
      // F-502 — ALSO probe in local-only confidentiality mode: the resolver
      // must land on an installed local model (or block honestly) no matter
      // what the template/global default says, so it needs reachability plus
      // the installed tag list.
      const localOnly = modeRestrictsToLocal(getConfidentialityMode());
      // F-503 — in private mode prefer the embedded Lantern Local AI when its
      // model is downloaded + ready (it needs no separate Ollama daemon), the
      // same on-device default Ask / Chat / Client Map use. Probe it first; only
      // probe Ollama if the embedded model isn't ready, so a machine with the
      // embedded model but no Ollama still runs private-mode workflows.
      let localModelReady = false;
      if (localOnly) {
        localModelReady = await isEmbeddedLocalModelReady();
      }
      let ollamaReachable = false;
      let installedOllamaModels: string[] = [];
      if ((pickedProvider === 'ollama' || localOnly) && !localModelReady) {
        const ollamaStatus = await detectOllama();
        ollamaReachable = ollamaStatus.reachable;
        installedOllamaModels = ollamaStatus.models;
      }

      // Pure resolution — decides kind, never creates providers or side-effects.
      const providerResolution = resolveWorkflowProvider({
        pickedProvider,
        pickedModel,
        anthropicKey,
        openaiKey,
        googleKey,
        ollamaReachable,
        isTestMode,
        localOnly,
        installedOllamaModels,
        localModelReady,
      });

      // Handle the two early-return blocking cases BEFORE creating the folder
      // (Fix 3 — no empty folder litter on blocked runs).
      if (providerResolution.kind === 'needs-provider') {
        setWorkflowProviderError('needs-provider');
        return;
      }
      if (providerResolution.kind === 'ollama-unreachable') {
        setWorkflowProviderError('ollama-unreachable');
        return;
      }

      // Provider resolution succeeded — create the workflow folder now.
      try {
        assertCurrentWorkflowSelection();
        await workspaceServiceRef.current.mkdir(workflowFolderPath);
        console.log(`Created workflow folder: ${workflowFolderName}`);
      } catch (error) {
        console.error('Failed to create workflow folder:', error);
        return;
      }

      // Stable runId — both the live execution state and the persisted
      // file share this id so MainPanel can match the live engine to the
      // file's tab and prefer the in-memory state over the on-disk
      // snapshot during a running execution.
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const workflowFilename = buildWorkflowFilename(template, startTime);
      const workflowFilePath = `${workflowFolderPath}/${workflowFilename}`;

      // Track artifacts and completed interview answers as the engine runs.
      // These accumulate alongside execution state and get written into the
      // .workflow file on every flush.
      const artifacts: string[] = [];
      let completedAnswers: { stepName: string; answers: Record<string, string> }[] = [];
      let lastSeenStepIndex = -1;

      // Debounced write helper. Holds the most recent file payload and
      // flushes after 1.5s of quiet. Terminal-state writes use
      // `flushImmediate=true` so completion / failure / cancellation
      // always lands on disk synchronously.
      let pendingFileData: WorkflowFileData | null = null;
      let writeTimer: ReturnType<typeof setTimeout> | null = null;
      // BUG F2 — returns whether the write actually landed, so terminal-write
      // callers (below) can tell a real failure apart from success instead of
      // getting false confidence from an always-resolving promise. Debounced
      // mid-run snapshots (via `scheduleWrite`) still fire-and-forget this and
      // ignore the result — a missed intermediate snapshot is low-stakes, the
      // next one lands seconds later.
      const writeFileNow = async (data: WorkflowFileData): Promise<boolean> => {
        // A definitive write supersedes any pending debounced snapshot. Cancel the
        // pending timer + payload so a stale in-flight "running" snapshot can't land
        // AFTER a terminal "completed"/"failed" write and revert it. Without this, the
        // last step's debounced write (scheduled ~1.5s earlier in onProgress) fired
        // after the awaited terminal write and reverted the .workflow file to
        // "running" — leaving the workflow tab stuck on "Generating" forever even
        // though the run had finished and the deliverable was on disk.
        if (writeTimer) {
          clearTimeout(writeTimer);
          writeTimer = null;
        }
        pendingFileData = null;
        try {
          assertCurrentWorkflowSelection();
          const json = JSON.stringify(data, null, 2);
          await workspaceServiceRef.current!.writeFile(workflowFilePath, json);
          // Keep the open tab's in-memory content in lockstep with disk so
          // MainPanel re-renders WorkflowExecutionTab against the latest
          // snapshot if the user clicks away and back.
          useEditorStore.getState().updateContent(workflowFilePath, json);
          // Flag the tab as saved so the dirty indicator stays clean.
          useEditorStore.getState().markSaved(workflowFilePath);
          return true;
        } catch (err) {
          console.warn('[workflow] Failed to write .workflow file:', err);
          return false;
        }
      };
      // BUG F2 (data-loss) — the TERMINAL write (run completed/failed/
      // cancelled) is the durable audit/replay record for the whole run, so
      // a silent failure here is much worse than a missed mid-run snapshot:
      // the deliverable file may exist on disk while the .workflow record is
      // stuck showing "running" forever, or simply missing, with zero
      // indication anything went wrong. Retry a few times (transient FS
      // hiccups — disk momentarily busy, permission blip — are the most
      // likely real-world cause); if every attempt still fails, surface it
      // both to the user (workflowSaveError, rendered via the existing
      // Callout on the workflows home) and to the audit log, so "just a
      // console.warn" is never the final state.
      const TERMINAL_WRITE_RETRY_DELAYS_MS = [300, 600];
      const writeTerminalFileWithRetry = async (data: WorkflowFileData): Promise<void> => {
        const ok = await retryWithBackoff(() => writeFileNow(data), TERMINAL_WRITE_RETRY_DELAYS_MS);
        if (ok) return;
        const message =
          "This run's saved record may be missing or out of date — the generated document(s) should still be fine, but the workflow's audit/replay history for this run might not be there.";
        setWorkflowSaveError(message);
        addAuditEntry({
          action: 'user_action',
          description: `Failed to save the run record for workflow "${data.template.name}" after ${String(TERMINAL_WRITE_RETRY_DELAYS_MS.length + 1)} attempts.`,
          model: undefined,
          inputs: { runId: data.runId, workflowFilePath, status: data.status },
          outputs: { success: false },
          userDecision: 'auto',
          metadata: { auditEventType: 'workflow_save_failed', feature: 'workflow' },
        });
      };
      const scheduleWrite = (data: WorkflowFileData, flushImmediate = false) => {
        pendingFileData = data;
        if (flushImmediate) {
          if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
          }
          void writeFileNow(data);
          return;
        }
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(() => {
          writeTimer = null;
          if (pendingFileData) void writeFileNow(pendingFileData);
        }, 1500);
      };

      // Provider assignment — construct the concrete Provider instance from
      // the resolution result. All blocking cases already returned above.
      let provider: Provider;
      if (providerResolution.kind === 'lantern-local') {
        // F-503 — embedded Lantern Local AI (private mode). Fully on-device,
        // zero cost, zero network egress. The model id is the provider's own
        // default; only AI Rules are threaded in.
        provider = createProvider({
          provider: 'lantern-local',
          ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
        });
        console.log(
          `Using embedded Lantern Local AI for workflow generation [source=${resolution.source}]`
        );
      } else if (providerResolution.kind === 'ollama') {
        // F-107 — Ollama branch. Reachability confirmed above; construct the
        // local provider. Zero cost, zero network egress.
        provider = createProvider({
          provider: 'ollama',
          model: providerResolution.model ?? OLLAMA_DEFAULT_MODEL,
          ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
        });
        console.log(
          `Using Ollama (${providerResolution.model ?? OLLAMA_DEFAULT_MODEL}) for workflow generation [source=${resolution.source}]`
        );
      } else if (providerResolution.kind === 'cloud') {
        // Personal-install choice gate (Task 1.3 fix): workflow generation is
        // cloud generation; block it until the user has made an explicit
        // confidentiality choice. The 'cloud' kind already excludes Ollama, so
        // no local-provider skip is needed here. Firm installs are a no-op
        // inside assertCloudGenerationAllowed (it checks isFirm first).
        assertCloudGenerationAllowed();
        const { provider: cloudProvider, model: cloudModel, key } = providerResolution;
        // One front door (fix F2.2): map the workflow's cloud id to the factory
        // id and build through createProvider, so workflow generation resolves
        // the SAME provider mapping as every other surface. The old Claude path
        // passed dangerouslySkipPermissions: true, but ClaudeProvider documents
        // that field as accepted-but-unused (no Claude API equivalent), so
        // dropping it is a no-op.
        const factoryId =
          cloudProvider === 'claude' ? 'anthropic' : cloudProvider === 'gemini' ? 'google' : 'openai';
        // Model: normally the resolved cloudModel. When it's undefined (the
        // BUG-025 key-mismatch fallback deliberately drops the pinned model so
        // the fallback provider uses ITS OWN default), preserve the pre-F2.2
        // behavior exactly — only OpenAI's factory free-tier default
        // (gpt-4o-mini) differs from its constructor default (gpt-4o); Anthropic
        // and Gemini match, so they need no override.
        const modelOpt = cloudModel
          ? { model: cloudModel }
          : factoryId === 'openai'
            ? { model: OPENAI_DEFAULT_MODEL }
            : {};
        provider = createProvider({
          provider: factoryId,
          apiKey: key,
          ...modelOpt,
          ...(aiRulesContent ? { aiRules: aiRulesContent } : {}),
        });
        console.log(
          `Using ${cloudProvider} API (${cloudModel ?? 'default'}) for workflow generation [source=${resolution.source}]`
        );
      } else {
        // mock — isTestMode only; resolveWorkflowProvider guarantees
        // we never reach this outside testMode.
        provider = createMockProvider();
        console.log('testMode: using mock provider (no real keys configured)');
      }

      const workflowAuditProvider =
        providerResolution.kind === 'cloud'
          ? providerResolution.provider === 'claude'
            ? 'anthropic'
            : providerResolution.provider === 'gemini'
              ? 'google'
              : providerResolution.provider
          : providerResolution.kind === 'ollama'
            ? 'ollama'
            : providerResolution.kind === 'lantern-local'
              ? 'lantern-local'
              : 'mock';
      const getWorkflowAuditScope = (): AuditScope => {
        assertCurrentWorkflowSelection();
        return { kind: 'matter', matterId: activeMatter.id };
      };

      const engine = createWorkflowEngine(
        provider,
        {
          writeFile: async (path: string, content: string) => {
            assertCurrentWorkflowSelection();
            // Write files inside the workflow folder. BUG F3(1b) — `path` is
            // already interpolated + sanitized by the engine and may contain
            // a template-authored subfolder (e.g. `Estate Planning/Client -
            // Summary.docx`); use it in full rather than stripping it down to
            // its basename, so that intended subfolder actually lands on
            // disk. `WorkspaceService.writeFile` creates missing parent
            // folders itself, and `PathValidator` still rejects `../`
            // traversal and workspace-escaping paths underneath this.
            const fullPath = resolveWorkflowArtifactPath(workflowFolderPath, path);
            await workspaceServiceRef.current!.writeFile(fullPath, content);
            // Track the artifact so the .workflow file has a record of
            // what the run produced.
            if (!artifacts.includes(path)) {
              artifacts.push(path);
            }
            // Refresh file tree after write
            const fileTree = await workspaceServiceRef.current!.getFileTree();
            setFileTree(fileTree);
          },
          readFile: async (path: string) => {
            assertCurrentWorkflowSelection();
            // Read from workflow folder if relative path, otherwise use
            // absolute. BUG F3(1b) — preserve any subfolder in a relative
            // path (same reasoning as writeFile above) rather than reading
            // only the basename.
            const fullPath = resolveWorkflowReadPath(workflowFolderPath, path);
            return workspaceServiceRef.current!.readFile(fullPath);
          },
          // WS-D — binary deliverables (the Word .docx a workflow produces) land
          // in the same workflow folder under the active matter. Tracked as an
          // artifact so the .workflow file records what the run produced.
          writeFileBinary: async (path: string, bytes: Uint8Array) => {
            assertCurrentWorkflowSelection();
            // BUG F3(1b) — use the full (already-interpolated, already-
            // sanitized) relative path, not just its basename, so an
            // outputFile like `Estate Planning/Client - Summary.docx` lands
            // in the intended subfolder instead of directly in the workflow
            // root.
            const fullPath = resolveWorkflowArtifactPath(workflowFolderPath, path);
            // ArrayBuffer slice keeps TS happy regardless of the byte view's offset.
            const buffer = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
            await workspaceServiceRef.current!.writeFileBinary(fullPath, buffer);
            if (!artifacts.includes(path)) {
              artifacts.push(path);
            }
            const fileTree = await workspaceServiceRef.current!.getFileTree();
            setFileTree(fileTree);
          },
        },
        // Interview handler - shows dialog and waits for user answers
        async (_stepId, questions) => {
          return new Promise<Record<string, string>>((resolve, reject) => {
            setInterviewQuestions(questions);
            setInterviewResolver(() => resolve);
            setInterviewRejecter(() => reject);
            setShowInterviewDialog(true);
          });
        },
        // Progress handler
        (stepIndex, stepName, status) => {
          console.log(`Workflow step ${stepIndex}: ${stepName} - ${status}`);
          const live = engine.getExecution();
          if (!live) return;
          setCurrentExecution({ ...live });
          // Build accumulated interview answers when we cross a step
          // boundary so the persisted file has the same structure the
          // tab UI displays.
          if (live.currentStepIndex > lastSeenStepIndex && live.currentStepIndex > 0) {
            completedAnswers = appendCompletedInterviewAnswers(
              completedAnswers,
              live.template,
              live.currentStepIndex - 1,
              live.inputs
            );
            lastSeenStepIndex = live.currentStepIndex;
          }
          // Schedule a debounced snapshot. Step transitions count as
          // "important enough" but not so urgent that we need to flush
          // synchronously — terminal states do that below.
          scheduleWrite(
            executionToFileData({
              execution: live,
              workflowFolderPath,
              completedAnswers,
              artifacts,
            })
          );
        },
        {
          // Stream C1 — Surface marketplace-installed templates alongside
          // built-ins on `engine.availableTemplates()`. Reader + service refs
          // are nullable until a workspace is loaded; the resolver returns []
          // in that case rather than throwing.
          getCommunityTemplates: async () => {
            const reader = templatesMetadataReaderRef.current;
            const svc = templatesMarketplaceServiceRef.current;
            if (!reader || !svc) return [];
            return reader.list(svc);
          },
          audit: {
            onAuditLog: addAuditEntry,
            providerId: workflowAuditProvider,
            model: provider.getMetadata().model,
            getConfidentialityMode,
            getScope: getWorkflowAuditScope,
            isDemo: IS_DEMO,
          },
          // WS-D — litigation `analyze` step dependencies. Retrieval is scoped to
          // the ACTIVE matter and privilege is EXCLUDED (the safe default on
          // MemoryService.retrieve). Every finding's citation is verified against
          // the local store via rag_verify_citation. The Word renderer is the
          // shared structured-deliverable serializer.
          analyzeDeps: {
            getScope: (): RetrievalScope => {
              assertCurrentWorkflowSelection();
              return { kind: 'matter', matterId: activeMatter.id };
            },
            retrieve: async (query, topK, scope, perSourceCap) => {
              // F-510 — the finder's per-source diversity cap rides through
              // (privilege stays EXCLUDED, the 4th positional default).
              // WS3d-A — default-OFF reranker toggle, read per call.
              const enableReranker =
                useSettingsStore.getState().getSetting<boolean>('enableReranker');
              const enableHybridSearch =
                useSettingsStore.getState().getSetting<boolean>('enableHybridSearch');
              // Connector-access: gate recognized RightCapital/Jump EXPORT chunks
              // here, at the workflow engine's injected retrieval, so a legal/tax/
              // consulting `analyze` step never AI-processes an exported report
              // before the advisor has consented. (legalAnalysis's own context
              // builder stays store-free; this is the right place to gate it.)
              const hits = filterHitsForExportConsent(
                await MemoryService.retrieve(
                  query,
                  topK,
                  scope,
                  false,
                  perSourceCap,
                  enableReranker,
                  enableHybridSearch,
                ),
              );
              // Audit (3.0 provenance) — the litigation `analyze` step runs a
              // matter-scoped, privilege-EXCLUDED retrieval (the safe default on
              // MemoryService.retrieve). Record the scope, the privilege
              // decision, and the result so the workflow's research is provable.
              const auditScope: AuditScope =
                scope.kind === 'matter'
                  ? { kind: 'matter', matterId: scope.matterId }
                  : { kind: 'allMatters' };
              const topScore = hits.reduce<number | null>(
                (max, h) => (max === null ? h.score : Math.max(max, h.score)),
                null,
              );
              addAuditEntry(auditEventToEntry({
                type: 'scope_active',
                timestamp: new Date().toISOString(),
                payload: { scope: auditScope },
              }));
              addAuditEntry(auditEventToEntry({
                type: 'privilege_evaluated',
                timestamp: new Date().toISOString(),
                payload: { excluded: true },
              }));
              addAuditEntry(auditEventToEntry({
                type: 'retrieval_executed',
                timestamp: new Date().toISOString(),
                payload: {
                  query,
                  scope: auditScope,
                  hitCount: hits.length,
                  topScore,
                  // F-510 — record the diversity cap only when one was applied.
                  ...(perSourceCap !== undefined ? { perSourceCap } : {}),
                },
              }));
              return hits;
            },
            verifyCitation: async (citationId, claimedMatterId, quotedText) => {
              const verdict = await ragVerifyCitation(citationId, claimedMatterId, quotedText);
              // CitationVerdict.verdict is one of verified|notFound|matterMismatch|
              // textMismatch — exactly the values the analysis pipeline records.
              // Audit (3.0 provenance) — record the verdict for each cited source.
              addAuditEntry(auditEventToEntry({
                type: 'citation_verified',
                timestamp: new Date().toISOString(),
                payload: { citationId, verdict: verdict.verdict },
              }));
              return verdict.verdict;
            },
            serializeContradictions: async (result, meta) => {
              const { serializeContradictionsDocx } = await import('@/platform/utils/docx-io');
              const firmName = (() => {
                try {
                  return localStorage.getItem(SK_FIRM_NAME) ?? '';
                } catch {
                  return '';
                }
              })();
              return serializeContradictionsDocx(result, meta, { firmName });
            },
          },
        }
      );

      try {
        const initialExecution: WorkflowExecution = {
          runId,
          template,
          currentStepIndex: 0,
          status: 'running',
          inputs: {},
          stepOutputs: [],
          startTime,
        };
        setCurrentExecution(initialExecution);
        setActiveWorkflowTemplate(template);
        setActiveWorkflowFilePath(workflowFilePath);

        // Initial snapshot. Status='running' so re-opening the file
        // mid-run shows the workflow tab in its starting state.
        const initialData = executionToFileData({
          execution: initialExecution,
          workflowFolderPath,
          completedAnswers: [],
          artifacts: [],
          status: 'running',
        });
        const initialJson = JSON.stringify(initialData, null, 2);
        assertCurrentWorkflowSelection();
        await workspaceServiceRef.current.writeFile(workflowFilePath, initialJson);

        // Open the workflow tab pointing at the real file path. Type stays
        // 'workflow-execution' so editor-store metadata is unchanged, but
        // MainPanel routes purely on `.workflow` extension.
        openTab(workflowFilePath, workflowFilename, initialJson, 'workflow-execution');

        // Refresh tree so the new file shows up in the sidebar before
        // execution starts.
        try {
          const fileTree = await workspaceServiceRef.current.getFileTree();
          setFileTree(fileTree);
        } catch {
          // Non-fatal: tree refresh failure shouldn't block the run.
        }

        // WS6 diagnostics — structural, gated, fire-and-forget. No content captured.
        void sendDiagnosticEvent({ event: 'feature_used', feature: 'workflow' }).catch(() => undefined);
        void sendDiagnosticEvent({ event: 'workflow_run', templateId: template.id }).catch(() => undefined);
        const runRecord = await engine.execute(template);

        // Final snapshot for the completed run. Pull the engine's last
        // execution state so endTime + final status are reflected.
        const finalExecution = engine.getExecution() ?? initialExecution;

        // The engine reports a user cancellation as status 'failed' with the
        // error message 'User cancelled' (the live status enum has no
        // 'cancelled' value).
        const userCancelled =
          finalExecution.status === 'failed' && finalExecution.error === 'User cancelled';

        // NEW-024: the user cancelled at the very first question, before any
        // work. The output folder + .workflow file were pre-created (and a tab
        // opened) before the interview, so a mis-clicked Run would otherwise
        // leave an empty orphan folder in Documents. Clean it all up and record
        // nothing — there's no run to keep.
        const cancelledBeforeWork =
          userCancelled &&
          artifacts.length === 0 &&
          completedAnswers.length === 0;
        if (cancelledBeforeWork) {
          // Cancel any debounced snapshot the onProgress handler scheduled for the
          // interview step before the cancel, so it can't write the folder back
          // after we delete it. The compiler can't see writeTimer being set inside
          // the onProgress closure, so it wrongly thinks this guard is dead.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
          pendingFileData = null;
          try {
            useEditorStore.getState().closeTab(workflowFilePath, { discard: true });
          } catch { /* tab may already be gone */ }
          try {
            await workspaceServiceRef.current.delete(workflowFolderPath);
          } catch (cleanupErr) {
            console.warn('[workflow] failed to remove cancelled workflow folder:', cleanupErr);
          }
          setCurrentExecution(null);
          setActiveWorkflowFilePath(null);
          try {
            setFileTree(await workspaceServiceRef.current.getFileTree());
          } catch { /* non-fatal */ }
          return;
        }

        completeRun(
          enrichWorkflowRunRecord({
            runRecord,
            workflowFolderPath,
            artifacts,
            clientName,
            templateName: template.name,
          }),
        );

        // Data-loss fix (Codex audit #9): AWAIT the terminal-state write so the
        // .workflow provenance/audit record is durably on disk (the old
        // fire-and-forget could leave it stale/"running" if the app closed right
        // after the run completed). BUG F2: `writeTerminalFileWithRetry` also
        // retries on failure and surfaces it if every attempt fails, instead of
        // awaiting a promise that always resolves even when the write failed.
        await writeTerminalFileWithRetry(
          executionToFileData({
            execution: finalExecution,
            workflowFolderPath,
            completedAnswers,
            artifacts,
            // A cancel that happened AFTER some work is recorded as 'cancelled'
            // (not the scarier 'failed'); a real error stays 'failed'.
            status: userCancelled
              ? 'cancelled'
              : finalExecution.status === 'failed'
                ? 'failed'
                : 'completed',
          }),
        );

        // Keep template around so the completed tab can still show output.
        // setActiveWorkflowTemplate is cleared only on cancel.
        setCurrentExecution(null);
        setActiveWorkflowFilePath(null);

        // Refresh file tree after workflow completes
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Workflow failed:', error);
        const failedExecution = engine.getExecution();
        if (failedExecution) {
          // Data-loss fix (Codex audit #9): await the terminal failure write too.
          // BUG F2: retry + surface on total failure, same as the success path.
          await writeTerminalFileWithRetry(
            executionToFileData({
              execution: failedExecution,
              workflowFolderPath,
              completedAnswers,
              artifacts,
              status: 'failed',
            }),
          );
        }
        setCurrentExecution(null);
        setActiveWorkflowFilePath(null);
      }
      } finally {
        workflowStartInFlightRef.current = false;
      }
    },
    [rootPath, setFileTree, completeRun, apiKeys, openTab, addAuditEntry]
  );

  // Handle interview form submission
  const handleInterviewSubmit = useCallback(
    (answers: Record<string, string>) => {
      if (interviewResolver) {
        interviewResolver(answers);
        setInterviewResolver(null);
        setInterviewRejecter(null);
        setInterviewQuestions(null);
        setShowInterviewDialog(false);
      }
    },
    [interviewResolver]
  );

  // Handle interview form cancel
  const handleInterviewCancel = useCallback(() => {
    // Reject the promise so the workflow engine knows the interview was cancelled
    if (interviewRejecter) {
      interviewRejecter(new Error('User cancelled'));
    }
    setShowInterviewDialog(false);
    setInterviewQuestions(null);
    setInterviewResolver(null);
    setInterviewRejecter(null);
    setCurrentExecution(null);
    setActiveWorkflowTemplate(null);
    setActiveWorkflowFilePath(null);
    // Cancellation flushes a `cancelled` status to the .workflow file via
    // the catch branch in handleStartWorkflow when the engine throws —
    // but if the user cancels before the engine has thrown back into the
    // try/catch, the snapshot may still report 'running'. The catch path
    // covers the common case; this is an acceptable trade-off.
  }, [interviewRejecter]);

  // Workflow execution tab: save output as a markdown file
  const handleWorkflowSaveAsFile = useCallback(
    async (content: string, suggestedName: string) => {
      try {
        await saveFile(content, {
          suggestedName,
          types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md'] } }],
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to save workflow output:', error);
        }
      }
    },
    []
  );

  // Workflow execution tab: export output as .docx
  const handleWorkflowExportDocx = useCallback(
    async (content: string, suggestedName: string) => {
      try {
        const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
        // Read firm name from localStorage — the WorkflowExecutionTab input persists it there
        const firmName = (() => {
          try { return localStorage.getItem(SK_FIRM_NAME) ?? ''; } catch { return ''; }
        })();
        const bytes = await markdownToDocxBytes(content, suggestedName, { firmName });
        await saveFile(bytes, {
          suggestedName,
          types: [
            {
              description: 'Word Documents',
              accept: {
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                  ['.docx'],
              },
            },
          ],
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to export workflow output as .docx:', error);
        }
      }
    },
    []
  );

  // Workflow execution tab: export output as .pptx
  // T3-4: When the output contains a ```json code fence with a valid SlideJSON
  // array (produced by NDA-Safe Slide Outliner and other deck workflows), the
  // structured path is used — themed slides, tables, and speaker notes. Falls
  // back to the plain markdown-to-pptx path when no slide JSON is present.
  const handleWorkflowExportPptx = useCallback(
    async (content: string, suggestedName: string) => {
      try {
        const pptxIo = await import('@/platform/utils/pptx-io');

        // Try the structured path first
        const slideJSON = (() => {
          const match = content.match(/```json\s*(\[[\s\S]*?\])\s*```/);
          if (!match) return null;
          try {
            const parsed = JSON.parse(match[1]!);
            if (
              Array.isArray(parsed) &&
              parsed.length > 0 &&
              typeof parsed[0]?.title === 'string' &&
              typeof parsed[0]?.layout === 'string'
            ) {
              return parsed as import('@/platform/utils/pptx-io').SlideJSON[];
            }
          } catch {
            // malformed JSON — fall through to markdown path
          }
          return null;
        })();

        const firmNameRaw = (() => {
          try { return localStorage.getItem(SK_FIRM_NAME) ?? ''; } catch { return ''; }
        })();
        const pptxOptions: import('@/platform/utils/pptx-io').PptxExportOptions = firmNameRaw
          ? { firmName: firmNameRaw }
          : {};

        const bytes = slideJSON
          ? await pptxIo.buildPptxFromSlideJSON(slideJSON, pptxOptions)
          : await pptxIo.markdownToPptxBytes(content);

        await saveFile(bytes, {
          suggestedName,
          types: [
            {
              description: 'PowerPoint Presentations',
              accept: {
                'application/vnd.openxmlformats-officedocument.presentationml.presentation':
                  ['.pptx'],
              },
            },
          ],
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to export workflow output as .pptx:', error);
        }
      }
    },
    []
  );

  return {
    currentExecution,
    activeWorkflowTemplate,
    showInterviewDialog,
    setShowInterviewDialog,
    interviewQuestions,
    workflowProviderError,
    workflowSaveError,
    activeWorkflowFilePath,
    handleStartWorkflow,
    handleInterviewSubmit,
    handleInterviewCancel,
    handleWorkflowSaveAsFile,
    handleWorkflowExportDocx,
    handleWorkflowExportPptx,
  };
}
