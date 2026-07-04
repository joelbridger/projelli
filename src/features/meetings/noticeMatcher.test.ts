import { describe, it, expect } from 'vitest';
import { detectRecordingNotice, type NoticeMatch, type NoticeSegmentInput } from './noticeMatcher';

/** Asserts a match and narrows the type (avoids non-null assertions). */
function must(m: NoticeMatch | null): NoticeMatch {
  if (!m) throw new Error('expected a match, got null');
  return m;
}

/** Helper: one segment starting at a given ms. */
function seg(text: string, startMs = 0): NoticeSegmentInput {
  return { startMs, text };
}

/** Wraps a single line of speech as the whole transcript window. */
function line(text: string, startMs = 0): NoticeSegmentInput[] {
  return [seg(text, startMs)];
}

describe('detectRecordingNotice — English semantic core', () => {
  // Paraphrases a real advisor would say — every one MUST be detected.
  const passes: string[] = [
    "I'm recording this meeting for my notes. Is that alright with everyone?",
    "Quick note before we start — I'm recording this meeting for my notes. The recording stays on my computer. Is that alright with everyone?",
    "I'm going to record this call for notes, okay?",
    "I'd like to record this for my notes. Is that alright with everyone?",
    "Let me just record this session so I have good notes.",
    "Before we begin, I want to let you know I'll be recording our conversation.",
    "So I'm recording now, just so you know.",
    "We're recording this meeting today for note-taking.",
  ];
  for (const text of passes) {
    it(`PASS: ${text.slice(0, 40)}…`, () => {
      const match = detectRecordingNotice(line(text));
      expect(match, `expected a match for: ${text}`).not.toBeNull();
      expect(must(match).confidence).toBeGreaterThanOrEqual(0.5);
      expect(must(match).snippet).toContain(text.slice(0, 5));
    });
  }

  // Decoys — mentions of recording that are NOT a first-person disclosure.
  const fails: string[] = [
    'They record everything these days, it feels like.',
    'I never record meetings without asking first.',
    "We don't record these calls as a rule.",
    'The recording industry has changed a lot.',
    "My last advisor used to record but I asked her not to.",
    'Did you record the game last night?',
    "I won't be recording anything today.",
    'The court record shows the transaction.',
    // codex-review R1: an auxiliary near the verb must not stand in for the
    // subject — the real third/second-person subject still governs.
    'They were recording the webinar earlier.',
    'You are going to record this yourself, right?',
    'He said they record every session.',
  ];
  for (const text of fails) {
    it(`FAIL: ${text.slice(0, 40)}…`, () => {
      expect(detectRecordingNotice(line(text)), `expected NO match for: ${text}`).toBeNull();
    });
  }
});

describe('detectRecordingNotice — timestamp + snippet', () => {
  it('reports the audio timestamp of the matched segment', () => {
    const segments: NoticeSegmentInput[] = [
      seg('Hi, thanks for making time today.', 0),
      seg('Good to see you.', 4000),
      seg("Quick thing — I'm recording this for my notes, that okay?", 14000),
    ];
    const match = detectRecordingNotice(segments);
    expect(match).not.toBeNull();
    expect(must(match).atMs).toBe(14000);
    expect(must(match).snippet).toContain('recording this for my notes');
  });

  it('returns the earliest qualifying notice when several match', () => {
    const segments: NoticeSegmentInput[] = [
      seg("I'm recording this for notes.", 5000),
      seg("Again, just noting I'm recording this.", 30000),
    ];
    const match = detectRecordingNotice(segments);
    expect(must(match).atMs).toBe(5000);
  });
});

describe('detectRecordingNotice — confidence scoring', () => {
  it('scores a full notice (disclosure + notes + consent ask) higher than a bare one', () => {
    const full = detectRecordingNotice(
      line("I'm recording this meeting for my notes. Is that alright with everyone?"),
    );
    const bare = detectRecordingNotice(line("So I'm recording now."));
    expect(must(full).confidence).toBeGreaterThan(must(bare).confidence);
  });

  it('never exceeds 1.0', () => {
    const match = detectRecordingNotice(
      line("I'm recording this for my notes, consent, is that alright with everyone, okay?"),
    );
    expect(must(match).confidence).toBeLessThanOrEqual(1.0);
  });
});

