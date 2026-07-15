import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@/ui/tooltip';
import '@/styles/globals.css';
import i18n from '@/i18n';
import { FormActivityPresentation } from '../FormActivitySurface';

const records = [
  {
    id: 'form-annual',
    kind: 'intakeLink',
    name: 'Annual review questionnaire',
    fields: {
      client_name: {
        id: 'client_name',
        label: 'Full name',
        kind: 'text',
        required: true,
      },
      client_email: {
        id: 'client_email',
        label: 'Email address',
        kind: 'email',
        required: true,
      },
    },
  },
  {
    id: 'form-onboarding',
    kind: 'intakeLink',
    name: 'New client onboarding',
    fields: {
      client_name: {
        id: 'client_name',
        label: 'Full name',
        kind: 'text',
        required: true,
      },
    },
  },
  { id: 'household-chen', kind: 'household', name: 'Chen household' },
  { id: 'household-rivera', kind: 'household', name: 'Rivera household' },
  {
    id: 'submission-chen',
    kind: 'intakeSubmission',
    intakeLinkId: 'form-annual',
    audience: 'client-facing',
    submittedAt: '2026-07-15T14:00:00Z',
    payload: { values: { client_name: 'Avery Chen' } },
    matchingDecisions: {
      matched: {
        decision: 'match',
        decidedAt: '2026-07-15T14:01:00Z',
        householdRef: { id: 'household-chen' },
      },
    },
  },
  {
    id: 'submission-rivera',
    kind: 'intakeSubmission',
    intakeLinkId: 'form-onboarding',
    audience: 'client-facing',
    submittedAt: '2026-07-15T10:30:00Z',
    payload: { values: { client_name: 'Morgan Rivera' } },
    matchingDecisions: {
      created: {
        decision: 'create',
        decidedAt: '2026-07-15T10:35:00Z',
        householdRef: { id: 'household-rivera' },
      },
    },
  },
  {
    id: 'submission-internal',
    kind: 'intakeSubmission',
    intakeLinkId: 'form-annual',
    audience: 'internal',
    submittedAt: '2026-07-14T16:15:00Z',
    payload: { values: { client_name: 'Jordan Lee' } },
    matchingDecisions: {},
  },
];

const root = document.getElementById('root');
if (!root) throw new Error('Form activity visual proof needs a root element.');

createRoot(root).render(
  <I18nextProvider i18n={i18n}>
    <TooltipProvider>
      <FormActivityPresentation records={records} error={null} />
    </TooltipProvider>
  </I18nextProvider>
);
