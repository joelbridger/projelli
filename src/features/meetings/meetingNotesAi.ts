import { AuditService } from '@/platform/audit/AuditService';
import { LOCAL_AI_NAME } from '@/config/brandText';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Provider } from '@/platform/providers/Provider';
import { resolveAvailableLocalGenerationProvider } from '@/platform/providers/resolveLocalProvider';
import { sendPreparedMessageWithEgressAudit } from '@/platform/privacy/promptPreparation';
import { modelAuditMetrics } from '@/platform/privacy/sendWithEgressAudit';
import type { AuditEntry } from '@/platform/types/audit';
import type { TranscriptFile } from '@/platform/types/meeting';
import { meetingNoteFromTranscript } from './meetingNoteTemplate';

const meetingNotesAudit = new AuditService('meetings');

function onMeetingNotesAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
  meetingNotesAudit.log(entry.action, entry.description, {
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    inputs: entry.inputs,
    outputs: entry.outputs,
    ...(entry.userDecision !== undefined ? { userDecision: entry.userDecision } : {}),
    metadata: entry.metadata,
    ...(entry.tokensIn !== undefined ? { tokensIn: entry.tokensIn } : {}),
    ...(entry.tokensOut !== undefined ? { tokensOut: entry.tokensOut } : {}),
    ...(entry.costUsd !== undefined ? { costUsd: entry.costUsd } : {}),
    ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
  });
}

export class MeetingNotesLocalOnlyError extends Error {
  constructor() {
    super(
      `Meeting notes use local AI by default so transcripts stay on this computer. ` +
        `${LOCAL_AI_NAME} is not ready yet; set it up in Settings, then retry notes.`,
    );
    this.name = 'MeetingNotesLocalOnlyError';
  }
}

export interface ResolvedMeetingNotesProvider {
  provider: Provider;
  providerId?: string;
  model?: string;
}

interface NormalizedMeetingNotesProvider {
  provider: Provider;
  providerId: string;
  model: string;
}

async function resolveLocalMeetingNotesProvider(): Promise<NormalizedMeetingNotesProvider> {
  const resolved = await resolveAvailableLocalGenerationProvider();
  if (!resolved) throw new MeetingNotesLocalOnlyError();
  return resolved;
}

function normalizeResolvedProvider(
  resolved: ResolvedMeetingNotesProvider,
): NormalizedMeetingNotesProvider {
  const metadata = resolved.providerId && resolved.model
    ? null
    : resolved.provider.getMetadata();
  return {
    provider: resolved.provider,
    providerId: resolved.providerId ?? metadata?.providerId ?? 'unknown',
    model: resolved.model ?? metadata?.model ?? 'unknown',
  };
}

export async function generateMeetingNoteMarkdown(
  input: {
    transcript: TranscriptFile;
    matterId: string;
    signal?: AbortSignal;
    resolveProvider?: () => Promise<ResolvedMeetingNotesProvider>;
  },
): Promise<string> {
  const matter = useMatterStore
    .getState()
    .matters.find((m) => m.id === input.matterId);
  const clientName = matter ? matterLabel(matter) : input.matterId;
  const resolved = normalizeResolvedProvider(
    input.resolveProvider
      ? await input.resolveProvider()
      : await resolveLocalMeetingNotesProvider(),
  );

  return meetingNoteFromTranscript.run({
    transcript: input.transcript,
    clientName,
    ...(input.signal ? { signal: input.signal } : {}),
    send: (prompt, options) =>
      sendPreparedMessageWithEgressAudit({
        provider: resolved.provider,
        providerId: resolved.providerId,
        model: resolved.model,
        prompt,
        options,
        surface: 'meeting_notes',
        background: true,
        parts: [{ id: 'prompt', origin: 'meeting', label: 'Meeting transcript', text: prompt }],
        onAuditLog: onMeetingNotesAudit,
        scope: { kind: 'matter', matterId: input.matterId },
        modelCall: (response) => ({ action: 'model_call', description: `Meeting notes to ${resolved.model}`, model: resolved.model, inputs: { matterId: input.matterId, segmentCount: input.transcript.segments.length }, outputs: { contentLength: response.content.length }, userDecision: 'auto', metadata: { feature: 'meeting_notes' }, ...modelAuditMetrics(response), provider: resolved.providerId }),
      }),
  });
}
