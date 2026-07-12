/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy belongs to the frozen product catalog. */
import { useState } from 'react';
import { Button } from '@/ui/kp';
import type { CrmContactAddress, CrmContactChannel, CrmPerson } from './adapters';

type ContactKind = 'address' | 'email' | 'phone';

function makeAddress(): CrmContactAddress {
  return { id: crypto.randomUUID(), address: '', city: '', state: '', zip: '', kind: 'Home', primary: false };
}
function makeChannel(): CrmContactChannel {
  return { id: crypto.randomUUID(), address: '', kind: 'Personal', primary: false };
}
function cleanAddresses(values: readonly CrmContactAddress[]) {
  return values.filter((value) => value.address.trim()).map((value, index) => ({ ...value, address: value.address.trim(), city: value.city.trim(), state: value.state.trim(), zip: value.zip.trim(), kind: value.kind.trim() || 'Other', primary: value.primary || (!values.some((item) => item.primary) && index === 0) }));
}
function cleanChannels(values: readonly CrmContactChannel[]) {
  return values.filter((value) => value.address.trim()).map((value, index) => ({ ...value, address: value.address.trim(), kind: value.kind.trim() || 'Other', primary: value.primary || (!values.some((item) => item.primary) && index === 0) }));
}

function ContactList({ kind, values, onChange }: { kind: ContactKind; values: readonly CrmContactAddress[] | readonly CrmContactChannel[]; onChange: (values: CrmContactAddress[] | CrmContactChannel[]) => void }) {
  const label = kind === 'address' ? 'Address' : kind === 'email' ? 'Email' : 'Phone';
  const update = (index: number, patch: Record<string, unknown>) => onChange(values.map((value, position) => position === index ? { ...value, ...patch } : value) as CrmContactAddress[] | CrmContactChannel[]);
  return <fieldset style={{ display: 'grid', gap: 7 }} data-testid={`crm-contact-${kind}s`}><legend>{label}s</legend>
    {values.map((value, index) => <div key={value.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6, alignItems: 'center' }}>
      {kind === 'address' ? <><input data-testid={`crm-contact-${kind}-${index}`} aria-label={`${label} ${index + 1}`} value={(value as CrmContactAddress).address} onChange={(event) => update(index, { address: event.target.value })} placeholder="Street address" /><input aria-label={`City ${index + 1}`} value={(value as CrmContactAddress).city} onChange={(event) => update(index, { city: event.target.value })} placeholder="City" /><input aria-label={`State ${index + 1}`} value={(value as CrmContactAddress).state} onChange={(event) => update(index, { state: event.target.value })} placeholder="State" /><input aria-label={`Postal code ${index + 1}`} value={(value as CrmContactAddress).zip} onChange={(event) => update(index, { zip: event.target.value })} placeholder="Postal code" /></> : <input data-testid={`crm-contact-${kind}-${index}`} aria-label={`${label} ${index + 1}`} value={(value as CrmContactChannel).address} onChange={(event) => update(index, { address: event.target.value })} placeholder={kind === 'email' ? 'name@example.com' : '(555) 555-5555'} />}
      <input aria-label={`${label} type ${index + 1}`} value={value.kind} onChange={(event) => update(index, { kind: event.target.value })} placeholder="Type" />
      <label style={{ whiteSpace: 'nowrap' }}><input aria-label={`Primary ${label.toLowerCase()} ${index + 1}`} type="radio" name={`${kind}-primary`} checked={value.primary} onChange={() => onChange(values.map((item, position) => ({ ...item, primary: position === index })) as CrmContactAddress[] | CrmContactChannel[])} /> Primary</label>
      <Button type="button" variant="secondary" size="sm" data-testid={`crm-person-${kind}-remove-${index}`} onClick={() => onChange(values.filter((_, position) => position !== index) as CrmContactAddress[] | CrmContactChannel[])}>Remove</Button>
    </div>)}
    <Button type="button" variant="secondary" size="sm" data-testid={`crm-person-${kind}-add`} onClick={() => onChange([...(values as CrmContactAddress[] | CrmContactChannel[]), kind === 'address' ? makeAddress() : makeChannel()] as CrmContactAddress[] | CrmContactChannel[])}>Add {label.toLowerCase()}</Button>
  </fieldset>;
}

