export interface IntakeNudgeAttempt {
  sequence: number;
  at: string;
  missingItemIds: string[];
  auditPairId: string;
  channel: 'email_draft' | 'call_suggested';
}

export interface OnboardingConfig {
  stallDays: number;
  cadenceDays: number;
  maxUnanswered: number;
  expiresSoonDays: number;
}

export const DEFAULT_ONBOARDING_CONFIG: OnboardingConfig = {
  stallDays: 5,
  cadenceDays: 4,
  maxUnanswered: 3,
  expiresSoonDays: 3,
};
