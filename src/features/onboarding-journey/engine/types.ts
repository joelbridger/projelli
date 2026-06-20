import type { JSX } from 'react';

export type ProfessionId = 'legal' | 'tax' | 'consulting' | 'financial' | 'other';
export type AiChoice = 'cloud' | 'local' | 'later';
export type ProviderId = 'anthropic' | 'openai' | 'google';
export type FirmChoice = 'solo' | 'create' | 'join';

export interface JourneyData {
  profession?: ProfessionId;
  displayName?: string;
  photoDataUrl?: string;
  workspacePath?: string;
  aiChoice?: AiChoice;
  aiProvider?: ProviderId;
  emailConnected?: boolean;
  firmChoice?: FirmChoice;
  addSamples?: boolean;
}

export interface ChapterContext {
  advance: () => void;
  goBack: () => void;
  skipAll: () => void;
  complete: () => void;
  setData: (patch: Partial<JourneyData>) => void;
  data: JourneyData;
  reducedMotion: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  canAdvance?: (data: JourneyData) => boolean;
  render: (ctx: ChapterContext) => JSX.Element;
}
