import {
  broadestConsentScope,
  fileToolsAllowed,
  type ConsentScope,
  type FileAccessConsent,
} from '@/platform/ai/fileAccessConsent';
import type { ChatMessage } from '@/platform/types/ai';
import type { AskTurn, RecentAskSession } from './askHelpers';

interface AskSessionLike {
  messages: ChatMessage[];
  workspaceRoot?: string;
  title?: string;
}

export function turnIsFileDerived(turn: AskTurn): boolean {
  if (
    turn.citations.length > 0 ||
    turn.sources.length > 0 ||
    (turn.blocks?.some((block) => block.kind === 'files') ?? false)
  ) {
    return true;
  }
  return turn.groundedFromFiles !== false;
}

export function selectHistoryTurns(
  turns: AskTurn[],
  consent: FileAccessConsent,
  providerIsCloud: boolean,
  currentTurnScope: ConsentScope,
): AskTurn[] {
  if (!providerIsCloud) return turns;
  const currentAllowsFileContent = fileToolsAllowed(consent, currentTurnScope);
  return turns.filter((turn) => {
    if (!turnIsFileDerived(turn)) return true;
    if (!currentAllowsFileContent) return false;
    const groundedScope: ConsentScope = turn.groundingScope ?? {
      kind: 'allMatters',
    };
    return fileToolsAllowed(consent, groundedScope);
  });
}

export function deriveTurnGrounding(opts: {
  hadFreshHits: boolean;
  turnScope: ConsentScope;
  historyTurns: AskTurn[];
}): { usedFileContent: boolean; scope?: ConsentScope } {
  const fileDerivedHistory = opts.historyTurns.filter(turnIsFileDerived);
  const usedFileContent = opts.hadFreshHits || fileDerivedHistory.length > 0;
  if (!usedFileContent) return { usedFileContent: false };
  const contributing: ConsentScope[] = [
    ...(opts.hadFreshHits ? [opts.turnScope] : []),
    ...fileDerivedHistory.map(
      (turn) => turn.groundingScope ?? { kind: 'allMatters' as const },
    ),
  ];
  return { usedFileContent: true, scope: broadestConsentScope(contributing) };
}

export function buildHistoryBlock(turns: AskTurn[], maxTurns = 6): string {
  if (turns.length === 0) return '';
  const recent = turns.slice(-maxTurns);
  const lines: string[] = ['Conversation so far (last exchanges):'];
  for (const turn of recent) {
    lines.push(`Q: ${turn.question}`);
    lines.push(`A: ${turn.answer}`);
  }
  lines.push(
    '\nNow answer the new question below, citing sources with [filename paragraph N] as before.',
  );
  return lines.join('\n');
}

function dateLabelFromTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

export function sessionBelongsToWorkspace(
  session: { workspaceRoot?: string; messages?: unknown[] },
  workspaceRoot: string | null | undefined,
): boolean {
  if (!workspaceRoot) return true;
  return session.workspaceRoot === workspaceRoot;
}

export function buildRecentAskSessions(
  sessions: Record<string, AskSessionLike>,
  workspaceRoot: string | null | undefined,
  options: {
    prefix?: string;
    excludeChatId?: string;
    limit?: number;
  } = {},
): RecentAskSession[] {
  const prefix = options.prefix ?? 'ask-';
  const limit = options.limit ?? 5;

  return Object.entries(sessions)
    .filter(
      ([key, session]) =>
        key.startsWith(prefix) &&
        key !== options.excludeChatId &&
        sessionBelongsToWorkspace(session, workspaceRoot) &&
        session.messages.some((message) => message.role === 'user'),
    )
    .sort(([, a], [, b]) => {
      const aTimestamp =
        a.messages.find((message) => message.role === 'user')?.timestamp ?? '';
      const bTimestamp =
        b.messages.find((message) => message.role === 'user')?.timestamp ?? '';
      return bTimestamp.localeCompare(aTimestamp);
    })
    .map(([key, session]) => {
      const firstUserMessage = session.messages.find(
        (message) => message.role === 'user',
      );
      return {
        chatId: key,
        label: session.title?.trim() || firstUserMessage?.content || key,
        dateLabel: dateLabelFromTimestamp(firstUserMessage?.timestamp),
      };
    })
    .slice(0, limit);
}
