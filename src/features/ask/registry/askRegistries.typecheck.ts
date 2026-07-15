import type { AskModeId, AskSourceId, AskAnswerActionId } from './types';

const mode: AskModeId = 'normal';
const source: AskSourceId = 'document';
const action: AskAnswerActionId = 'answer-completed';
void mode;
void source;
void action;

// @ts-expect-error -- ids are closed until a feature descriptor augments the map.
const typoMode: AskModeId = 'norml';
void typoMode;
