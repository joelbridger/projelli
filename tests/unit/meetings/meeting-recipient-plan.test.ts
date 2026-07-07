import { describe, expect, it, vi } from 'vitest';
import {
  addRecipientToArtifact,
  buildMeetingRecipientSuggestions,
  emptyMeetingRecipientArtifacts,
  normalizeMeetingDeliveryPlan,
  saveMeetingRecipientPlan,
  validateMeetingDeliveryPlan,
  type MeetingDeliveryPlan,
} from '@/features/meetings/meetingRecipientPlan';
import type { Matter } from '@/platform/types/matter';

const NOW = '2026-07-07T12:00:00.000Z';

function emptyPlan(): MeetingDeliveryPlan {
  return {
    version: 1,
    updatedAt: NOW,
    artifacts: emptyMeetingRecipientArtifacts(),
  };
}

describe('meeting recipient plan', () => {
  it('keeps each artifact recipient list separate and dedupes by email', () => {
    let plan = emptyPlan();

    plan = addRecipientToArtifact(plan, 'summary', {
      email: 'Robert@Example.com',
      name: 'Robert',
      source: 'manual',
    }, NOW);
    plan = addRecipientToArtifact(plan, 'summary', {
      email: 'Robert <robert@example.com>',
      name: 'Bob',
      source: 'manual',
    }, NOW);
    plan = addRecipientToArtifact(plan, 'audio', {
      email: 'susan@example.com',
      source: 'manual',
    }, NOW);

    expect(plan.artifacts.summary).toEqual([{ email: 'robert@example.com', name: 'Robert', source: 'manual' }]);
    expect(plan.artifacts.audio).toEqual([{ email: 'susan@example.com', source: 'manual' }]);
    expect(plan.artifacts.transcript).toEqual([]);
    expect(plan.artifacts.notes).toEqual([]);
  });

  it('reports invalid email addresses before saving', () => {
    const issues = validateMeetingDeliveryPlan({
      version: 1,
      updatedAt: NOW,
      artifacts: {
        ...emptyMeetingRecipientArtifacts(),
        transcript: [{ email: 'not-an-email', source: 'manual' }],
      },
    });

    expect(issues).toEqual([
      { artifact: 'transcript', email: 'not-an-email', message: 'Enter a real email address.' },
    ]);
  });

  it('builds suggestions from saved calendar people, taught client emails, and the existing plan', () => {
    const matter: Matter = {
      id: 'matter-1',
      name: 'Hendricks Household',
      client: 'Hendricks',
      folderPaths: ['/ws/Hendricks'],
      meetingKeys: ['secondary@example.com', 'not a real email'],
      createdAt: NOW,
    };
    const plan = normalizeMeetingDeliveryPlan({
      version: 1,
      updatedAt: NOW,
      artifacts: {
        ...emptyMeetingRecipientArtifacts(),
        notes: [{ email: 'notes@example.com', name: 'Notes Person', source: 'manual' }],
      },
    }, NOW);

    const suggestions = buildMeetingRecipientSuggestions({
      deliveryPlan: plan,
      calendarEvent: {
        attendees: [
          { email: 'client@example.com', name: 'Client One' },
          { email: 'CLIENT@example.com', name: 'Duplicate Client' },
        ],
      },
    }, matter);

    expect(suggestions.map((recipient) => recipient.email).sort()).toEqual([
      'client@example.com',
      'notes@example.com',
      'secondary@example.com',
    ]);
  });

  it('saves the plan onto the meeting only when the meeting belongs to this client', async () => {
    const files = new Map<string, string>();
    files.set('/ws/Hendricks/Meetings/one/meeting.json', JSON.stringify({
      matterId: 'matter-1',
      startedAt: NOW,
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: NOW },
    }));
    const ws = {
      readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
    };
    const plan = addRecipientToArtifact(emptyPlan(), 'summary', {
      email: 'client@example.com',
      source: 'manual',
    }, NOW);

    await saveMeetingRecipientPlan(ws, '/ws/Hendricks/Meetings/one', 'matter-1', plan, NOW);

    const written = JSON.parse(files.get('/ws/Hendricks/Meetings/one/meeting.json') ?? '{}') as {
      matterId: string;
      deliveryPlan: MeetingDeliveryPlan;
    };
    expect(written.matterId).toBe('matter-1');
    expect(written.deliveryPlan.artifacts.summary).toEqual([{ email: 'client@example.com', source: 'manual' }]);

    await expect(
      saveMeetingRecipientPlan(ws, '/ws/Hendricks/Meetings/one', 'other-matter', plan, NOW),
    ).rejects.toThrow('This meeting belongs to a different client.');
  });
});
