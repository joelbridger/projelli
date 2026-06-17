// TemplateMetadataReader — adapts an installed marketplace template directory
// (manifest.json + workflow.json + optional questions.json) into the existing
// `WorkflowTemplate` shape consumed by the rest of the app.
//
// Lives next to MarketplaceService rather than inside `modules/workflow/` so
// the workflow module stays free of marketplace-specific concerns. Failures
// during read/parse are reported as audit events (`template_install_failed`)
// + console warnings; the engine just sees a shorter list rather than crashing.

import type { FSBackend } from '@/platform/fs/types';
import type { WorkflowTemplate, InterviewQuestion } from '@/types/workflow';
import type { InstalledEntry } from '@/features/workflows/types/marketplace';
import type { TemplateManifest } from '@/features/workflows/types/templateManifest';
import { AuditService } from '@/platform/audit/AuditService';
import { validateTemplateManifest } from './manifestValidator';
import type { MarketplaceService } from './MarketplaceService';

/**
 * Prefix applied to community-installed template ids in the merged template
 * surface. Avoids collision with built-in ids and makes the source obvious in
 * audit logs.
 */
export const COMMUNITY_TEMPLATE_ID_PREFIX = 'community:';

export interface TemplateMetadataReaderOptions {
  fs: FSBackend;
  /** Audit service used to log skipped entries. Defaults to a fresh one. */
  auditService?: AuditService;
}

/**
 * Reads installed-template files from disk and adapts them into the engine's
 * `WorkflowTemplate` shape. Failures don't crash callers; `list()` skips bad
 * entries with a warning + audit event.
 */
export class TemplateMetadataReader {
  private readonly fs: FSBackend;
  private readonly auditService: AuditService;

  constructor(opts: TemplateMetadataReaderOptions) {
    this.fs = opts.fs;
    this.auditService = opts.auditService ?? new AuditService('marketplace');
  }

  /**
   * Read a single installed entry and return a WorkflowTemplate.
   *
   * Throws on missing or invalid files; callers (`list()` or test code) decide
   * how to handle failures.
   */
  async readInstalled(entry: InstalledEntry): Promise<WorkflowTemplate> {
    const root = entry.installedPath;
    const manifestRaw = await this.fs.read(`${root}/manifest.json`);
    const manifestParsed = JSON.parse(manifestRaw);
    const validated = validateTemplateManifest(manifestParsed);
    if (!validated.ok) {
      throw new Error(
        `Manifest invalid for ${entry.id}: ${validated.errors.join('; ')}`,
      );
    }
    const manifest = validated.manifest;

    const workflowRaw = await this.fs.read(`${root}/workflow.json`);
    const workflowParsed = JSON.parse(workflowRaw) as Partial<WorkflowTemplate>;

    const questions = await this.readOptionalQuestions(root);

    return adaptToWorkflowTemplate(entry, manifest, workflowParsed, questions);
  }

  /**
   * Read every installed entry from `service` and adapt them into
   * `WorkflowTemplate[]`. Entries that fail to parse are skipped with a
   * `console.warn` + audit `template_install_failed` event so the user can see
   * why a template they expect isn't surfacing.
   */
  async list(service: MarketplaceService): Promise<WorkflowTemplate[]> {
    const installed = await service.listInstalled();
    const out: WorkflowTemplate[] = [];
    for (const entry of installed) {
      try {
        out.push(await this.readInstalled(entry));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(
          `[marketplace] Skipping installed template ${entry.id}: ${message}`,
        );
        this.auditService.append({
          type: 'template_install_failed',
          timestamp: new Date().toISOString(),
          payload: {
            templateId: entry.id,
            version: entry.version,
            error: `Read failed: ${message}`,
          },
        });
      }
    }
    return out;
  }

  /**
   * `questions.json`, when present, provides interview questions that can be
   * spliced into the first interview step. Optional: many templates encode
   * their questions directly in `workflow.json`.
   */
  private async readOptionalQuestions(
    root: string,
  ): Promise<InterviewQuestion[] | undefined> {
    try {
      const raw = await this.fs.read(`${root}/questions.json`);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as InterviewQuestion[];
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { questions?: unknown }).questions)
      ) {
        return (parsed as { questions: InterviewQuestion[] }).questions;
      }
    } catch {
      // questions.json is optional; silently skip on read or parse error.
    }
    return undefined;
  }
}

/**
 * Bolt the manifest + workflow + optional questions into the canonical
 * `WorkflowTemplate` shape.
 *
 * - id is prefixed with `community:` to avoid collision with built-ins.
 * - Required fields fall back from workflow.json -> manifest -> safe defaults.
 * - `provenance: 'community'` and `sourceId: entry.id` are stamped so the
 *   workflow panel can render the right badge and uninstall flow can locate
 *   the install by its original id.
 */
function adaptToWorkflowTemplate(
  entry: InstalledEntry,
  manifest: TemplateManifest,
  workflow: Partial<WorkflowTemplate>,
  questions: InterviewQuestion[] | undefined,
): WorkflowTemplate {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const stepsWithQuestions = questions ? injectQuestions(steps, questions) : steps;

  // Categories: WorkflowTemplate.category is a closed union; map unknown
  // values from the manifest to 'custom' rather than rejecting the install.
  const allowed: WorkflowTemplate['category'][] = [
    'kickoff',
    'research',
    'analysis',
    'planning',
    'custom',
  ];
  const rawCategory = (workflow.category ?? manifest.category) as WorkflowTemplate['category'];
  const category = allowed.includes(rawCategory) ? rawCategory : 'custom';

  const adapted: WorkflowTemplate = {
    id: `${COMMUNITY_TEMPLATE_ID_PREFIX}${entry.id}`,
    name: workflow.name ?? manifest.name,
    description: workflow.description ?? manifest.description,
    version: workflow.version ?? manifest.version,
    category,
    steps: stepsWithQuestions,
    requiredInputs: workflow.requiredInputs ?? [],
    outputs: workflow.outputs ?? [],
    provenance: 'community',
    sourceId: entry.id,
  };
  if (workflow.namedOutputs) adapted.namedOutputs = workflow.namedOutputs;
  if (workflow.namedInputs) adapted.namedInputs = workflow.namedInputs;
  if (workflow.defaultProvider) adapted.defaultProvider = workflow.defaultProvider;
  if (workflow.defaultModel) adapted.defaultModel = workflow.defaultModel;
  return adapted;
}

/**
 * If `questions.json` was supplied alongside `workflow.json`, splice them
 * into the first `interview` step's config. Templates that already encode
 * questions inline in workflow.json keep their inline copy (questions.json
 * acts as an override only when the inline list is empty).
 */
function injectQuestions(
  steps: WorkflowTemplate['steps'],
  questions: InterviewQuestion[],
): WorkflowTemplate['steps'] {
  let injected = false;
  return steps.map((step) => {
    if (injected) return step;
    if (step.type !== 'interview') return step;
    const cfg = step.config as { questions?: InterviewQuestion[] };
    if (cfg.questions && cfg.questions.length > 0) return step;
    injected = true;
    return { ...step, config: { ...cfg, questions } };
  });
}
