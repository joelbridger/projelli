/* Existing Ask behavior, expressed as descriptors for future feature modules. */
import { filterHitsByScope, type AskScope } from '../askScope';
import type {
  AskAnswerActionDescriptor,
  AskModeDescriptor,
  AskSourceDescriptor,
} from './types';

declare module '@/platform/types/ask' {
  interface AskModeIdMap {
    normal: true;
  }
  interface AskSourceIdMap {
    crm: true;
    mail: true;
    document: true;
  }
  interface AskAnswerActionIdMap {
    'answer-completed': true;
  }
}

const normalMode: AskModeDescriptor = {
  id: 'normal',
  order: 10,
  buildRetrievalPlan: ({ activeMatterId, askScope }) => ({
    scope:
      activeMatterId && askScope !== 'all-matters'
        ? { kind: 'matter', matterId: activeMatterId }
        : { kind: 'allMatters' },
    filterHits: (hits) => filterHitsByScope(hits, askScope),
  }),
  promptFormat: (filesOnly) => ({ kind: filesOnly ? 'files-only' : 'smart' }),
};

const crmSource: AskSourceDescriptor = {
  id: 'crm',
  order: 10,
  matches: (source) =>
    source.sourceType === 'crm' || (source.path?.startsWith('crm:') ?? false),
  canOpen: (source, context) => Boolean(source.path && context.openCrm),
  open: (source, context) => {
    if (source.path) context.openCrm?.(source);
  },
};
const mailSource: AskSourceDescriptor = {
  id: 'mail',
  order: 20,
  matches: (source) =>
    source.sourceType === 'mail' || (source.path?.startsWith('mail:') ?? false),
  canOpen: (source, context) => Boolean(source.path && context.openEmail),
  open: (source, context) => {
    if (source.path) context.openEmail?.(source);
  },
};
const documentSource: AskSourceDescriptor = {
  id: 'document',
  order: 30,
  matches: (source) => Boolean(source.path),
  canOpen: (source, context) => Boolean(source.path && context.openDocument),
  open: (source, context) => {
    if (source.path) context.openDocument?.(source);
  },
};

const completedAnswerAction: AskAnswerActionDescriptor = {
  id: 'answer-completed',
  order: 10,
  reviewable: true,
  kind: 'answer-completed',
  execute: ({ turn, onAnswerCompleted }) => {
    onAnswerCompleted?.(turn);
  },
};

export const legacyAskModes: readonly AskModeDescriptor[] = [normalMode];
export const legacyAskSources: readonly AskSourceDescriptor[] = [
  crmSource,
  mailSource,
  documentSource,
];
export const legacyAskAnswerActions: readonly AskAnswerActionDescriptor[] = [
  completedAnswerAction,
];

export const NORMAL_ASK_MODE = 'normal' as const;
export function legacyAskScope(scope: AskScope): AskScope {
  return scope;
}
