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

/** How the user chose to start in the workspace-first step. */
export type OnboardingStartMode = 'sample' | 'own';

/** Outcome of establishing the onboarding workspace. `cancelled` means the user
 *  backed out of the folder picker (no error to show); `error` carries a real
 *  failure message. */
export type OnboardingStartResult =
  | { ok: true; mode: OnboardingStartMode }
  | { ok: false; cancelled?: boolean; error?: string };

export interface GuidedOnboardingProps {
  /**
   * Persist a connected cloud API key.  Route through KeychainService.setKey,
   * then mirror into live API-key state so the AI pane sees it immediately.
   */
  onSaveKey: (provider: KeyProvider, key: string) => void | Promise<void>;
  /**
   * Called when the user clicks "Open Lantern" on the Done step, or when they
   * skip the entire flow.  opts.writeSamples signals whether sample files
   * should be written (the caller owns the workspace handle).
   */
  onComplete: (opts?: { writeSamples?: boolean }) => void;
  /**
   * Establish the workspace for onboarding (the workspace-first step): open or
   * create a folder, and — for the 'sample' mode — write the advisor sample and
   * seed its Client Map so the app is populated before the connect steps. The
   * live app wires this to the same folder-pick + create flow the Workspace
   * Selector uses. Optional so the flow stays navigable in tests/preview.
   */
  onChooseStart?: (mode: OnboardingStartMode) => Promise<OnboardingStartResult>;
  /** True when a workspace is already open (e.g. ?forceOnboarding with a
   *  workspace), so the workspace-first step can be treated as satisfied. */
  hasWorkspace?: boolean;
  /** Already-connected API keys (provider -> key string). */
  apiKeys?: Record<string, string>;
  /** Optional workspace for writing sample files on Done. */
  workspace?: OnboardingWorkspace;
}
