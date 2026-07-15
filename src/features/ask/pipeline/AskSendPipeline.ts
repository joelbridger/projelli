import type { ConsentScope } from '@/platform/ai/fileAccessConsent';
import type { AuditScope } from '@/platform/types/audit';
import type { TurnScope } from '@/platform/types/ai';
import type { RetrievalScope } from '@/platform/utils/tauri-commands';
import { getAskAnswerActions } from '../registry/askRegistries';
import type {
  AskAnswerActionContext,
  AskAnswerActionDescriptor,
} from '../registry/types';

export interface AskSendContextInput {
  activeMatterId: string | null;
  activeMatterName: string | null;
}

export interface AskSendContext {
  consentScope: ConsentScope;
  retrievalScope: RetrievalScope;
  turnScope: TurnScope;
  auditScope: AuditScope;
}

export interface AskSendContextProvider {
  id: string;
  order: number;
  provide: (input: AskSendContextInput) => Partial<AskSendContext>;
}

const matterScopeContextProvider: AskSendContextProvider = {
  id: 'matter-scope',
  order: 10,
  provide: ({ activeMatterId, activeMatterName }) => {
    if (!activeMatterId) {
      return {
        consentScope: { kind: 'allMatters' },
        retrievalScope: { kind: 'allMatters' },
        turnScope: { kind: 'allMatters' },
        auditScope: { kind: 'allMatters' },
      };
    }
    return {
      consentScope: { kind: 'matter', matterId: activeMatterId },
      retrievalScope: { kind: 'matter', matterId: activeMatterId },
      turnScope: {
        kind: 'matter',
        matterId: activeMatterId,
        ...(activeMatterName ? { matterName: activeMatterName } : {}),
      },
      auditScope: {
        kind: 'matter',
        matterId: activeMatterId,
        ...(activeMatterName ? { matterName: activeMatterName } : {}),
      },
    };
  },
};

const askSendContextProviders: AskSendContextProvider[] = [
  matterScopeContextProvider,
];

/** Existing context contributors, expressed as ordered descriptors. */
export const askSendContextProviderRegistry: readonly AskSendContextProvider[] =
  askSendContextProviders;

export function registerAskSendContextProvider(
  provider: AskSendContextProvider,
): void {
  if (!provider.id.trim()) {
    throw new Error('[AskSendPipeline] context provider id is required');
  }
  if (askSendContextProviders.some((candidate) => candidate.id === provider.id)) {
    throw new Error(
      `[AskSendPipeline] duplicate context provider id: ${provider.id}`,
    );
  }
  if (!Number.isFinite(provider.order) || typeof provider.provide !== 'function') {
    throw new Error(
      `[AskSendPipeline] invalid context provider: ${provider.id}`,
    );
  }
  askSendContextProviders.push(provider);
}

function requireSendContext(
  context: Partial<AskSendContext>,
): AskSendContext {
  if (
    !context.consentScope ||
    !context.retrievalScope ||
    !context.turnScope ||
    !context.auditScope
  ) {
    throw new Error('[AskSendPipeline] context providers returned an incomplete context');
  }
  return context as AskSendContext;
}

/**
 * One send-time snapshot for confidentiality scope and completion actions.
 * Providers run once, in order, so every downstream stage sees the same client.
 */
export class AskSendPipeline {
  constructor(
    private readonly contextProviders: readonly AskSendContextProvider[] =
      askSendContextProviderRegistry,
    private readonly answerActions: () => readonly AskAnswerActionDescriptor[] =
      getAskAnswerActions,
  ) {}

  buildContext(input: AskSendContextInput): AskSendContext {
    const context = this.contextProviders
      .slice()
      .sort((left, right) => left.order - right.order)
      .reduce<Partial<AskSendContext>>(
        (current, provider) => ({ ...current, ...provider.provide(input) }),
        {},
      );
    return requireSendContext(context);
  }

  /** Run only lifecycle actions; reviewable task/note/draft actions stay user-driven. */
  async completeAnswer(context: AskAnswerActionContext): Promise<void> {
    for (const action of this.answerActions()) {
      if (action.kind === 'answer-completed') await action.execute(context);
    }
  }
}

export const askSendPipeline = new AskSendPipeline();
