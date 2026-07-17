import { Fragment, type ReactNode } from 'react';
import type { CrmHouseholdAddRequest } from '@/features/crm-home';
import type {
  StartWorkflowInput,
  WorkflowTemplateRecord,
} from '../workflowTemplateStore';
import { workflowFiltersAuthoringExtension } from '../filters';
import { workflowRecordQuickAddDescriptor } from '../record-quickadd';

export type WorkflowRecordStartRequest = Readonly<
  CrmHouseholdAddRequest & { kind: 'workflow' }
>;

/** The host-normalized record handoff for starting a canonical workflow. */
export interface WorkflowRecordStartContext {
  /** The unchanged one-shot request created by the household record action. */
  request: WorkflowRecordStartRequest;
  /** Canonical input for WorkflowTemplateStore.start(), including matter when known. */
  household: Readonly<StartWorkflowInput>;
  /** Success and explicit cancel consume the request; failures leave it usable. */
  onRequestConsumed: () => void;
  /**
   * Opens the landed canonical template library and consumes this one-shot
   * request. The public WorkflowRecordStartSlot always supplies this action;
   * it stays optional only so already-landed direct composition consumers do
   * not have to change.
   */
  openTemplateLibrary?: () => void;
}

export interface WorkflowRecordStartDescriptor {
  id: string;
  order: number;
  /** Checked before this descriptor receives the one-shot request context. */
  isEnabled?: () => boolean;
  mount: (context: WorkflowRecordStartContext) => ReactNode;
}

export interface WorkflowRecordStartComposition {
  starts: readonly WorkflowRecordStartDescriptor[];
}

/** Append feature-owned record-start mounts here without changing their context. */
export const workflowRecordStartRegistry: readonly WorkflowRecordStartDescriptor[] =
  [workflowRecordQuickAddDescriptor];

export function validateWorkflowRecordStartDescriptors(
  descriptors: readonly WorkflowRecordStartDescriptor[]
): void {
  validateDescriptors('workflowRecordStartRegistry', descriptors, ['mount']);
  for (const descriptor of descriptors) {
    if (
      descriptor.isEnabled !== undefined &&
      typeof descriptor.isEnabled !== 'function'
    ) {
      throw new Error(
        `[workflowRecordStartRegistry] isEnabled must be a function: ${descriptor.id}`
      );
    }
  }
}

/** Builds an open-world record-start configuration without mutating the registry. */
export function createWorkflowRecordStartComposition(
  ...contributions: readonly WorkflowRecordStartDescriptor[]
): WorkflowRecordStartComposition {
  const starts = [...workflowRecordStartRegistry, ...contributions];
  validateWorkflowRecordStartDescriptors(starts);
  return { starts: ordered(starts) };
}

export const defaultWorkflowRecordStartComposition =
  createWorkflowRecordStartComposition();

/** Public host mount for a typed workflow request from a household record. */
export function mountWorkflowRecordStarts(
  context: WorkflowRecordStartContext,
  composition: WorkflowRecordStartComposition = defaultWorkflowRecordStartComposition
): ReactNode {
  validateWorkflowRecordStartDescriptors(composition.starts);
  return ordered(composition.starts)
    .filter((descriptor) => descriptor.isEnabled?.() ?? true)
    .map((descriptor) => (
      <Fragment key={descriptor.id}>{descriptor.mount(context)}</Fragment>
    ));
}

/**
 * Public navigation action for the honest no-published-template path.
 * Record-start features should call this instead of guessing a CRM route or
 * mounting another template library.
 */
export function openWorkflowTemplateLibrary(
  context: WorkflowRecordStartContext
): void {
  if (!context.openTemplateLibrary) {
    throw new Error(
      '[workflowRecordStartRegistry] mount through WorkflowRecordStartSlot before opening the template library'
    );
  }
  context.openTemplateLibrary();
}

export type WorkflowAuthoringLibraryStateValue =
  | null
  | boolean
  | number
  | string
  | readonly WorkflowAuthoringLibraryStateValue[]
  | { readonly [key: string]: WorkflowAuthoringLibraryStateValue };

/** Temporary state owned by one library extension. It is never persisted. */
export interface WorkflowAuthoringLibraryState<
  Value extends WorkflowAuthoringLibraryStateValue =
    WorkflowAuthoringLibraryStateValue,
> {
  get(): Value | undefined;
  set(value: Value): void;
}

export interface WorkflowAuthoringLibraryFilterContext<
  Value extends WorkflowAuthoringLibraryStateValue =
    WorkflowAuthoringLibraryStateValue,