describe('detectRecordingNotice — window filter', () => {
  it('ignores a notice that lands after the scan window', () => {
    const segments = [seg("I'm recording this for my notes.", 400_000)]; // 6m40s in
    expect(detectRecordingNotice(segments, { windowMs: 5 * 60_000 })).toBeNull();
  });
  it('detects a notice inside the scan window', () => {
    const segments = [seg("I'm recording this for my notes.", 60_000)];
    expect(detectRecordingNotice(segments, { windowMs: 5 * 60_000 })).not.toBeNull();
  });
});

describe('detectRecordingNotice — German', () => {
  it('PASS: erste-Person Aufnahme-Hinweis', () => {
    const match = detectRecordingNotice(
      line('Kurz vorab — ich nehme dieses Gespräch für meine Notizen auf. Ist das für alle in Ordnung?'),
      { locale: 'de' },
    );
    expect(match).not.toBeNull();
  });
  it('PASS: aufzeichnen variant', () => {
    expect(
      detectRecordingNotice(line('Ich werde dieses Meeting für meine Notizen aufzeichnen.'), { locale: 'de' }),
    ).not.toBeNull();
  });
  it('FAIL: dritte Person', () => {
    expect(
      detectRecordingNotice(line('Sie nehmen heutzutage alles auf.'), { locale: 'de' }),
    ).toBeNull();
  });
  it('FAIL: verneint', () => {
    expect(
      detectRecordingNotice(line('Ich nehme niemals ohne zu fragen auf.'), { locale: 'de' }),
    ).toBeNull();
  });
});

describe('detectRecordingNotice — Spanish', () => {
  it('PASS: primera persona (estoy grabando)', () => {
    const match = detectRecordingNotice(
      line('Antes de empezar, estoy grabando esta reunión para mis notas. ¿Está bien para todos?'),
      { locale: 'es' },
    );
    expect(match).not.toBeNull();
  });
  it('PASS: grabo (conjugación de primera persona)', () => {
    expect(
      detectRecordingNotice(line('Grabo esta llamada para mis notas, ¿de acuerdo?'), { locale: 'es' }),
    ).not.toBeNull();
  });
  it('FAIL: tercera persona', () => {
    expect(
      detectRecordingNotice(line('Ellos graban todo hoy en día.'), { locale: 'es' }),
    ).toBeNull();
  });
  it('FAIL: gerundio en tercera persona (codex-review R1)', () => {
    expect(
      detectRecordingNotice(line('Ellos están grabando la reunión.'), { locale: 'es' }),
    ).toBeNull();
    expect(
      detectRecordingNotice(line('¿Usted está grabando esto?'), { locale: 'es' }),
    ).toBeNull();
  });
  it('FAIL: negado', () => {
    expect(
      detectRecordingNotice(line('No grabo nunca sin permiso.'), { locale: 'es' }),
    ).toBeNull();
  });
});

describe('detectRecordingNotice — custom firm phrases', () => {
  it('detects a firm script even when it avoids the word "record" via phrase overlap', () => {
    // A firm chooses unusual wording; feeding it as an expected phrase lets the
    // matcher recognize it by token overlap rather than the semantic core alone.
    const custom = 'For quality and my notes, this session is being captured on my device.';
    const match = detectRecordingNotice(
      line('For quality and my notes, this session is being captured on my device.'),
      { customPhrases: [custom] },
    );
    expect(match).not.toBeNull();
  });

  it('does not match unrelated speech just because a custom phrase exists', () => {
    const custom = 'For quality and my notes, this session is being captured on my device.';
    const match = detectRecordingNotice(
      line('So how did the kids soccer tournament go this weekend?'),
      { customPhrases: [custom] },
    );
    expect(match).toBeNull();
  });
});

describe('detectRecordingNotice — robustness', () => {
  it('returns null for an empty transcript', () => {
    expect(detectRecordingNotice([])).toBeNull();
  });
  it('handles segments with empty text without throwing', () => {
    expect(detectRecordingNotice([seg('', 0), seg('   ', 1000)])).toBeNull();
  });
});
