import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WELCOME_JOURNEY } from '@/features/intake/welcomeJourneyDefaults';
import { createAdvisorIntake, type CreateAdvisorIntakeOptions } from './createIntake';

function options(overrides: Partial<CreateAdvisorIntakeOptions> = {}): CreateAdvisorIntakeOptions {
  const base: CreateAdvisorIntakeOptions = {
    intakeId: 'intake-team-share-test',
    matterId: 'local-matter-id',
    intakeHost: 'https://forms.test',
    expiresAt: '2026-12-01T00:00:00.000Z',
    checklist: {
      request_id: 'intake-team-share-test',
      schema_version: 1,
      matter_id: 'local-matter-id',
      kind: 'onboarding',
      items: [],
    },
    clientFirstName: 'Sarah',
    firm: { name: 'North Star', accent: '#123456', advisor_name: 'Ada', advisor_email: 'ada@test.invalid', next_steps: [], journey: DEFAULT_WELCOME_JOURNEY },
    relay: { createIntake: vi.fn().mockResolvedValue({ ok: true }) },
  };
  return { ...base, ...overrides };
}

describe('createAdvisorIntake team sharing', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a local-only intake without attempting a team-key publish', async () => {
    const input = options();
    const result = await createAdvisorIntake(input);
    expect(typeof result.link).toBe('string');
    expect(input.relay.createIntake).toHaveBeenCalledOnce();
  });

  it('publishes only when the caller provides a promoted firm-matter grant callback', async () => {
    const publishTeamKey = vi.fn().mockResolvedValue(undefined);
    const input = options({ matterId: 'firm-matter-id', publishTeamKey });
    await createAdvisorIntake(input);
    expect(publishTeamKey).toHaveBeenCalledWith('intake-team-share-test', 'firm-matter-id');
  });
});
