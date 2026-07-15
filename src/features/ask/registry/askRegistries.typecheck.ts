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
// @ts-expect-error -- source ids are closed and typo-safe.
const typoSource: AskSourceId = 'documnt';
void typoSource;
// @ts-expect-error -- answer action ids are closed and typo-safe.
const typoAction: AskAnswerActionId = 'answer-completedd';
void typoAction;