export function ContactEditor({ person, onSave, onRemove }: { person?: CrmPerson; onSave: (person: CrmPerson) => Promise<void> | void; onRemove?: () => Promise<void> | void }) {
  const [name, setName] = useState(person?.name ?? '');
  const [personType, setPersonType] = useState<CrmPerson['personType']>(person?.personType ?? 'person');
  const [roles, setRoles] = useState(person?.roles.join(', ') ?? '');
  const [relationship, setRelationship] = useState(person?.householdRole ?? '');
  const [external, setExternal] = useState(person?.external ?? false);
  const [companyName, setCompanyName] = useState(person?.companyName ?? '');
  const [jobTitle, setJobTitle] = useState(person?.jobTitle ?? '');
  const [addresses, setAddresses] = useState<CrmContactAddress[]>([...(person?.addresses ?? [])]);
  const [emails, setEmails] = useState<CrmContactChannel[]>([...(person?.emails ?? [])]);
  const [phones, setPhones] = useState<CrmContactChannel[]>([...(person?.phones ?? [])]);
  const entityName = personType === 'organization' ? 'Organization name' : personType === 'trust' ? 'Trust name' : 'Full name';
  return <form data-testid="crm-person-editor" onSubmit={(event) => { event.preventDefault(); const cleanName = name.trim(); if (!cleanName) return; void onSave({ id: person?.id ?? `person:${crypto.randomUUID()}`, name: cleanName, personType, roles: roles.split(',').map((value) => value.trim()).filter(Boolean), ...(relationship.trim() ? { householdRole: relationship.trim() } : {}), ...(external ? { external: true } : {}), relatedHouseholds: person?.relatedHouseholds ?? 1, ...(companyName.trim() ? { companyName: companyName.trim() } : {}), ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}), ...(person?.contextRefs ? { contextRefs: person.contextRefs } : {}), addresses: cleanAddresses(addresses), emails: cleanChannels(emails), phones: cleanChannels(phones) }); }} style={{ display: 'grid', gap: 12 }}>
    <label>Contact type<select data-testid="crm-person-type" value={personType} onChange={(event) => setPersonType(event.target.value as CrmPerson['personType'])}><option value="person">Person</option><option value="organization">Company or organization</option><option value="trust">Trust</option></select></label>
    <label>{entityName}<input data-testid="crm-person-name" value={name} onChange={(event) => setName(event.target.value)} /></label>
    {personType === 'person' ? <><label>Company<input data-testid="crm-person-company" value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label><label>Job title<input data-testid="crm-person-job-title" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></label></> : null}
    <label>Person roles<input data-testid="crm-person-roles" value={roles} placeholder="Accountant, attorney" onChange={(event) => setRoles(event.target.value)} /></label>
    <label>Household relationship<input data-testid="crm-person-relationship" value={relationship} placeholder="Spouse, child, power of attorney" onChange={(event) => setRelationship(event.target.value)} /></label>
    <label><input data-testid="crm-person-external" type="checkbox" checked={external} onChange={(event) => setExternal(event.target.checked)} /> External contact for this household</label>
    <ContactList kind="address" values={addresses} onChange={(values) => setAddresses(values as CrmContactAddress[])} />
    <ContactList kind="email" values={emails} onChange={(values) => setEmails(values as CrmContactChannel[])} />
    <ContactList kind="phone" values={phones} onChange={(values) => setPhones(values as CrmContactChannel[])} />
    <Button data-testid="crm-person-save" type="submit">Save contact</Button>
    {onRemove ? <Button data-testid="crm-person-remove" type="button" variant="secondary" onClick={() => { void onRemove(); }}>Remove contact from this household</Button> : null}
  </form>;
}
