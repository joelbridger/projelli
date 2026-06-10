/**
 * Locks in the shape and voice quality of the per-provider API key
 * tutorials surfaced in ApiKeyWizard step 2 and the Settings, Onboarding,
 * "View API Key Tutorial" entry. Catches:
 *   - missing/extra steps
 *   - missing console or billing URLs
 *   - empty title/body
 *   - em dashes (banned in all Keepance copy)
 *   - banned marketing words
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PROVIDER_TUTORIALS,
  ProviderTutorialList,
  type ProviderId,
} from '@/components/onboarding/ProviderTutorialSteps';

describe('Per-provider tutorial data shape', () => {
  const providers: ProviderId[] = ['anthropic', 'openai', 'google'];

  it.each(providers)('%s tutorial has 3-6 steps', (providerId) => {
    const t = PROVIDER_TUTORIALS[providerId];
    expect(t.steps.length).toBeGreaterThanOrEqual(3);
    // F-105: added training-opt-out step so tutorials now have 6 steps
    expect(t.steps.length).toBeLessThanOrEqual(6);
  });

  it.each(providers)('%s tutorial has valid console + billing URLs', (providerId) => {
    const t = PROVIDER_TUTORIALS[providerId];
    expect(t.consoleUrl).toMatch(/^https:\/\//);
    expect(t.billingUrl).toMatch(/^https:\/\//);
  });

  it.each(providers)('%s tutorial steps all have title + body', (providerId) => {
    for (const step of PROVIDER_TUTORIALS[providerId].steps) {
      expect(step.title.length).toBeGreaterThan(5);
      expect(step.body.length).toBeGreaterThan(20);
    }
  });

  it.each(providers)('%s tutorial is voice-rule compliant (no em dashes, no banned words)', (providerId) => {
    const t = PROVIDER_TUTORIALS[providerId];
    const allText = [
      t.providerName,
      ...t.steps.flatMap((s) => [s.title, s.body, s.hint ?? '']),
    ].join(' ');
    expect(allText).not.toMatch(/\u2014|&mdash;/);
    const banned = /\b(leverage|seamless|empower|unlock|delve|tapestry|elevate)\b/i;
    expect(allText).not.toMatch(banned);
  });

  it.each(providers)('%s tutorial has no dollar-amount estimates', (providerId) => {
    const t = PROVIDER_TUTORIALS[providerId];
    const allText = [
      t.providerName,
      ...t.steps.flatMap((s) => [s.title, s.body, s.hint ?? '']),
    ].join(' ');
    // Guard against reintroducing cost prose like "$5 lasts most founders a month".
    expect(allText).not.toMatch(/\$\d/);
  });
});

describe('ProviderTutorialList rendering', () => {
  it('renders all steps as a numbered list', () => {
    render(<ProviderTutorialList tutorial={PROVIDER_TUTORIALS.anthropic} />);
    expect(screen.getByTestId('api-key-tutorial-anthropic')).toBeInTheDocument();
    for (let i = 1; i <= PROVIDER_TUTORIALS.anthropic.steps.length; i++) {
      expect(screen.getByTestId(`api-key-tutorial-step-anthropic-${i}`)).toBeInTheDocument();
    }
  });

  it('renders console + billing as clickable openExternal triggers', () => {
    render(<ProviderTutorialList tutorial={PROVIDER_TUTORIALS.openai} />);
    // Primary action buttons + the raw-URL fallback buttons both route
    // through openExternal. We assert by data-testid on the prominent
    // buttons and by label presence for the raw URLs.
    expect(
      screen.getByTestId('api-key-tutorial-open-console-openai'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('api-key-tutorial-open-billing-openai'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(PROVIDER_TUTORIALS.openai.consoleUrl),
    ).toBeInTheDocument();
    expect(
      screen.getByText(PROVIDER_TUTORIALS.openai.billingUrl),
    ).toBeInTheDocument();
  });
});