> {
  /** Complete records returned by the canonical async workflow store. */
  canonicalTemplates: readonly WorkflowTemplateRecord[];
  /** Identity owned by the landed authoring library; null means a new draft. */
  selectedTemplateId: string | null;
  /** One transient, feature-scoped state slot. */
  state: WorkflowAuthoringLibraryState<Value>;
}

export interface WorkflowAuthoringLibraryContext<
  Value extends WorkflowAuthoringLibraryStateValue =
    WorkflowAuthoringLibraryStateValue,
> extends WorkflowAuthoringLibraryFilterContext<Value> {
  /** Canonical records remaining after every enabled extension filter composes. */
  visibleTemplates: readonly WorkflowTemplateRecord[];
}

export interface WorkflowAuthoringLibraryDescriptor<
  Value extends WorkflowAuthoringLibraryStateValue =
    WorkflowAuthoringLibraryStateValue,
> {
  /** Also scopes transient state, so IDs must be unique. */
  id: string;
  order: number;
  /** Checked before canonical templates or selected identity reach the extension. */
  isEnabled?: () => boolean;
  /** The supported insertion point above the landed template result list. */
  mountFilterControl?: (
    context: WorkflowAuthoringLibraryContext<Value>
  ) => ReactNode;
  /** Enabled filters compose with AND and never mutate canonical records. */
  filter?: (
    template: WorkflowTemplateRecord,
    context: WorkflowAuthoringLibraryFilterContext<Value>
  ) => boolean;
  /** The supported insertion point for selected-template detail. */
  renderDetail?: (context: WorkflowAuthoringLibraryContext<Value>) => ReactNode;
}

export interface WorkflowAuthoringLibraryComposition {
  extensions: readonly WorkflowAuthoringLibraryDescriptor[];
}

/**
 * Keeps one extension's state narrow while safely erasing it for the shared,
 * heterogeneous registry. The descriptor ID is the sole owner of that state.
 */
export function defineWorkflowAuthoringLibraryDescriptor<
  Value extends WorkflowAuthoringLibraryStateValue,
>(
  descriptor: WorkflowAuthoringLibraryDescriptor<Value>
): WorkflowAuthoringLibraryDescriptor {
  const narrow = (context: WorkflowAuthoringLibraryContext) =>
    context as unknown as WorkflowAuthoringLibraryContext<Value>;
  const narrowFilter = (context: WorkflowAuthoringLibraryFilterContext) =>
    context as unknown as WorkflowAuthoringLibraryFilterContext<Value>;
  return {
    id: descriptor.id,
    order: descriptor.order,
    ...(descriptor.isEnabled ? { isEnabled: descriptor.isEnabled } : {}),
    ...(descriptor.mountFilterControl
      ? {
          mountFilterControl: (context: WorkflowAuthoringLibraryContext) =>
            descriptor.mountFilterControl?.(narrow(context)),
        }
      : {}),
    ...(descriptor.filter
      ? {
          filter: (
            template: WorkflowTemplateRecord,
            context: WorkflowAuthoringLibraryFilterContext
          ) => descriptor.filter?.(template, narrowFilter(context)) ?? true,
        }
      : {}),
    ...(descriptor.renderDetail
      ? {
          renderDetail: (context: WorkflowAuthoringLibraryContext) =>
            descriptor.renderDetail?.(narrow(context)),
        }
      : {}),
  };
}

/** Append feature-owned library controls/details here without changing the editor. */
export const workflowAuthoringLibraryRegistry: readonly WorkflowAuthoringLibraryDescriptor[] =
  [defineWorkflowAuthoringLibraryDescriptor(workflowFiltersAuthoringExtension)];

export function validateWorkflowAuthoringLibraryDescriptors(
  descriptors: readonly WorkflowAuthoringLibraryDescriptor[]
): void {
  validateDescriptors('workflowAuthoringLibraryRegistry', descriptors, []);
  for (const descriptor of descriptors) {
    if (
      descriptor.mountFilterControl === undefined &&
      descriptor.renderDetail === undefined
    ) {
      throw new Error(
        `[workflowAuthoringLibraryRegistry] filter-control or detail-render slot is required: ${descriptor.id}`
      );
    }
    for (const field of [
      'isEnabled',
      'mountFilterControl',
      'filter',
      'renderDetail',
    ] as const) {
      const value = descriptor[field];
      if (value !== undefined && typeof value !== 'function') {
        throw new Error(
          `[workflowAuthoringLibraryRegistry] ${field} must be a function: ${descriptor.id}`
        );
      }
    }
  }
}

