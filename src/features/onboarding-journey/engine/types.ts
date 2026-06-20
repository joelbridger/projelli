import type { JSX } from 'react';
// Reuse the real ConfidentialityMode union from the platform privacy layer.
import type { ConfidentialityMode } from '@/platform/privacy/egress';
// Re-export so consumers of this module can import it from one place.
export type { ConfidentialityMode };

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

/**
 * Host-provided callbacks that chapters can call to produce real side-effects
 * in the live app (e.g. persisting a key and refreshing the model list).
 * The host wires these to the real App handlers at cutover time; chapters
 * always go through this channel, never bypass it.
 */
export interface JourneyActions {
  /**
   * Store the API key AND refresh live app key state + model list.
   * Mirrors App.handleSaveOnboardingApiKey — the host provides the real impl.
   */
  saveApiKey: (provider: ProviderId, key: string) => Promise<void>;
  /**
   * Set the confidentiality mode (e.g. 'local-only' when the user picks
   * local AI). Uses the real union from the platform privacy layer.
   */
  setConfidentialityMode: (mode: ConfidentialityMode) => void;
  /**
   * Open a native folder picker and return the chosen path, or null if the
   * user cancels. The real implementation is wired by the App at cutover time.
   */
  chooseWorkspaceFolder: () => Promise<string | null>;
}

export interface ChapterContext {
  advance: () => void;
  goBack: () => void;
  skipAll: () => void;
  complete: () => void;
  setData: (patch: Partial<JourneyData>) => void;
  data: JourneyData;
  reducedMotion: boolean;
  /** Real app callbacks provided by the host — chapters route side-effects through here. */
  actions: JourneyActions;
}

export interface Chapter {
  id: string;
  title: string;
  canAdvance?: (data: JourneyData) => boolean;
  render: (ctx: ChapterContext) => JSX.Element;
}
