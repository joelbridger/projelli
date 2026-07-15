/* Existing Ask behavior, expressed as descriptors for future feature modules. */
import { filterHitsByScope, type AskScope } from '../askHelpers';
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
  matches: (source) => source.path?.startsWith('crm:') ?? false,
  open: (source, context) => {
    if (source.path) context.openCrm?.(source.path, source.excerpt);
  },
};
const mailSource: AskSourceDescriptor = {
  id: 'mail',
  order: 20,
  matches: (source) =>
    source.path?.startsWith('mail:') ?? source.sourceType === 'mail',
  open: (source, context) => {
    if (source.path) context.openEmail?.(source.path);
  },
};
const documentSource: AskSourceDescriptor = {
  id: 'document',
  order: 30,
  matches: (source) => Boolean(source.path),
  open: (source, context) => {
    if (source.path)
      context.openDocument?.(source.path, source.matterId, source.excerpt);
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