/** Builds an open-world library configuration without mutating the registry. */
export function createWorkflowAuthoringLibraryComposition(
  ...contributions: readonly WorkflowAuthoringLibraryDescriptor[]
): WorkflowAuthoringLibraryComposition {
  const extensions = [...workflowAuthoringLibraryRegistry, ...contributions];
  validateWorkflowAuthoringLibraryDescriptors(extensions);
  return { extensions: ordered(extensions) };
}

export const defaultWorkflowAuthoringLibraryComposition =
  createWorkflowAuthoringLibraryComposition();

export type WorkflowAuthoringLibraryStateFactory = <
  Value extends WorkflowAuthoringLibraryStateValue,
>(
  id: string
) => WorkflowAuthoringLibraryState<Value>;

export function enabledWorkflowAuthoringLibraryExtensions(
  composition: WorkflowAuthoringLibraryComposition
): readonly WorkflowAuthoringLibraryDescriptor[] {
  validateWorkflowAuthoringLibraryDescriptors(composition.extensions);
  return composition.extensions.filter(
    (descriptor) => descriptor.isEnabled?.() ?? true
  );
}

function copiedTemplates(
  templates: readonly WorkflowTemplateRecord[]
): readonly WorkflowTemplateRecord[] {
  return structuredClone(templates);
}

export function workflowAuthoringLibraryContext<
  Value extends WorkflowAuthoringLibraryStateValue,
>(
  descriptor: WorkflowAuthoringLibraryDescriptor<Value>,
  canonicalTemplates: readonly WorkflowTemplateRecord[],
  visibleTemplates: readonly WorkflowTemplateRecord[],
  selectedTemplateId: string | null,
  stateFor: WorkflowAuthoringLibraryStateFactory
): WorkflowAuthoringLibraryContext<Value> {
  return {
    canonicalTemplates: copiedTemplates(canonicalTemplates),
    visibleTemplates: copiedTemplates(visibleTemplates),
    selectedTemplateId,
    state: stateFor<Value>(descriptor.id),
  };
}

function workflowAuthoringLibraryFilterContext<
  Value extends WorkflowAuthoringLibraryStateValue,
>(
  descriptor: WorkflowAuthoringLibraryDescriptor<Value>,
  canonicalTemplates: readonly WorkflowTemplateRecord[],
  selectedTemplateId: string | null,
  stateFor: WorkflowAuthoringLibraryStateFactory
): WorkflowAuthoringLibraryFilterContext<Value> {
  return {
    canonicalTemplates: copiedTemplates(canonicalTemplates),
    selectedTemplateId,
    state: stateFor<Value>(descriptor.id),
  };
}

/** Filters copies, then returns untouched canonical records in stable order. */
export function projectWorkflowAuthoringTemplates(
  templates: readonly WorkflowTemplateRecord[],
  extensions: readonly WorkflowAuthoringLibraryDescriptor[],
  selectedTemplateId: string | null,
  stateFor: WorkflowAuthoringLibraryStateFactory
): readonly WorkflowTemplateRecord[] {
  const filters = extensions.filter(
    (descriptor) => typeof descriptor.filter === 'function'
  );
  if (filters.length === 0) return templates;
  const callbacks = filters.map((descriptor) => ({
    descriptor,
    context: workflowAuthoringLibraryFilterContext(
      descriptor,
      templates,
      selectedTemplateId,
      stateFor
    ),
  }));
  return templates.filter((template) =>
    callbacks.every(
      ({ descriptor, context }) =>
        descriptor.filter?.(structuredClone(template), context) ?? true
    )
  );
}

function ordered<T extends { order: number }>(items: readonly T[]): T[] {
  return items.slice().sort((left, right) => left.order - right.order);
}

function validateDescriptors(
  registryName: string,
  descriptors: readonly { id: string; order: number }[],
  requiredFunctions: readonly string[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(descriptor.id)) {
      throw new Error(
        `[${registryName}] id must use lowercase letters, numbers, dots, or hyphens: ${descriptor.id}`
      );
    }
    if (ids.has(descriptor.id)) {
      throw new Error(`[${registryName}] duplicate id: ${descriptor.id}`);
    }
    if (!Number.isFinite(descriptor.order)) {
      throw new Error(
        `[${registryName}] order must be finite: ${descriptor.id}`
      );
    }
    for (const field of requiredFunctions) {
      if (
        typeof (descriptor as unknown as Record<string, unknown>)[field] !==
        'function'
      ) {
        throw new Error(
          `[${registryName}] ${field} must be a function: ${descriptor.id}`
        );
      }
    }
    ids.add(descriptor.id);
  }
}
