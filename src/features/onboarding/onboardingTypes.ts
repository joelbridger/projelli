/**
 * onboardingTypes — props/interfaces shared by the live first-run flow
 * (OnboardingV2) and the archived 9-step flow (_archive/GuidedOnboarding),
 * so neither needs to import the other.
 */

import type { KeyProvider } from '@/platform/providers/KeychainService';

/**
 * Minimal duck-typed workspace handle for sample-file writes.
 */
export interface OnboardingWorkspace {
  writeFile: (path: string, content: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
}

export interface GuidedOnboardingProps {
  /**
   * Persist a connected cloud API key.  Route through KeychainService.setKey,
   * then mirror into live API-key state so the AI pane sees it immediately.
   */
  onSaveKey: (provider: KeyProvider, key: string) => void | Promise<void>;
  /**
   * Called when the user clicks "Open Advisor Prep Hero" on the Done step, or when they
   * skip the entire flow.  opts.writeSamples signals whether sample files
   * should be written (the caller owns the workspace handle).
   */
  onComplete: (opts?: { writeSamples?: boolean }) => void;
  /** Already-connected API keys (provider -> key string). */
  apiKeys?: Record<string, string>;
  /** Optional workspace for writing sample files on Done. */
  workspace?: OnboardingWorkspace;
}
