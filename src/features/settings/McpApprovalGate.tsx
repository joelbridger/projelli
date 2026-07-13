/**
 * McpApprovalGate: owns the MCP write-approval polling loop and renders the
 * approval modal.
 *
 * The `lantern-mcp` sidecar (spawned by an external MCP client such as Claude
 * Desktop) drops a JSON request on disk whenever the client tries to write a
 * workspace file with `require_confirmation = true`. This component polls for
 * those requests and surfaces them through `McpApprovalModal`.
 *
 * Network Lockdown wiring: when Rust enforcement is on or cannot be confirmed,
 * MCP servers are treated as DISABLED. The modal auto-denies every pending
 * write, and each block is recorded in the audit log as an `mcp_blocked` event
 * so there is a defensible "nothing was written / nothing left" record.
 *
 * No-op in the browser (the sidecar bridge returns `[]` there).
 */

import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  mcpListPendingApprovals,
  mcpApproveWrite,
  type McpPendingApproval,
} from '@/platform/utils/tauri-commands';
import { McpApprovalModal } from '@/features/settings/McpApprovalModal';
import { useNativeNetworkLockdownBridgeState } from '@/platform/privacy/nativeNetworkLockdownBridge';
import type { AuditEvent } from '@/platform/types/audit';
import { PRIVILEGED_MATTER_BLOCK_REASON } from '@/platform/privacy/privilegedMatterMode';

export interface McpApprovalGateProps {
  /** Append a structured audit event (App.tsx wires this through the active
   *  AuditService so MCP blocks land in the encrypted-at-rest defense file). */
  onAuditEvent?: (event: AuditEvent) => void;
  /** Poll interval ms. Default 1000. Exposed for tests. */
  pollMs?: number;
  /** Override the pending-approval source (tests). Defaults to the Tauri command. */
  listApprovals?: () => Promise<McpPendingApproval[]>;
  /** Override the respond sink (tests). Defaults to the Tauri command. */
  respond?: (token: string, approved: boolean) => Promise<void>;
  /** Test override. Production defaults to confirmed native enforcement. */
  privilegedMatterMode?: boolean;
}

export function McpApprovalGate({
  onAuditEvent,
  pollMs = 1000,
  listApprovals,
  respond,
  privilegedMatterMode,
}: McpApprovalGateProps): React.ReactElement | null {
  const enforcedNetworkLockdown = useNativeNetworkLockdownBridgeState();
  const privileged = privilegedMatterMode ?? enforcedNetworkLockdown.blocked;
  const [approvals, setApprovals] = useState<McpPendingApproval[]>([]);
  const [sessionApproveAll, setSessionApproveAll] = useState(false);

  const list = listApprovals ?? mcpListPendingApprovals;
  const doRespond = respond ?? mcpApproveWrite;

  // Poll for pending approvals. Only meaningful on desktop; in the browser the
  // command returns [] so the loop is a cheap no-op, but we skip it anyway.
  useEffect(() => {
    if (!isTauri() && !listApprovals) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await list();
        if (!cancelled) setApprovals(next);
      } catch {
        // Transient read failure; try again next tick.
      }
    };
    void tick();
    const id = setInterval(() => {
      void tick();
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [list, listApprovals, pollMs]);

  const handleRespond = useCallback(
    async (token: string, approved: boolean) => {
      await doRespond(token, approved);
      // Optimistically drop it from the local queue so the modal advances
      // before the next poll lands.
      setApprovals((prev) => prev.filter((a) => a.token !== token));
    },
    [doRespond],
  );

  const handleMcpBlocked = useCallback(
    (path: string) => {
      onAuditEvent?.({
        type: 'mcp_blocked',
        timestamp: new Date().toISOString(),
        payload: { path, reason: PRIVILEGED_MATTER_BLOCK_REASON },
      });
    },
    [onAuditEvent],
  );

  return (
    <McpApprovalModal
      approvals={approvals}
      onRespond={handleRespond}
      onApproveAllSession={() => {
        setSessionApproveAll(true);
      }}
      sessionApproveAll={sessionApproveAll}
      privilegedMatterMode={privileged}
      onMcpBlocked={handleMcpBlocked}
    />
  );
}

export default McpApprovalGate;
