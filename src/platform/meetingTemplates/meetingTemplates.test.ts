import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  createFirmOwnedMeetingTemplate,
  fillMeetingTemplateFromTranscript,
  makeMeetingTemplateStorage,
  renderClientFacingMeetingNote,
  type ClientFacingMeetingNote,
  type InternalMeetingNote,
} from './index';

const transcript: TranscriptFile = {
  segments: [{ startMs: 12_000, endMs: 17_000, channel: 'sys', speaker: 'Client', text: 'We will review the plan.' }],
  meta: {
    startedAt: '2026-07-12T09:00:00.000Z',
    durationMs: 17_000,
    matterId: 'client-1',
    consent: { mode: 'two-party', confirmedBy: 'advisor', confirmedAt: '2026-07-12T08:59:00.000Z' },
  },
};

function template(audience: 'internal' | 'client-facing') {
  return createFirmOwnedMeetingTemplate({
    id: `${audience}-review`,
    firmId: 'firm-1',
    name: `${audience} review`,
    audience,
    blocks: [{ id: 'summary', label: 'Summary', instruction: 'Summarize the discussion.', required: true }],
    now: '2026-07-12T09:00:00.000Z',
  });
}

const provider = {
  send: async () => ({ content: JSON.stringify({ sections: [{ id: 'summary', body: 'Plan review agreed.', citations: [12_000] }] }) }),
};

describe('firm meeting templates', () => {
  it('keeps internal and client-facing notes as disjoint types', () => {
    expectTypeOf<InternalMeetingNote>().not.toMatchTypeOf<ClientFacingMeetingNote>();
    expectTypeOf<ClientFacingMeetingNote>().not.toMatchTypeOf<InternalMeetingNote>();
  });

  it('creates a client-renderable value only from a client-facing layout', async () => {
    const filled = await fillMeetingTemplateFromTranscript({
      template: template('client-facing'), transcript, provider,
    });
    if (filled.audience !== 'client-facing') throw new Error('Expected a client-facing note.');

    expect(renderClientFacingMeetingNote(filled, 'Your meeting recap')).toEqual({
      title: 'Your meeting recap',
      sections: [{ heading: 'Summary', body: 'Plan review agreed.', citations: [12_000] }],
    });
  });

  it('refuses an internal note even if unsafe JavaScript bypasses the type checker', async () => {
    const internal = await fillMeetingTemplateFromTranscript({
      template: template('internal'), transcript, provider,
    });
    if (internal.audience !== 'internal') throw new Error('Expected an internal note.');

    expect(() => renderClientFacingMeetingNote(internal as unknown as ClientFacingMeetingNote, 'Leak attempt'))
      .toThrow('Refused to render a meeting note without client-facing capability.');
  });

  it('will not let a stored layout change lanes after a firm owns it', async () => {
    const files = new Map<string, string>();
    const storage = makeMeetingTemplateStorage({
      readFile: async (path) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('ENOENT');
        return value;
      },
      writeFile: async (path, content) => { files.set(path, content); },
    });
    const internal = template('internal');
    await storage.save(internal);

    await expect(storage.save({ ...internal, audience: 'client-facing', version: 2 }))
      .rejects.toThrow('cannot move between internal and client-facing lanes');
  });
});
