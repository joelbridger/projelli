import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WELCOME_JOURNEY,
  WELCOME_JOURNEY_EMAILS,
  hasForbiddenWelcomeJourneyCopy,
} from '../welcomeJourneyDefaults';

describe('welcome journey defaults', () => {
  it('keeps the approved timeline, people, and screen copy together', () => {
    expect(DEFAULT_WELCOME_JOURNEY.timeline.map((step) => step.label)).toEqual([
      'Welcome',
      'Information needed',
      'Reviewing',
      'Paperwork',
      'Signature or transfer',
      'Active client',
    ]);
    expect(DEFAULT_WELCOME_JOURNEY.people.slice(0, 2)).toMatchObject([
      { role: 'Lead advisor', ask_about: 'Ask [advisor_first_name] about your planning questions and advice.' },
      { role: 'Client service associate', ask_about: 'Ask [support_first_name] about uploads, signatures, and scheduling.' },
    ]);
    expect(DEFAULT_WELCOME_JOURNEY.welcome.headline).toBe('Welcome, [client_first_name].');
    expect(DEFAULT_WELCOME_JOURNEY.completion.heading).toBe('Thanks, [client_first_name]. You\'ve sent the information we need to start.');
    expect(DEFAULT_WELCOME_JOURNEY.phone_walkthrough_label).toBe('[support_first_name] helped complete this by phone.');
  });

  it('keeps default page and email copy free of em dashes and sensitive merge fields', () => {
    expect(hasForbiddenWelcomeJourneyCopy(DEFAULT_WELCOME_JOURNEY)).toEqual([]);
    expect(WELCOME_JOURNEY_EMAILS).toHaveLength(14);
    expect(WELCOME_JOURNEY_EMAILS.flatMap((template) => [template.subject, template.body]).join('\n')).not.toMatch(/\[(?:ssn|license_number|account_number|exact_balance)\]/iu);
  });
});
