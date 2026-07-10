import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_WELCOME_JOURNEY } from '@/features/intake/welcomeJourneyDefaults';
import { createAdvisorIntake } from './createIntake';
import { b64ToBytes, openPageJson } from './pageSeal';
import { derivePageKey } from './intakeCrypto';

describe('welcome journey sealing', () => {
  it('keeps firm journey text inside the k_page sealed checklist', async () => {
    const relay = { createIntake: vi.fn().mockResolvedValue({}) };
    const bundle = await createAdvisorIntake({
      intakeId: 'intake-welcome-proof',
      matterId: 'matter-1',
      intakeHost: 'https://forms.example.test',
      expiresAt: '2026-08-09T00:00:00.000Z',
      checklist: { request_id: 'intake-welcome-proof', schema_version: 1, matter_id: 'matter-1', kind: 'onboarding', items: [] },
      clientFirstName: 'Sarah',
      firm: {
        name: 'North Star Planning', accent: '#2f7d62', advisor_name: 'Dana', advisor_email: 'dana@example.test', next_steps: [],
        journey: { ...DEFAULT_WELCOME_JOURNEY, people: [{ ...DEFAULT_WELCOME_JOURNEY.people[0]!, name: 'Dana Reed' }] },
      },
      relay,
    });

    const outbound = relay.createIntake.mock.calls[0]?.[0];
    expect(JSON.stringify(outbound)).not.toContain('North Star Planning');
    expect(JSON.stringify(outbound)).not.toContain('Dana Reed');
    expect(JSON.stringify(outbound)).not.toContain('Information needed');

    const opened = await openPageJson<{ firm: { name: string; journey: typeof DEFAULT_WELCOME_JOURNEY } }>(
      await derivePageKey(b64ToBytes(bundle.linkSecretB64)),
      bundle.checklistCiphertextB64,
    );
    expect(opened.firm.name).toBe('North Star Planning');
    expect(opened.firm.journey.timeline[1]?.label).toBe('Information needed');
  });
});
