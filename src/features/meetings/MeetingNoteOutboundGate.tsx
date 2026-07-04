// E3 (Tier B trust guard) — render-prop wrapper that runs the outbound-gate
// hook at a stable component boundary and hands the computed reason (or
// undefined) to its child (the DocxEditor in MainPanel). The hook itself lives
// in useMeetingNoteOutboundGate.ts so this file only exports a component.
import type { ReactNode } from 'react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useMeetingNoteOutboundGate } from './useMeetingNoteOutboundGate';

export function MeetingNoteOutboundGate({
  tabPath,
  workspaceService,
  children,
}: {
  tabPath: string;
  workspaceService: WorkspaceService | null;
  children: (outboundBlockedReason: string | undefined) => ReactNode;
}) {
  const reason = useMeetingNoteOutboundGate(tabPath, workspaceService);
  return <>{children(reason)}</>;
}
