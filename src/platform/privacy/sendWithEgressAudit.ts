import { auditEventToEntry } from '@/platform/audit/AuditService';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import type { Provider, ProviderResponse, SendOptions } from '@/platform/providers/Provider';
import { assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
import {
  resolveEgress,
  type ConfidentialityMode,
  type EgressInfo,
} from '@/platform/privacy/egress';
import type { AuditEntry, AuditScope } from '@/platform/types/audit';

export type EgressAuditLogger = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;

export interface EgressAuditContext {
  provider: Provider;
  /** Concrete provider id, because cloud provider metadata does not always carry it. */
  providerId: string;
  /** Concrete model id/name, if the resolver already knows it. */
  model?: string;
  onAuditLog?: EgressAuditLogger;
  /** The scope this send was allowed to read from. */
  scope?: AuditScope;
  /** Whether file-read tools were registered for this send. */
  fileToolsEnabled?: boolean;
  /** Override when the route was frozen before the live setting could change. */
  mode?: ConfidentialityMode;
  /** Override the value stored in the audit row when it differs from resolve mode. */
  auditMode?: ConfidentialityMode | ((egress: EgressInfo) => ConfidentialityMode);
  isDemo?: boolean;
  hasDemoByokKey?: boolean;
  assuredAvailable?: boolean;
}

export interface RunWithEgressAuditOptions<T> extends EgressAuditContext {
  operation: () => Promise<T>;
  modelCall?: (result: T) => Omit<AuditEntry, 'id' | 'timestamp'> | null | undefined;
}

export interface SendWithEgressAuditOptions extends EgressAuditContext {
  prompt: string;
  options?: SendOptions;
  modelCall?: {
    description: string;
    inputs?: Record<string, unknown>;
    outputs?: (response: ProviderResponse) => Record<string, unknown>;
    metadata?: Record<string, unknown>;
    userDecision?: 'approved' | 'rejected' | 'auto';
  };
}

function effectiveModel(ctx: EgressAuditContext): string {
  return ctx.model ?? ctx.provider.getMetadata().model;
}

/**
 * Shared safety door for non-streaming AI work.
 *
 * It re-checks the Local-only switch, writes the egress audit row BEFORE the
 * provider call, then runs the model operation. Callers can use `modelCall` to
 * append the matching model_call row after a successful result.
 */
export async function runWithEgressAudit<T>(
  opts: RunWithEgressAuditOptions<T>,
): Promise<T> {
  assertLocalOnlyAllowsSend(opts.providerId);

  const modeForResolution = opts.mode ?? getConfidentialityMode();
  const egress = resolveEgress({
    provider: opts.providerId,
    mode: modeForResolution,
    isDemo: opts.isDemo ?? false,
    hasDemoByokKey: opts.hasDemoByokKey ?? false,
    assuredAvailable: opts.assuredAvailable ?? false,
  });
  const modeForAudit =
    typeof opts.auditMode === 'function'
      ? opts.auditMode(egress)
      : opts.auditMode ?? modeForResolution;

  opts.onAuditLog?.(auditEventToEntry({
    type: 'egress',
    timestamp: new Date().toISOString(),
    payload: {
      provider: egress.provider,
      model: effectiveModel(opts),
      mode: modeForAudit,
      destination: egress.destination,
      dataLeaves: egress.dataLeaves,
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.fileToolsEnabled !== undefined ? { fileToolsEnabled: opts.fileToolsEnabled } : {}),
    },
  }));

  const result = await opts.operation();
  const modelCall = opts.modelCall?.(result);
  if (modelCall) {
    opts.onAuditLog?.(modelCall);
  }
  return result;
}

export async function sendWithEgressAudit(
  opts: SendWithEgressAuditOptions,
): Promise<ProviderResponse> {
  const model = effectiveModel(opts);
  const { prompt, options, modelCall, ...context } = opts;
  const runOpts: RunWithEgressAuditOptions<ProviderResponse> = {
    ...context,
    model,
    operation: () => opts.provider.sendMessage(prompt, options),
  };
  if (modelCall) {
    runOpts.modelCall = (response) => ({
      action: 'model_call',
      description: modelCall.description,
      model,
      inputs: modelCall.inputs ?? { promptLength: prompt.length },
      outputs: modelCall.outputs?.(response) ?? { contentLength: response.content.length },
      userDecision: modelCall.userDecision ?? 'auto',
      metadata: modelCall.metadata ?? {},
      tokensIn: (response as Partial<ProviderResponse>).usage?.inputTokens ?? 0,
      tokensOut: (response as Partial<ProviderResponse>).usage?.outputTokens ?? 0,
      costUsd: (response as Partial<ProviderResponse>).cost ?? 0,
      provider: context.providerId,
    });
  }
  return runWithEgressAudit<ProviderResponse>(runOpts);
}
