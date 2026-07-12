import type React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import type { WelcomeJourney } from '@/platform/intake/welcomeJourneyDefaults';
import { sanitizeWelcomeJourney } from '@/platform/intake/welcomeJourneyDefaults';

export function WhatHappensNextEditor({ value, onChange, onSaveDefault }: { value: WelcomeJourney; onChange: (next: WelcomeJourney) => void; onSaveDefault?: (next: WelcomeJourney) => void }): React.JSX.Element {
  const { t } = useTranslation();
  const update = (path: 'welcome.headline' | 'welcome.intro' | 'welcome.team_intro' | 'help_contact_label' | 'completion.heading' | 'completion.body', nextValue: string) => {
    const next = sanitizeWelcomeJourney(value);
    const [section, field] = path.split('.') as [keyof WelcomeJourney, string];
    if (section === 'help_contact_label') next.help_contact_label = nextValue;
    else (next[section] as Record<string, string>)[field] = nextValue;
    onChange(next);
  };
  const updateTimeline = (index: number, field: 'label' | 'description' | 'owner' | 'visible', nextValue: string | boolean) => {
    const next = sanitizeWelcomeJourney(value);
    const step = next.timeline[index];
    if (!step) return;
    Object.assign(step, { [field]: nextValue });
    onChange(sanitizeWelcomeJourney(next));
  };
  const updatePerson = (index: number, field: 'name' | 'role' | 'initials' | 'ask_about' | 'contact', nextValue: string) => {
    const next = sanitizeWelcomeJourney(value);
    const person = next.people[index];
    if (!person) return;
    Object.assign(person, { [field]: nextValue });
    onChange(next);
  };
  return <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="what-happens-next-editor">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">{t('intake.journey.title')}</h3><p className="text-xs text-slate-600">{t('intake.journey.description')}</p></div>{onSaveDefault ? <Button type="button" variant="outline" size="sm" onClick={() => { onSaveDefault(sanitizeWelcomeJourney(value)); }}>{t('intake.journey.save-firm-default')}</Button> : null}</div>
    <div className="mt-3 grid gap-3"><Field label={t('intake.journey.welcome-headline')} value={value.welcome.headline} onChange={(next) => { update('welcome.headline', next); }} /><Field label={t('intake.journey.welcome-introduction')} value={value.welcome.intro} onChange={(next) => { update('welcome.intro', next); }} /><Field label={t('intake.journey.team-introduction')} value={value.welcome.team_intro} onChange={(next) => { update('welcome.team_intro', next); }} /><Field label={t('intake.journey.help-contact')} value={value.help_contact_label} onChange={(next) => { update('help_contact_label', next); }} /><Field label={t('intake.journey.completion-headline')} value={value.completion.heading} onChange={(next) => { update('completion.heading', next); }} /><Field label={t('intake.journey.completion-copy')} value={value.completion.body} onChange={(next) => { update('completion.body', next); }} /><Field label={t('intake.journey.nothing-needed-copy')} value={value.completion.nothing_needed} onChange={(next) => { const copy = sanitizeWelcomeJourney(value); copy.completion.nothing_needed = next; onChange(copy); }} /><Field label={t('intake.journey.paperwork-pending-copy')} value={value.completion.pending_paperwork} onChange={(next) => { const copy = sanitizeWelcomeJourney(value); copy.completion.pending_paperwork = next; onChange(copy); }} /></div>
    <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">{t('intake.journey.timeline')}</summary><div className="mt-2 grid gap-2">{value.timeline.map((step, index) => <div key={step.id} className="rounded border border-slate-200 p-2"><Field label={t('intake.journey.milestone-label', { milestone: step.id })} value={step.label} onChange={(next) => { updateTimeline(index, 'label', next); }} /><Field label={t('intake.journey.milestone-description', { milestone: step.id })} value={step.description} onChange={(next) => { updateTimeline(index, 'description', next); }} /><Field label={t('intake.journey.milestone-owner', { milestone: step.id })} value={step.owner} onChange={(next) => { updateTimeline(index, 'owner', next); }} /><label className="mt-1 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={step.visible} onChange={(event) => { updateTimeline(index, 'visible', event.target.checked); }} />{t('intake.journey.show-milestone')}</label></div>)}</div></details>
    <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">{t('intake.journey.team')}</summary><div className="mt-2 grid gap-2">{value.people.map((person, index) => <div key={person.id} className="rounded border border-slate-200 p-2"><Field label={t('intake.journey.person-name', { person: person.id })} value={person.name ?? ''} onChange={(next) => { updatePerson(index, 'name', next); }} /><Field label={t('intake.journey.person-title', { person: person.id })} value={person.role} onChange={(next) => { updatePerson(index, 'role', next); }} /><Field label={t('intake.journey.person-initials', { person: person.id })} value={person.initials ?? ''} onChange={(next) => { updatePerson(index, 'initials', next); }} /><Field label={t('intake.journey.person-ask-about', { person: person.id })} value={person.ask_about} onChange={(next) => { updatePerson(index, 'ask_about', next); }} /><Field label={t('intake.journey.person-contact', { person: person.id })} value={person.contact ?? ''} onChange={(next) => { updatePerson(index, 'contact', next); }} /></div>)}</div></details>
    <p className="mt-3 text-xs text-slate-600">{t('intake.journey.security-note')}</p>
  </section>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  const id = `welcome-journey-${label.toLowerCase().replace(/[^a-z]+/gu, '-')}`;
  return <div className="grid gap-1"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => { onChange(event.target.value); }} /></div>;
}
