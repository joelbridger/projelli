import { describe, expect, it } from 'vitest';
import type { RagHit } from '@/platform/utils/tauri-commands';
import {
  BLOCK_MARKERS,
  bindAnswerBlocks,
  isFilesBlockVerified,
  splitRawBlocks,
  stripBlockMarkers,
  tallyBlocks,
} from './answerBlockHelpers';

function hit(overrides: Partial<RagHit> = {}): RagHit {
  return {
    path: 'Clients/Webb Household/beneficiary.docx',
    chunkText: 'The old 401(k) still lists Jessica Reyes as the sole primary beneficiary, dated 2019.',
    score: 0.92,
    paragraphIndex: 3,
    sourceType: 'docx',
    id: 'chunk-bene-3',
    matterId: 'webb',
    ...overrides,
  };
}

describe('splitRawBlocks', () => {
  it('treats an unmarked answer as one files block when there were hits', () => {
    const blocks = splitRawBlocks('Their plan is moderate growth.', true);
    expect(blocks).toEqual([{ kind: 'files', text: 'Their plan is moderate growth.' }]);
  });

  it('treats an unmarked answer as one general block when there were no hits', () => {
    const blocks = splitRawBlocks('A backdoor Roth lets higher earners fund a Roth.', false);
    expect(blocks).toEqual([
      { kind: 'general', text: 'A backdoor Roth lets higher earners fund a Roth.' },
    ]);
  });

  it('splits on markers and keeps leading prose as an inferred block', () => {
    const raw = [
      'Where things stand.',
      BLOCK_MARKERS.general,
      'A backdoor Roth lets higher earners contribute indirectly.',
      BLOCK_MARKERS.draft,
      'Hi Marcus, quick question about your rollover.',
    ].join('\n');
    const blocks = splitRawBlocks(raw, true);
    expect(blocks.map((b) => b.kind)).toEqual(['files', 'general', 'draft']);
    expect(blocks[0]?.text).toBe('Where things stand.');
    expect(blocks[1]?.text).toContain('backdoor Roth');
    expect(blocks[2]?.text).toContain('Hi Marcus');
  });

  it('coalesces consecutive same-kind blocks', () => {
    const raw = [
      BLOCK_MARKERS.general,
      'First general point.',
      BLOCK_MARKERS.general,
      'Second general point.',
    ].join('\n');
    const blocks = splitRawBlocks(raw, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('general');
    expect(blocks[0]?.text).toBe('First general point.\n\nSecond general point.');
  });
});

describe('bindAnswerBlocks', () => {
  it('binds a citation inside a FILES block and leaves a GENERAL block uncited', () => {
    const raw = [
      BLOCK_MARKERS.files,
      'The old 401(k) still names Jessica Reyes as beneficiary [beneficiary.docx paragraph 3].',
      BLOCK_MARKERS.general,
      'A backdoor Roth lets higher earners fund a Roth indirectly. [some-fake.pdf paragraph 9]',
    ].join('\n');

    const result = bindAnswerBlocks(raw, [hit()], 'webb');

    expect(result.blocks.map((b) => b.kind)).toEqual(['files', 'general']);
    // FILES block: citation bound + chip in text.
    expect(result.blocks[0]?.text).toContain('{1}');
    expect(result.blocks[0]?.citations).toHaveLength(1);
    expect(result.blocks[0]?.citations[0]).toMatchObject({ n: 1, verified: true });
    // GENERAL block: no chip, and the stray fake citation marker is scrubbed out.
    expect(result.blocks[1]?.citations).toEqual([]);
    expect(result.blocks[1]?.text).not.toContain('{');
    expect(result.blocks[1]?.text).not.toContain('some-fake.pdf');
    // Turn-level: one global citation, sources present.
    expect(result.citations).toHaveLength(1);
    expect(result.sources).toHaveLength(1);
  });

  it('numbers citations globally across two FILES blocks and dedups a reused source', () => {
    const hits = [
      hit({ path: 'a.docx', chunkText: 'Alpha fact one.', paragraphIndex: 0, id: 'a0' }),
      hit({ path: 'b.docx', chunkText: 'Beta fact two.', paragraphIndex: 1, id: 'b1' }),
    ];
    const raw = [
      BLOCK_MARKERS.files,
      'Alpha fact one [a.docx paragraph 0].',
      BLOCK_MARKERS.general,
      'Some concept explanation.',
      BLOCK_MARKERS.files,
      'Beta fact two [b.docx paragraph 1]. And alpha again [a.docx paragraph 0].',
    ].join('\n');

    const result = bindAnswerBlocks(raw, hits, 'webb');
    // a.docx → 1, b.docx → 2; reused a.docx in the 2nd files block keeps {1}.
    expect(result.citations.map((c) => c.n)).toEqual([1, 2]);
    const secondFiles = result.blocks[2];
    expect(secondFiles?.text).toContain('{2}');
    expect(secondFiles?.text).toContain('{1}');
    expect((secondFiles?.citations ?? []).map((c) => c.n).sort()).toEqual([1, 2]);
  });

  it('does not double-chip a later block that only REUSES an earlier source (no spurious post-hoc)', () => {
    // A general block separates the two files blocks so they are not coalesced;
    // the second files block's ONLY marker reuses the first block's source.
    const hits = [hit({ path: 'a.docx', chunkText: 'Alpha fact one.', paragraphIndex: 0, id: 'a0' })];
    const raw = [
      BLOCK_MARKERS.files,
      'Alpha fact one [a.docx paragraph 0].',
      BLOCK_MARKERS.general,
      'A concept that explains it.',
      BLOCK_MARKERS.files,
      'Alpha fact one again [a.docx paragraph 0].',
    ].join('\n');
    const result = bindAnswerBlocks(raw, hits, 'webb');
    // Exactly one citation overall; the reused-source block carries a single {1}
    // and no spurious post-hoc {2}.
    expect(result.citations.map((c) => c.n)).toEqual([1]);
    const secondFilesText = result.blocks[2]?.text ?? '';
    expect((secondFilesText.match(/\{1\}/g) ?? []).length).toBe(1);
    expect(secondFilesText).not.toContain('{2}');
  });

  it('renumbers surviving citations to 1..N after an earlier block is downgraded', () => {
    // A general block keeps the two files blocks separate so the first (out-of-
    // matter, unverified) block downgrades on its own while the second verifies.
    const hits = [
      hit({ path: 'a.docx', chunkText: 'Alpha fact.', paragraphIndex: 0, id: 'a0', matterId: 'other' }),
      hit({ path: 'b.docx', chunkText: 'Beta fact.', paragraphIndex: 1, id: 'b1', matterId: 'webb' }),
    ];
    const raw = [
      BLOCK_MARKERS.files,
      'Alpha fact [a.docx paragraph 0].', // out-of-matter → binds {1} unverified → downgraded
      BLOCK_MARKERS.general,
      'A concept.',
      BLOCK_MARKERS.files,
      'Beta fact [b.docx paragraph 1].', // in-matter → verified, stays files
    ].join('\n');
    const result = bindAnswerBlocks(raw, hits, 'webb');
    expect(result.blocks[0]?.kind).toBe('general'); // downgraded
    expect(result.blocks[2]?.kind).toBe('files');
    // Survivor renumbered to {1}, not {2}; Sources panel starts at 1.
    expect(result.citations.map((c) => c.n)).toEqual([1]);
    expect(result.blocks[2]?.text).toContain('{1}');
    expect(result.blocks[2]?.text).not.toContain('{2}');
  });

  it('produces an uncited nothing-found block + general block with no chips', () => {
    const raw = [
      BLOCK_MARKERS.nothingFound,
      "I didn't find anything in the Webbs' files about long-term care insurance.",
      BLOCK_MARKERS.general,
      "Here's how advisors usually frame that conversation.",
    ].join('\n');

    const result = bindAnswerBlocks(raw, []);
    expect(result.blocks.map((b) => b.kind)).toEqual(['nothing-found', 'general']);
    expect(result.citations).toEqual([]);
    expect(result.blocks.every((b) => b.citations.length === 0)).toBe(true);
  });

  it('downgrades a FILES block to general when no citation grounds (fabricated source)', () => {
    const raw = [
      BLOCK_MARKERS.files,
      'The settlement was $2,700,000 [made-up-filing.docx paragraph 1].',
    ].join('\n');
    // A real hit exists, but the model cited a different, non-retrieved file.
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    // The block must NOT keep the green "files" label over ungrounded prose.
    expect(result.blocks[0]?.kind).toBe('general');
    expect(result.blocks[0]?.text).not.toContain('{');
    expect(result.blocks[0]?.text).not.toContain('made-up-filing.docx');
    expect(result.citations).toEqual([]);
  });

  it('downgrades a FILES block whose only citation is out-of-matter (unverified)', () => {
    const raw = [
      BLOCK_MARKERS.files,
      'The old 401(k) names Jessica Reyes [beneficiary.docx paragraph 3].',
    ].join('\n');
    // Hit belongs to a DIFFERENT matter than the active scope → binds unverified.
    const result = bindAnswerBlocks(raw, [hit({ matterId: 'someone-else' })], 'webb');
    expect(result.blocks[0]?.kind).toBe('general');
    expect(result.citations).toEqual([]);
  });

  it('splits a trailing UNCITED general sentence off a cited files block', () => {
    // Cardinal-rule guard: the model put general guidance INSIDE a files block.
    // The cited head stays green; the trailing general claim becomes a general
    // block (review P1).
    const raw = [
      BLOCK_MARKERS.files,
      'The Webbs hold about $96k in a pre-tax 401(k) [beneficiary.docx paragraph 3]. ' +
        'Generally, the IRS pro-rata rule counts existing pre-tax IRA money toward a Roth conversion.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks.map((b) => b.kind)).toEqual(['files', 'general']);
    // Cited head keeps its chip; trailing general has none.
    expect(result.blocks[0]?.text).toContain('{1}');
    expect(result.blocks[0]?.citations).toHaveLength(1);
    expect(result.blocks[1]?.text).toContain('pro-rata');
    expect(result.blocks[1]?.text).not.toContain('{');
    expect(result.blocks[1]?.citations).toEqual([]);
    expect(result.citations).toHaveLength(1);
  });

  it('keeps a MID-SENTENCE citation\'s whole sentence under files (no split when nothing trails)', () => {
    // "According to the plan {1}, the target retirement age is 60." — the citation
    // is mid-sentence; the rest of THAT sentence is part of the cited claim.
    const raw = [
      BLOCK_MARKERS.files,
      'According to the plan [beneficiary.docx paragraph 3], the target retirement age is 60.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.kind).toBe('files');
    expect(result.blocks[0]?.text).toContain('target retirement age is 60');
  });

  it('demotes general prose that FOLLOWS a mid-sentence citation\'s sentence', () => {
    // The reported gap: cite mid-sentence, finish the cited sentence, THEN add a
    // separate general sentence. The cited sentence stays green; the general
    // sentence after it is demoted.
    const raw = [
      BLOCK_MARKERS.files,
      'According to the plan [beneficiary.docx paragraph 3], the target retirement age is 60. ' +
        'Generally, the pro-rata rule taxes Roth conversions across all pre-tax IRA money.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks.map((b) => b.kind)).toEqual(['files', 'general']);
    expect(result.blocks[0]?.text).toContain('target retirement age is 60');
    expect(result.blocks[0]?.text).toContain('{1}');
    expect(result.blocks[1]?.text).toContain('pro-rata');
    expect(result.blocks[1]?.text).not.toContain('target retirement age');
  });

  it('does not split mid-decimal when a cited sentence contains a number like $1.5M', () => {
    const raw = [
      BLOCK_MARKERS.files,
      'The plan [beneficiary.docx paragraph 3] targets $1.5M by age 60.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.kind).toBe('files');
    expect(result.blocks[0]?.text).toContain('$1.5M');
  });

  it('splits a trailing claim after a PARENTHESIZED final citation', () => {
    // The model wrapped the citation in parentheses: "Fact ([f p3]). Generally…"
    // → "Fact ({1}). Generally…". The ")." still makes the citation sentence-final.
    const raw = [
      BLOCK_MARKERS.files,
      'The old 401(k) is unrolled ([beneficiary.docx paragraph 3]). Generally, the pro-rata rule taxes conversions.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks.map((b) => b.kind)).toEqual(['files', 'general']);
    expect(result.blocks[0]?.text).toContain('{1}');
    expect(result.blocks[1]?.text).toContain('pro-rata');
    // The general tail must not start with stray punctuation from the paren.
    expect(result.blocks[1]?.text.startsWith(')')).toBe(false);
    expect(result.blocks[1]?.text.startsWith('.')).toBe(false);
  });

  it('splits a trailing claim after a curly-quote-wrapped final citation', () => {
    // Models commonly emit smart/curly quotes: 'Fact {1}”. Generally…'
    const raw = [
      BLOCK_MARKERS.files,
      '“The old 401(k) is unrolled” [beneficiary.docx paragraph 3]”. Generally, the pro-rata rule taxes conversions.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks.map((b) => b.kind)).toEqual(['files', 'general']);
    expect(result.blocks[1]?.text).toContain('pro-rata');
    expect(result.blocks[1]?.text.startsWith('”')).toBe(false);
  });

  it('splits even a VERY SHORT substantive trailing claim ("Taxable.")', () => {
    const raw = [
      BLOCK_MARKERS.files,
      'The distribution came from the old 401(k) [beneficiary.docx paragraph 3]. Taxable.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks.map((b) => b.kind)).toEqual(['files', 'general']);
    expect(result.blocks[1]?.text).toContain('Taxable');
  });

  it('does NOT split a recognised filler/acknowledgment trailer', () => {
    const raw = [
      BLOCK_MARKERS.files,
      'The old 401(k) holds about $96k [beneficiary.docx paragraph 3]. Got it.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.kind).toBe('files');
  });

  it('does NOT split when the citation trails a shared cluster (no false positive)', () => {
    // "A. B {1}." — one citation legitimately covers both sentences and nothing
    // groundable follows it, so the block stays a single files block.
    const raw = [
      BLOCK_MARKERS.files,
      'The portfolio is moderate-growth and rebalanced once a year. ' +
        'They want to retire at 60 [beneficiary.docx paragraph 3].',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.kind).toBe('files');
    expect(result.blocks[0]?.text).toContain('{1}');
  });

  it('downgrades a FILES block that MIXES a verified and an unverified citation', () => {
    // One in-matter (verified) + one out-of-matter (unverified) citation in the
    // same block. The block must NOT stay green — an unverified chip can't sit
    // under "From your files" and the "every cited claim checkable" attestation
    // would over-claim. Whole block downgrades; no citation survives.
    const hits = [
      hit({ path: 'good.docx', chunkText: 'In-scope fact.', paragraphIndex: 0, id: 'g0', matterId: 'webb' }),
      hit({ path: 'other.docx', chunkText: 'Out-of-scope fact.', paragraphIndex: 1, id: 'o1', matterId: 'other' }),
    ];
    const raw = [
      BLOCK_MARKERS.files,
      'In-scope fact [good.docx paragraph 0] and out-of-scope fact [other.docx paragraph 1].',
    ].join('\n');
    const result = bindAnswerBlocks(raw, hits, 'webb');
    expect(result.blocks[0]?.kind).toBe('general');
    expect(result.blocks[0]?.text).not.toContain('{');
    expect(result.citations).toEqual([]);
  });

  it('downgrades an unmarked answer (inferred files) when nothing grounds', () => {
    // Model ignored the block protocol; retrieval returned a hit, but the prose
    // is general and grounds to nothing → must not be labelled "From your files".
    const result = bindAnswerBlocks(
      'A backdoor Roth lets higher earners contribute to a Roth indirectly.',
      [hit()],
      'webb',
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.kind).toBe('general');
    expect(result.citations).toEqual([]);
  });

  it('does not bind or chip inside a DRAFT block', () => {
    const raw = [
      BLOCK_MARKERS.draft,
      'Hi Marcus, before we move your old 401(k) [beneficiary.docx paragraph 3], confirm the form.',
    ].join('\n');
    const result = bindAnswerBlocks(raw, [hit()], 'webb');
    expect(result.blocks[0]?.kind).toBe('draft');
    expect(result.blocks[0]?.citations).toEqual([]);
    expect(result.blocks[0]?.text).not.toContain('{');
    expect(result.blocks[0]?.text).not.toContain('beneficiary.docx paragraph 3');
  });
});

describe('stripBlockMarkers', () => {
  it('removes every marker and collapses the gaps', () => {
    const raw = `${BLOCK_MARKERS.files}\nHello there.\n${BLOCK_MARKERS.general}\nGeneral note.`;
    expect(stripBlockMarkers(raw)).toBe('Hello there.\n\nGeneral note.');
  });

  it('strips a trailing PARTIAL marker so it never flashes mid-stream', () => {
    expect(stripBlockMarkers('Where things stand.\n[[BLOCK:')).toBe('Where things stand.');
    expect(stripBlockMarkers('Some prose.\n[[BLOCK:GENERAL')).toBe('Some prose.');
    expect(stripBlockMarkers('Some prose.\n[[BLOCK:GENERAL]')).toBe('Some prose.');
    expect(stripBlockMarkers('Some prose.\n[[')).toBe('Some prose.');
  });

  it('never eats a real single-bracket citation', () => {
    expect(stripBlockMarkers('The award was $100 [filing.pdf page 2]')).toBe(
      'The award was $100 [filing.pdf page 2]',
    );
  });
});

describe('B1 — a post-hoc-grounded files block is kept but NOT verified', () => {
  // The model wrote a files-labelled block with NO explicit citation marker, but
  // its sentence post-hoc-grounds to a retrieved chunk. The chip must be KEPT
  // (grounded) so the citation isn't dropped, but the block-level green trust UI
  // must NOT be earned — the citation is grounded:true, verified:false.
  const postHocFilesAnswer = [
    BLOCK_MARKERS.files,
    'The old 401(k) still lists Jessica Reyes as the sole primary beneficiary, dated 2019.',
  ].join('\n');

  it('keeps the files block and its chip but marks the citation grounded, not verified', () => {
    const result = bindAnswerBlocks(postHocFilesAnswer, [hit()], 'webb');
    const filesBlock = result.blocks.find((b) => b.kind === 'files');
    if (!filesBlock) throw new Error('expected a files block');
    expect(filesBlock.citations).toHaveLength(1); // chip kept, not removed
    expect(filesBlock.citations[0]?.grounded).toBe(true);
    expect(filesBlock.citations[0]?.verified).toBe(false);
    // The block-level green "From your files" trust label is NOT earned.
    expect(isFilesBlockVerified(filesBlock)).toBe(false);
  });

  it('tallies it as a found-but-unverified source, not a verified cited claim', () => {
    const result = bindAnswerBlocks(postHocFilesAnswer, [hit()], 'webb');
    const tally = tallyBlocks(result.blocks);
    expect(tally.citedClaims).toBe(1);
    expect(tally.verifiedClaims).toBe(0); // never counted as "checkable"
  });

  it('marks an EXPLICIT in-scope citation as a verified files block', () => {
    const result = bindAnswerBlocks(
      [BLOCK_MARKERS.files, 'Beneficiary is Jessica Reyes [beneficiary.docx paragraph 3].'].join('\n'),
      [hit()],
      'webb',
    );
    const filesBlock = result.blocks.find((b) => b.kind === 'files');
    if (!filesBlock) throw new Error('expected a files block');
    expect(isFilesBlockVerified(filesBlock)).toBe(true);
    expect(tallyBlocks(result.blocks).verifiedClaims).toBe(1);
  });
});

describe('tallyBlocks', () => {
  it('counts distinct cited claims and flags general/draft/nothing-found', () => {
    const result = bindAnswerBlocks(
      [
        BLOCK_MARKERS.files,
        'Fact [beneficiary.docx paragraph 3].',
        BLOCK_MARKERS.general,
        'Concept.',
        BLOCK_MARKERS.draft,
        'Hi Marcus.',
      ].join('\n'),
      [hit()],
      'webb',
    );
    const tally = tallyBlocks(result.blocks);
    expect(tally).toEqual({
      citedClaims: 1,
      // The explicit `[beneficiary.docx paragraph 3]` citation in-scope is
      // verified, so it counts toward both totals.
      verifiedClaims: 1,
      hasGeneral: true,
      hasDraft: true,
      hasNothingFound: false,
    });
  });
});
