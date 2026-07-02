/**
 * aiSetupState — tracks how the user resolved the AI-setup step of onboarding.
 *
 * UX research found the #1 first-run drop-off was the "paste your API key"
 * step: a non-technical user hits a wall and abandons. The fix is a genuine,
 * no-shame "Set this up later" path. When the user takes it, we set a flag here
 * so onboarding can finish without blocking, and the AI pane shows a gentle,
 * persistent reminder until they actually connect a model.
 *
 * The flag is intentionally cleared the moment a key is saved or a local model
 * is connected, so the reminder never lingers once AI works.
 */

import { SK_AI_SETUP_DEFERRED } from '@/config/identity';

/**
 * Mark that the user chose to set up AI later. Onboarding still completes; the
 * AI pane will show a gentle reminder.
 */
export function markAiSetupDeferred(): void {
  try {
    localStorage.setItem(SK_AI_SETUP_DEFERRED, 'true');
  } catch {
    // localStorage may be unavailable; worst case the reminder does not show.
  }
}

/**
 * Clear the deferred flag. Call this once the user actually connects a model
 * (saves a key, or confirms a local Ollama model) so the reminder disappears.
 */
export function clearAiSetupDeferred(): void {
  try {
    localStorage.removeItem(SK_AI_SETUP_DEFERRED);
  } catch {
    // Ignore.
  }
}

/** True when the user deferred AI setup and has not yet connected a model. */
export function hasDeferredAiSetup(): boolean {
  try {
    return localStorage.getItem(SK_AI_SETUP_DEFERRED) === 'true';
  } catch {
    return false;
  }
}
