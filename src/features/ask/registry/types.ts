import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import type {
  AskAnswerActionId,
  AskModeId,
  AskSourceId,
} from '@/platform/types/ask';
import type { AskScope, AskTurn } from '../askHelpers';

export type {
  AskAnswerActionId,
  AskModeId,
  AskSourceId,
} from '@/platform/types/ask';

/** Stable inputs captured at send time; descriptors may not read ambient state. */
export interface AskModeContext {
  activeMatterId: string | null;
  askScope: AskScope;
}

export interface AskRetrievalPlan {
  scope: RetrievalScope;
  filterHits: (hits: RagHit[]) => RagHit[];
}

/** The prompt policy stays with a mode, rather than accumulating in useAsk. */
export interface AskPromptFormatContract {
  kind: 'files-only' | 'smart';
}

export interface AskModeDescriptor {
  id: AskModeId;
  order: number;
  buildRetrievalPlan: (context: AskModeContext) => AskRetrievalPlan;
  promptFormat: (filesOnly: boolean) => AskPromptFormatContract;
}

export interface AskSourceReference {
  path: string | null | undefined;
  matterId?: string | undefined;
  excerpt?: string | undefined;
  sourceType?: string | undefined;
}

export interface AskSourceOpenContext {
  openDocument?:
    | ((path: string, matterId?: string, snippet?: string) => void)
    | undefined;
  openEmail?: ((sourceId: string) => void) | undefined;
  openCrm?: ((sourceId: string, snippet?: string) => void) | undefined;
}

export interface AskSourceDescriptor {
  id: AskSourceId;
  order: number;
  matches: (source: AskSourceReference) => boolean;
  open: (source: AskSourceReference, context: AskSourceOpenContext) => void;
}

/** A reviewed consumer action that can be offered after an Ask answer settles. */
export interface AskAnswerActionContext {
  turn: AskTurn;
  onAnswerCompleted?: ((turn: AskTurn) => void) | undefined;
}

export interface AskAnswerActionDescriptor {
  id: AskAnswerActionId;
  order: number;
  reviewable: boolean;
  kind:
    | 'navigation'
    | 'create-task'
    | 'create-note'
    | 'create-draft'
    | 'answer-completed';
  execute: (context: AskAnswerActionContext) => void | Promise<void>;
}
