// The onboarding completion/profession helpers live in onboardingState (the old
// FirstRunWizard re-exported its own duplicate copies; both the 9-step
// GuidedOnboarding and the 7-step FirstRunWizard have been retired — the live
// first-run flow is OnboardingV2). Source the helpers from onboardingState.
export { hasCompletedOnboarding, resetOnboarding, getOnboardingProfession } from './onboardingState';
export {
  ApiKeySetupCard,
  hasDismissedApiKeyCard,
  markApiKeyCardDismissed,
} from './ApiKeySetupCard';
export { ApiKeyWizard, type ApiKeyWizardProps, type WizardProvider } from './ApiKeyWizard';
export { AiSetupReminder, type AiSetupReminderProps } from './AiSetupReminder';
export {
  ensureSampleHendricksCrmLink,
  seedSampleGoldenPath,
  SAMPLE_GOLDEN_PATH,
} from './seedSampleGoldenPath';
