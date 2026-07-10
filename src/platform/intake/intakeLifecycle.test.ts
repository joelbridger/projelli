import { describe, expect, it } from 'vitest';

import { derivePageKey } from '@/platform/intake/intakeCrypto';
import { parseLinkFragment } from '@/platform/intake/intakeLink';
import { openPageJson, sealPageJson } from './pageSeal';
import { regenerateIntakeLink, createInitialIntakeLinkBundle } from './intakeLifecycle';
import type { FormRequest } from './types';

const request: FormRequest = {
  request_id: 'intake-1',
  schema_version: 1,
  matter_id: 'matter-1',
  kind: 'onboarding',
  blueprint_ref: 'new_household_v1',
  items: [
    {
      t: 'readonly_card',
      item_id: 'welcome',
      label: 'Welcome',
      help_text: '',
      required: false,
      subject: 'household',
      body: 'Welcome.',
    },
  ],
};

const state = {
  current_item_id: 'welcome',
  completed_item_ids: [],
  confirmations: {},
};

describe('intake link lifecycle', () => {
  it('regeneration re-seals checklist and state for the new link while the old link fails', async () => {
    const initial = await createInitialIntakeLinkBundle({
      intakeId: 'intake-1',
      intakeHost: 'https://forms.example.test',
      checklist: request,
      initialState: state,
    });

    const oldParsed = parseLinkFragment(new URL(initial.link).hash);
    expect('version' in oldParsed && oldParsed.version).toBe(1);
    if (!('version' in oldParsed)) throw new Error('old link failed to parse');

    const regenerated = await regenerateIntakeLink({
      intakeId: 'intake-1',
      intakeHost: 'https://forms.example.test',
      publicKeyRaw: initial.publicKeyRaw,
      checklistCiphertextB64: initial.checklistCiphertextB64,
      stateCiphertextB64: initial.stateCiphertextB64,
      oldLinkSecret: oldParsed.s,
    });

    const newParsed = parseLinkFragment(new URL(regenerated.link).hash);
    expect('version' in newParsed && newParsed.version).toBe(1);
    if (!('version' in newParsed)) throw new Error('new link failed to parse');

    const newKey = await derivePageKey(newParsed.s);
    const oldKey = await derivePageKey(oldParsed.s);

    await expect(openPageJson<FormRequest>(newKey, regenerated.checklistCiphertextB64)).resolves.toEqual(request);
    await expect(openPageJson<typeof state>(newKey, regenerated.stateCiphertextB64)).resolves.toEqual(state);
    await expect(openPageJson<FormRequest>(oldKey, regenerated.checklistCiphertextB64)).rejects.toThrow();
    await expect(openPageJson<typeof state>(oldKey, regenerated.stateCiphertextB64)).rejects.toThrow();
  });

  it('page sealing helper never depends on deterministic ciphertext', async () => {
    const key = await derivePageKey(crypto.getRandomValues(new Uint8Array(32)));
    const first = await sealPageJson(key, request);
    const second = await sealPageJson(key, request);

    expect(first).not.toBe(second);
    await expect(openPageJson<FormRequest>(key, first)).resolves.toEqual(request);
    await expect(openPageJson<FormRequest>(key, second)).resolves.toEqual(request);
  });
});
