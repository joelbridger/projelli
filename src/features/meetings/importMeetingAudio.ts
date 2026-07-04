import { invoke } from '@tauri-apps/api/core';

export interface ImportDeps {
  /** Copies the source file into a fresh meeting folder for the matter and
   *  returns the meeting dir. Default impl uses WorkspaceService (all writes
   *  go through it) + the matter store's folder for `matterId`, converting
   *  non-WAV input with the WebAudio decode + `encodeWav16kMono` pipeline
   *  (src/features/dictation/voice/VoiceCapture.ts) and writing `audio.wav`. */
  copyIntoMeetingFolder: (filePath: string, matterId: string) => Promise<string>;
}

/**
 * Imports a user-picked audio file (`.wav`/`.webm`/`.m4a`/`.mp3`) as a new
 * meeting and transcribes it. Imported audio is single-channel, so
 * `transcribe_meeting` attributes every segment to "sys"/"Them" — the UI
 * labels these meetings "imported — speakers not separated".
 */
export async function importMeetingAudio(
  filePath: string,
  matterId: string,
  workspaceRoot: string,
  deps: ImportDeps,
): Promise<{ meetingDir: string }> {
  const meetingDir = await deps.copyIntoMeetingFolder(filePath, matterId);
  await invoke('transcribe_meeting', { workspaceRoot, meetingDir, model: null });
  return { meetingDir };
}
