/**
 * Closed, augmentable Ask vocabularies. Ask feature modules declare their ids
 * beside their descriptors so an unregistered id remains a type error.
 */
export interface AskModeIdMap {}
export interface AskSourceIdMap {}
export interface AskAnswerActionIdMap {}

export type AskModeId = Extract<keyof AskModeIdMap, string>;
export type AskSourceId = Extract<keyof AskSourceIdMap, string>;
export type AskAnswerActionId = Extract<keyof AskAnswerActionIdMap, string>;
