import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WELCOME_JOURNEY } from '@/platform/intake/welcomeJourneyDefaults';
import { assertSendableRequest, createAdvisorIntake, type CreateAdvisorIntakeOptions } from './createIntake';
import { loadIntakeLinkSecret } from './intakeKeychain';
import { useIntakeStore } from './intakeStore';

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
    useIntakeStore.getState().resetForTests();
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

  it('rejects unsupported actionable items before saving secrets or creating a relay record', async () => {
    const input = options({ checklist: { ...options().checklist, items: [{ t: 'signature', item_id: 'sign', label: 'Sign', help_text: '', required: true, subject: 'primary', grade: 'native_clicksign' }] } });
    await expect(createAdvisorIntake(input)).rejects.toThrow(/signature/iu);
    expect(input.relay.createIntake).not.toHaveBeenCalled();
    await expect(loadIntakeLinkSecret(input.intakeId)).resolves.toBeNull();
    expect(useIntakeStore.getState().intakesById[input.intakeId]).toBeUndefined();
  });

  it.each(['request with spaces', '../outside-request'])('rejects an unsafe caller-supplied request slug before creating anything: %s', async (requestSlug) => {
    const input = options({
      checklist: { ...options().checklist, kind: 'standing' },
      requestSlug,
    });

    await expect(createAdvisorIntake(input)).rejects.toThrow(/folder names/iu);
    expect(input.relay.createIntake).not.toHaveBeenCalled();
    await expect(loadIntakeLinkSecret(input.intakeId)).resolves.toBeNull();
    expect(useIntakeStore.getState().intakesById[input.intakeId]).toBeUndefined();
  });

  it('cleans local secret and draft when relay creation fails, and tries to revoke the remote id', async () => {
    const revokeIntake = vi.fn().mockResolvedValue({ ok: true });
    const input = options({ relay: { createIntake: vi.fn().mockRejectedValue(new Error('offline')), revokeIntake } });
    await expect(createAdvisorIntake(input)).rejects.toThrow('offline');
    await expect(loadIntakeLinkSecret(input.intakeId)).resolves.toBeNull();
    expect(useIntakeStore.getState().intakesById[input.intakeId]).toBeUndefined();
    expect(revokeIntake).toHaveBeenCalledWith(input.intakeId);
  });

  it('validates pdf and signature item lists directly', () => {
    expect(() => { assertSendableRequest([{ t: 'pdf_fill', item_id: 'pdf', label: 'PDF', help_text: '', required: true, subject: 'primary', pdf_ref: 'x', field_map: {}, prefill: [] }]); }).toThrow(/pdf_fill/iu);
  });
});
