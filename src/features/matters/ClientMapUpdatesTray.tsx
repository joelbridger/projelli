// src/features/matters/ClientMapUpdatesTray.tsx
/**
 * ClientMapUpdatesTray — approve-first updates tray.
 *
 * Renders nothing when there are no pending updates. Otherwise shows a marker
 * with the count and a row per proposed update with Accept / Edit / Dismiss.
 *
 * AI proposes, the professional decides — all AI changes flow through here.
 */

import { useState } from 'react';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type { ProposedUpdate } from '@/platform/clientMap/types';

// ── Props ──────────────────────────────────────────────────────────────────

export interface ClientMapUpdatesTrayProps {
  matterId: string;
}

// ── UpdateRow ──────────────────────────────────────────────────────────────

function UpdateRow({
  matterId,
  update,
}: {
  matterId: string;
  update: ProposedUpdate;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(update.draft?.text ?? '');
  const acceptUpdate = useClientMapStore((s) => s.acceptUpdate);
  const dismissUpdate = useClientMapStore((s) => s.dismissUpdate);

  function handleAccept() {
    acceptUpdate(matterId, update.id);
  }

  function handleDismiss() {
    dismissUpdate(matterId, update.id);
  }

  function handleEdit() {
    setEditing(true);
  }

  function handleEditSubmit() {
    acceptUpdate(matterId, update.id, editText);
    setEditing(false);
  }

  const displayText = update.draft?.text ?? update.itemId ?? update.id;

  return (
    <div data-testid="clientmap-update-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, color: '#374151' }}>{displayText}</span>
        {editing && (
          <div style={{ marginTop: 6 }}>
            <input
              value={editText}
              onChange={(e) => { setEditText(e.target.value); }}
              style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
            />
            <button
              type="button"
              onClick={handleEditSubmit}
              style={{ marginTop: 4, fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Save
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          type="button"
          data-testid="clientmap-update-accept"
          onClick={handleAccept}
          style={{ fontSize: 12, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
        >
          Accept
        </button>
        <button
          type="button"
          data-testid="clientmap-update-edit"
          onClick={handleEdit}
          style={{ fontSize: 12, color: '#374151', background: '#f3f4f6', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
        >
          Edit
        </button>
        <button
          type="button"
          data-testid="clientmap-update-dismiss"
          onClick={handleDismiss}
          style={{ fontSize: 12, color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── ClientMapUpdatesTray ───────────────────────────────────────────────────

export function ClientMapUpdatesTray({ matterId }: ClientMapUpdatesTrayProps) {
  const pendingUpdates = useClientMapStore(
    (s) => s.maps[matterId]?.pendingUpdates ?? [],
  );

  if (pendingUpdates.length === 0) return null;

  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span
          data-testid="clientmap-updates-marker"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, background: '#f59e0b', color: '#fff', borderRadius: 11, fontSize: 12, fontWeight: 600, padding: '0 6px' }}
        >
          {pendingUpdates.length}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#92400e' }}>
          {pendingUpdates.length === 1 ? 'one update to review' : 'a few updates to review'}
        </span>
      </div>
      <div>
        {pendingUpdates.map((update) => (
          <UpdateRow key={update.id} matterId={matterId} update={update} />
        ))}
      </div>
    </div>
  );
}
