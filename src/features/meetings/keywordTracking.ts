// Local keyword tracking over meeting transcripts (Wave 4 Track D). Runs
// entirely against on-disk transcripts, no dashboards — a "Topics covered"
// line per meeting and a per-client rollup.

export interface TranscriptSegmentLike {
  startMs: number;
  endMs: number;
  channel: 'mic' | 'sys';
  speaker?: string;
  text: string;
}

export interface TranscriptFileLike {
  segments: TranscriptSegmentLike[];
  meta: Record<string, unknown>;
}

export interface KeywordHitLocation {
  startMs: number;
  segmentIndex: number;
}

export interface KeywordHit {
  term: string;
  count: number;
  hits: KeywordHitLocation[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word/phrase, case-insensitive match; terms are regex-escaped so
 * punctuation like "401(k)" is matched literally. */
function termPattern(term: string): RegExp {
  const escaped = escapeRegExp(term.trim());
  const startsWord = /^[\w]/.test(term.trim());
  const endsWord = /[\w]$/.test(term.trim());
  const left = startsWord ? '\\b' : '';
  const right = endsWord ? '\\b' : '';
  return new RegExp(`${left}${escaped}${right}`, 'gi');
}

export function scanKeywords(transcript: TranscriptFileLike, terms: string[]): KeywordHit[] {
  const results: KeywordHit[] = [];
  for (const rawTerm of terms) {
    const term = rawTerm.trim();
    if (!term) continue;
    const pattern = termPattern(term);
    const hits: KeywordHitLocation[] = [];
    transcript.segments.forEach((segment, segmentIndex) => {
      pattern.lastIndex = 0;
      if (pattern.test(segment.text)) {
        hits.push({ startMs: segment.startMs, segmentIndex });
      }
    });
    if (hits.length > 0) {
      results.push({ term, count: hits.length, hits });
    }
  }
  return results;
}
