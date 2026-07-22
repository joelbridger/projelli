import { describe, expect, it } from 'vitest';
import type { RagHit } from '@/platform/utils/tauri-commands';
import type { AskTurn } from './askHelpers';
import {
  filterAskMeetingVisibilityHits,
  filterPersistedAskTurnsForMeetingVisibility,
} from './useAsk';

function hit(path: string, text: string): RagHit {
  return {
    path,
    sourceId: path,
    chunkText: text,
    score: 1,
    paragraphIndex: 0,
    matterId: 'matter-1',
  };
}

describe('Ask meeting visibility backstop', () => {
  it('removes hidden meeting text before the prompt input is built', async () => {
    const hidden = hit(
      '/ws/client/Meetings/private/notes.docx',
      'secret promised follow-up'
    );
    const visible = hit('/ws/client/tax.pdf', 'public tax fact');
    const filtered = await filterAskMeetingVisibilityHits(
      [hidden, visible],
      async (hits) => hits.filter((candidate) => candidate.path !== hidden.path)
    );

    expect(filtered.map((candidate) => candidate.chunkText)).toEqual([
      'public tax fact',
    ]);
    expect(JSON.stringify(filtered)).not.toContain('secret promised follow-up');
  });

  it('removes an entire saved answer when its private meeting source is no longer visible', async () => {
    const hiddenPath = '/ws/client/Meetings/private/transcript.json';
    const privateTurn: AskTurn = {
      question: 'What did they promise?',
      answer: 'They promised the secret transfer. {1}',
      citations: [
        {
          n: 1,
          label: 'Private transcript',
          excerpt: 'secret transfer',
          path: hiddenPath,
          locator: 'paragraph 1',
          verified: true,
        },
      ],
      sources: [hit(hiddenPath, 'secret transfer')],
      groundedFromFiles: true,
    };
    const generalTurn: AskTurn = {
      question: 'Draft a greeting',
      answer: 'Hello!',
      citations: [],
      sources: [],
      groundedFromFiles: false,
    };

    const visible = await filterPersistedAskTurnsForMeetingVisibility(
      [privateTurn, generalTurn],
      async () => []
    );

    expect(visible).toEqual([generalTurn]);
    expect(JSON.stringify(visible)).not.toContain('secret transfer');
    expect(JSON.stringify(visible)).not.toContain('Private transcript');
  });

  it('fails closed for old grounded answers that have no resolvable saved source', async () => {
    const legacy: AskTurn = {
      question: 'Old question',
      answer: 'Old private answer',
      citations: [],
      sources: [],
    };
    await expect(
      filterPersistedAskTurnsForMeetingVisibility([legacy], async () => [])
    ).resolves.toEqual([]);
  });
});
