/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { Bell, Lock, Pin } from 'lucide-react';
import { Badge, Button, Card } from '@/ui/kp';
import type { CrmClientsActions, NoteAudience } from './adapters';

export interface NoteEditorProps {
  audience: NoteAudience;
  availableMentions: readonly { id: string; label: string }[];
  actions?: CrmClientsActions;
  onCancel?: () => void;
  onSaved?: () => void;
}

/** Note audience is set by the creation lane and cannot be altered in this editor. */
export function NoteEditor({
  audience,
  availableMentions,
  actions,
  onCancel,
  onSaved,
}: NoteEditorProps) {
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [notifyFirm, setNotifyFirm] = useState(false);
  const isInternal = audience === 'internal';
  const selected = availableMentions.filter((person) =>
    mentions.includes(person.id)
  );
  return (
    <Card
      variant="raised"
      data-testid="crm-note-editor"
      style={{
        border: `1px solid ${isInternal ? 'var(--color-amber-600)' : 'var(--color-teal-700)'}`,
        background: isInternal ? 'var(--color-amber-50)' : 'var(--color-teal-50)',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
      >
        <Badge
          variant={isInternal ? 'warning' : 'success'}
          data-testid={isInternal ? 'crm-note-audience-internal' : 'crm-note-audience-client-facing'}
          {...(isInternal ? { icon: Lock } : {})}
        >
          {isInternal ? 'Internal only' : 'Client-facing'}
        </Badge>
        <span style={{ fontSize: 13 }}>Audience fixed at creation</span>
      </div>
      {isInternal ? (
        <p>
          <strong>Never included in client-facing drafts.</strong>
        </p>
      ) : (
        <p>This is a local client-facing record. It is not an email.</p>
      )}
      <label
        htmlFor="crm-note-body"
        style={{ display: 'block', fontWeight: 600 }}
      >
        Note
      </label>
      <textarea
        id="crm-note-body"
        data-testid="crm-note-body"
        value={body}
        onChange={(event) => { setBody(event.target.value); }}
        rows={5}
        style={{ width: '100%', marginTop: 6 }}
      />
      <div style={{ marginTop: 12 }}>
        <strong>@mentions</strong>
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}
        >
          {availableMentions.map((person) => (
            <Button
              key={person.id}
              size="sm"
              variant={mentions.includes(person.id) ? 'primary' : 'secondary'}
              data-testid={`crm-note-mention-${person.id}`}
              onClick={() =>
                { setMentions((current) =>
                  current.includes(person.id)
                    ? current.filter((id) => id !== person.id)
                    : [...current, person.id]
                ); }
              }
            >
              @{person.label}
            </Button>
          ))}
        </div>
      </div>
      <div
        aria-label="Recipient review"
        style={{
          marginTop: 12,
          padding: 10,
          background: 'var(--color-background)',
          borderRadius: 6,
        }}
      >
        <Bell size={14} aria-hidden="true" />{' '}
        {selected.length ? (
          <>Will notify: {selected.map((person) => person.label).join(', ')}</>
        ) : (
          'No mentioned people will be notified.'
        )}
      </div>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}
      >
        <input
          type="checkbox"
          data-testid="crm-note-notify-firm"
          checked={notifyFirm}
          onChange={(event) => { setNotifyFirm(event.target.checked); }}
        />{' '}
        Notify the firm about this operational update
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button
          size="sm"
          variant={pinned ? 'primary' : 'secondary'}
          iconLeft={Pin}
          data-testid="crm-note-pin"
          onClick={() => { setPinned((current) => !current); }}
        >
          {pinned ? 'Pinned' : 'Pin'}
        </Button>
        <Button
          size="sm"
          data-testid="crm-note-save"
          disabled={!body.trim()}
          onClick={() => {
            const saved = actions?.onSaveNote?.(
              { body, audience, pinned, mentions },
              notifyFirm
            );
            if (saved && typeof (saved as Promise<void>).then === 'function') {
              void (saved as Promise<void>).then(onSaved);
            } else {
              onSaved?.();
            }
          }}
        >
          Save note
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
