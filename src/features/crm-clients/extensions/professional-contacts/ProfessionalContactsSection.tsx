import { useState } from 'react';
import { Pencil, Plus, Save, ShieldCheck, X } from 'lucide-react';
import { Button, Card } from '@/ui/kp';
import { useFlag } from '@/platform/flags/router';
import { useTranslation } from 'react-i18next';
import type { HouseholdRecordShellContext } from '../../recordRegistry';
import {
  blankProfessionalContact,
  professionalContactKinds,
  professionalContactsFor,
  withProfessionalContacts,
  type ProfessionalContact,
  type ProfessionalContactKind,
} from './professionalContactsData';

const rowStyle = {
  borderTop: '1px solid var(--kp-border)',
  display: 'grid',
  gap: 8,
  padding: '14px 0',
} as const;

const inputStyle = {
  border: '1px solid var(--kp-border)',
  borderRadius: 6,
  boxSizing: 'border-box',
  minHeight: 34,
  padding: '7px 9px',
  width: '100%',
} as const;

function ContactEditor({
  kind,
  value,
  onCancel,
  onSave,
}: {
  kind: ProfessionalContactKind;
  value: ProfessionalContact;
  onCancel(): void;
  onSave(value: ProfessionalContact): void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const update = (field: keyof ProfessionalContact, next: string) => {
    setDraft((current) => ({ ...current, [field]: next }));
  };

  return (
    <form
      data-testid={`professional-contacts-editor-${kind}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.name.trim()) return;
        onSave({
          ...draft,
          name: draft.name.trim(),
          relationship: draft.relationship.trim(),
          organization: draft.organization.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
          notes: draft.notes.trim(),
        });
      }}
      style={{ display: 'grid', gap: 9 }}
    >
      <label>
        {t('professionalContacts.editor.name')}
        <input
          autoFocus
          data-testid={`professional-contacts-name-${kind}`}
          onChange={(event) => update('name', event.target.value)}
          required
          style={inputStyle}
          value={draft.name}
        />
      </label>
      <div
        style={{
          display: 'grid',
          gap: 9,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <label>
          {t('professionalContacts.editor.relationship')}
          <input
            data-testid={`professional-contacts-relationship-${kind}`}
            onChange={(event) => update('relationship', event.target.value)}
            style={inputStyle}
            value={draft.relationship}
          />
        </label>
        <label>
          {t('professionalContacts.editor.organization')}
          <input
            data-testid={`professional-contacts-organization-${kind}`}
            onChange={(event) => update('organization', event.target.value)}
            style={inputStyle}
            value={draft.organization}
          />
        </label>
        <label>
          {t('professionalContacts.editor.email')}
          <input
            data-testid={`professional-contacts-email-${kind}`}
            onChange={(event) => update('email', event.target.value)}
            style={inputStyle}
            type="email"
            value={draft.email}
          />
        </label>
        <label>
          {t('professionalContacts.editor.phone')}
          <input
            data-testid={`professional-contacts-phone-${kind}`}
            onChange={(event) => update('phone', event.target.value)}
            style={inputStyle}
            type="tel"
            value={draft.phone}
          />
        </label>
      </div>
      <label>
        {t('professionalContacts.editor.notes')}
        <textarea
          data-testid={`professional-contacts-notes-${kind}`}
          onChange={(event) => update('notes', event.target.value)}
          rows={2}
          style={inputStyle}
          value={draft.notes}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          data-testid={`professional-contacts-save-${kind}`}
          iconLeft={Save}
          size="sm"
          type="submit"
        >
          {t('professionalContacts.actions.save')}
        </Button>
        <Button
          iconLeft={X}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t('professionalContacts.actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function ProfessionalContactsSection(
  context: HouseholdRecordShellContext
) {
  const enabled = useFlag('record-professional-contacts');
  if (!enabled) return null;
  return <ProfessionalContactsSectionContent {...context} />;
}

export function ProfessionalContactsSectionContent(
  context: HouseholdRecordShellContext
) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<ProfessionalContactKind | null>(null);
  const contacts = professionalContactsFor(context.household);
  const save = async (
    kind: ProfessionalContactKind,
    value: ProfessionalContact
  ) => {
    const next = { ...contacts, [kind]: value };
    await context.onSaveHousehold?.(
      withProfessionalContacts(context.household, next)
    );
    setEditing(null);
  };

  return (
    <Card data-testid="professional-contacts-section" variant="raised">
      <div
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          gap: 10,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          <ShieldCheck aria-hidden color="var(--kp-primary)" size={20} />
          <div>
            <h2 style={{ fontSize: 17, margin: 0 }}>
              {t('professionalContacts.title')}
            </h2>
            <p style={{ color: 'var(--kp-text-muted)', margin: '4px 0 0' }}>
              {t('professionalContacts.helper')}
            </p>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        {professionalContactKinds.map((kind) => {
          const contact = contacts[kind];
          const isEditing = editing === kind;
          return (
            <section
              data-testid={`professional-contacts-row-${kind}`}
              key={kind}
              style={rowStyle}
            >
              <div
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 10,
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <strong>
                    {t(`professionalContacts.rows.${kind}.label`)}
                  </strong>
                  {contact ? (
                    <div
                      data-testid={`professional-contacts-summary-${kind}`}
                      style={{ color: 'var(--kp-text-muted)', marginTop: 3 }}
                    >
                      {contact.name}
                      {contact.relationship ? ` · ${contact.relationship}` : ''}
                      {contact.organization ? ` · ${contact.organization}` : ''}
                    </div>
                  ) : (
                    <div
                      style={{ color: 'var(--kp-text-muted)', marginTop: 3 }}
                    >
                      {t(`professionalContacts.rows.${kind}.empty`)}
                    </div>
                  )}
                </div>
                <Button
                  data-testid={`professional-contacts-edit-${kind}`}
                  iconLeft={contact ? Pencil : Plus}
                  onClick={() => setEditing(kind)}
                  size="sm"
                  variant="secondary"
                >
                  {contact
                    ? t('professionalContacts.actions.edit')
                    : t('professionalContacts.actions.add')}
                </Button>
              </div>
              {isEditing ? (
                <ContactEditor
                  kind={kind}
                  onCancel={() => setEditing(null)}
                  onSave={(value) => {
                    void save(kind, value);
                  }}
                  value={contact ?? blankProfessionalContact()}
                />
              ) : null}
            </section>
          );
        })}
      </div>
    </Card>
  );
}
