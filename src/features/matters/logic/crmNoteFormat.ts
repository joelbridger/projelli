/** Split note text into a Wealthbox-ready (title, body) pair: title is
 *  the first non-blank line, body is everything after it (or the same text
 *  again when the note is a single line, so the body is never empty).
 *
 *  Shared by every surface that can enqueue a CRM note write (the shared
 *  matter notes editor and the normal Word/note toolbar action) so they stay
 *  in sync — see MatterNotesEditor.tsx and DocxEditor.tsx. */
export function splitNoteForCrm(text: string): { title: string; body: string } {
  const trimmed = text.trim();
  const newlineIdx = trimmed.indexOf('\n');
  if (newlineIdx === -1) return { title: trimmed, body: trimmed };
  return { title: trimmed.slice(0, newlineIdx).trim(), body: trimmed.slice(newlineIdx + 1).trim() };
}

export interface DocNoteCrmWrite {
  kind: 'note';
  matterId: string;
  title: string;
  body: string;
  sourceRef: string;
  /** E3 (Tier B trust guard): set when this note is AI-drafted from a meeting
   *  (a meeting's notes.docx), so the review card can attach an honest
   *  provenance line at approval. Absent for hand-written documents. */
  aiSource?: { kind: 'meeting'; date?: string };
}

/** Recognize a meeting's AI-generated notes doc from its workspace path
 *  (`…/Meetings/<YYYY-MM-DD…>/notes.docx`) and pull the meeting date out of
 *  the dated folder name. Returns undefined for any other document, which
 *  therefore carries no "drafted by AI" provenance (we never claim a machine
 *  wrote a note it may not have). */
export function meetingAiSourceForPath(tabPath: string): { kind: 'meeting'; date?: string } | undefined {
  const m = /\/Meetings\/(\d{4}-\d{2}-\d{2})[^/]*\/notes\.docx$/i.exec(tabPath);
  if (!m) return undefined;
  return m[1] ? { kind: 'meeting', date: m[1] } : { kind: 'meeting' };
}

/**
 * Build the CRM write-queue payload for a normal (non-shared) docx note's
 * "Send to Wealthbox" toolbar action. Returns null when there's nothing to
 * queue (no extractable title, e.g. a blank or table-only document).
 *
 * `sourceRef` is the note's real workspace path (`doc:<path>`), NOT
 * `note:<matterId>` — a matter can have many separate .docx notes, unlike
 * MatterNotesEditor's single shared notes doc per matter, so the path is
 * what lets provenance ("from: ...") in the review card + audit log
 * (CrmWriteReviewCard.tsx) distinguish between them (coordinator review).
 */
export function buildDocNoteCrmWrite(
  tabPath: string,
  matterId: string,
  plainText: string,
): DocNoteCrmWrite | null {
  const { title, body } = splitNoteForCrm(plainText);
  if (!title) return null;
  const aiSource = meetingAiSourceForPath(tabPath);
  return { kind: 'note', matterId, title, body, sourceRef: `doc:${tabPath}`, ...(aiSource ? { aiSource } : {}) };
}
