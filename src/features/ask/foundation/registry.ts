import type {
  AskAnswerActionContext,
  AskAnswerActionDescriptor,
  AskModeDescriptor,
  AskOwnerIdentityAdapter,
  AskSourceAdapter,
  AskSourceDescriptor,
  AskSourceKind,
  ResolvedAskScope,
} from './contracts';
import { askSourceBelongsToScope } from './scope';

type OrderedDescriptor = {
  readonly id: string;
  readonly order: number;
  readonly isEnabled?: (...args: readonly never[]) => boolean;
};

const SOURCE_KINDS: readonly AskSourceKind[] = [
  'crm-contact',
  'document',
  'meeting-artifact',
  'email-descriptor',
];

function validateOrdered(
  name: string,
  descriptors: readonly OrderedDescriptor[]
): void {
  const ids = new Set<string>();
  let previous = -Infinity;
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) throw new Error(`[${name}] id is required`);
    if (ids.has(descriptor.id)) {
      throw new Error(`[${name}] duplicate id: ${descriptor.id}`);
    }
    if (!Number.isFinite(descriptor.order)) {
      throw new Error(`[${name}] order must be finite: ${descriptor.id}`);
    }
    if (descriptor.order < previous) {
      throw new Error(
        `[${name}] descriptor order must be stable: ${descriptor.id}`
      );
    }
    if (
      descriptor.isEnabled !== undefined &&
      typeof descriptor.isEnabled !== 'function'
    ) {
      throw new Error(`[${name}] invalid dark gate: ${descriptor.id}`);
    }
    ids.add(descriptor.id);
    previous = descriptor.order;
  }
}

export function validateAskSourceRegistry<ClientReference, MeetingReference>(
  descriptors: readonly AskSourceAdapter<ClientReference, MeetingReference>[]
): void {
  validateOrdered(
    'askSourceRegistry',
    descriptors as readonly OrderedDescriptor[]
  );
  for (const descriptor of descriptors) {
    if (
      !descriptor.sourceKinds.length ||
      descriptor.sourceKinds.some((kind) => !SOURCE_KINDS.includes(kind)) ||
      typeof descriptor.listCandidates !== 'function'
    ) {
      throw new Error(`[askSourceRegistry] invalid adapter: ${descriptor.id}`);
    }
  }
}

export function validateAskModeRegistry<ClientReference, MeetingReference>(
  descriptors: readonly AskModeDescriptor<ClientReference, MeetingReference>[]
): void {
  validateOrdered(
    'askModeRegistry',
    descriptors as readonly OrderedDescriptor[]
  );
  for (const descriptor of descriptors) {
    if (
      typeof descriptor.buildScope !== 'object' ||
      !['normal', 'meeting-report'].includes(descriptor.responseFormat)
    ) {
      throw new Error(`[askModeRegistry] invalid mode: ${descriptor.id}`);
    }
  }
}

export function validateAskAnswerActionRegistry<
  ClientReference,
  MeetingReference,
  Authority,
  Audit,
>(
  descriptors: readonly AskAnswerActionDescriptor<
    ClientReference,
    MeetingReference,
    Authority,
    Audit
  >[]
): void {
  validateOrdered(
    'askAnswerActionRegistry',
    descriptors as readonly OrderedDescriptor[]
  );
  for (const descriptor of descriptors) {
    if (
      typeof descriptor.isAvailable !== 'function' ||
      typeof descriptor.execute !== 'function'
    ) {
      throw new Error(
        `[askAnswerActionRegistry] invalid action: ${descriptor.id}`
      );
    }
  }
}

const sourceAdapters: OrderedDescriptor[] = [];
const modes: OrderedDescriptor[] = [];
const actions: OrderedDescriptor[] = [];

/** Empty base contributors are intentional until exact owner doorways land. */
export const askSourceRegistry =
  sourceAdapters as unknown as readonly AskSourceAdapter[];
export const askModeRegistry = modes as unknown as readonly AskModeDescriptor[];
export const askAnswerActionRegistry =
  actions as unknown as readonly AskAnswerActionDescriptor[];
/** Compatibility name mapped to the single canonical action registry. */
export const askActionRegistry = askAnswerActionRegistry;

function append(
  target: OrderedDescriptor[],
  descriptor: OrderedDescriptor,
  validate: (entries: readonly OrderedDescriptor[]) => void
): void {
  const next = [...target, descriptor].sort(
    (left, right) => left.order - right.order
  );
  validate(next);
  target.splice(0, target.length, ...next);
}

export function registerAskSource<ClientReference, MeetingReference>(
  adapter: AskSourceAdapter<ClientReference, MeetingReference>
): void {
  append(sourceAdapters, adapter as OrderedDescriptor, (entries) => {
    validateAskSourceRegistry(
      entries as readonly AskSourceAdapter<ClientReference, MeetingReference>[]
    );
  });
}

export function registerAskMode<ClientReference, MeetingReference>(
  mode: AskModeDescriptor<ClientReference, MeetingReference>
): void {
  append(modes, mode as OrderedDescriptor, (entries) => {
    validateAskModeRegistry(
      entries as readonly AskModeDescriptor<ClientReference, MeetingReference>[]
    );
  });
}

export function registerAskAnswerAction<
  ClientReference,
  MeetingReference,
  Authority,
  Audit,
>(
  action: AskAnswerActionDescriptor<
    ClientReference,
    MeetingReference,
    Authority,
    Audit
  >
): void {
  append(actions, action as OrderedDescriptor, (entries) => {
    validateAskAnswerActionRegistry(
      entries as readonly AskAnswerActionDescriptor<
        ClientReference,
        MeetingReference,
        Authority,
        Audit
      >[]
    );
  });
}

export function listAskSourceAdapters<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>
): readonly AskSourceAdapter<ClientReference, MeetingReference>[] {
  return (
    sourceAdapters as unknown as readonly AskSourceAdapter<
      ClientReference,
      MeetingReference
    >[]
  ).filter((descriptor) => descriptor.isEnabled?.(scope) !== false);
}

export function collectAskSourceCandidates<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): readonly AskSourceDescriptor<ClientReference, MeetingReference>[] {
  return listAskSourceAdapters(scope)
    .flatMap((adapter) => adapter.listCandidates(scope))
    .filter((source) => askSourceBelongsToScope(scope, source, owners));
}

export function listAskModes<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>
): readonly AskModeDescriptor<ClientReference, MeetingReference>[] {
  return (
    modes as unknown as readonly AskModeDescriptor<
      ClientReference,
      MeetingReference
    >[]
  ).filter((descriptor) => descriptor.isEnabled?.(scope) !== false);
}

export function listAskAnswerActions<
  ClientReference,
  MeetingReference,
  Authority,
  Audit,
>(
  context: AskAnswerActionContext<
    ClientReference,
    MeetingReference,
    Authority,
    Audit
  >
): readonly AskAnswerActionDescriptor<
  ClientReference,
  MeetingReference,
  Authority,
  Audit
>[] {
  return (
    actions as unknown as readonly AskAnswerActionDescriptor<
      ClientReference,
      MeetingReference,
      Authority,
      Audit
    >[]
  ).filter(
    (descriptor) =>
      descriptor.isEnabled?.(context) !== false &&
      descriptor.isAvailable(context)
  );
}
