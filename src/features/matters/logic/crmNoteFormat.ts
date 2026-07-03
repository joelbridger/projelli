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
