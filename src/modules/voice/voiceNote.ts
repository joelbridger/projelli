/**
 * Voice note I/O (M6, v1.5).
 *
 * Small helpers that format a filename and write a transcription into
 * `<workspace>/Inbox/note-<timestamp>.md`. Kept separate from the
 * press-to-talk hook so it can be unit-tested without React.
 */

/** ISO-safe timestamp for voice note filenames. */
export function buildVoiceNoteFilename(now: Date = new Date()): string {
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
  return `Inbox/note-${date}T${time}.md`;
}

/** Markdown body for a saved voice note. */
export function buildVoiceNoteBody(text: string, now: Date = new Date()): string {
  const iso = now.toISOString();
  return [
    '---',
    `created: ${iso}`,
    'source: voice',
    '---',
    '',
    text,
    '',
  ].join('\n');
}

export interface VoiceNoteWriter {
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}

/**
 * Save a voice-note transcription to the Inbox. Creates the Inbox folder
 * if it doesn't exist. Returns the written path.
 */
export async function saveVoiceNote(
  writer: VoiceNoteWriter,
  text: string,
  now: Date = new Date(),
): Promise<string> {
  const hasInbox = await writer.exists('Inbox');
  if (!hasInbox) {
    await writer.createDirectory('Inbox');
  }
  const filename = buildVoiceNoteFilename(now);
  const body = buildVoiceNoteBody(text, now);
  await writer.writeFile(filename, body);
  return filename;
}
