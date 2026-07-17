/// <reference types="@testing-library/jest-dom" />
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntakeRecord } from '@/platform/intake/intakeStore';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import { deriveOnboardingRow } from '@/platform/intake/onboardingModel';
import { setPromptDecisionBroker } from '@/platform/privacy/promptPreparation';
import type { ResolvedEmailProvider } from '@/features/email/resolveEmailProvider';
import type { Provider } from '@/platform/providers/Provider';

import { NudgeReviewModal } from './NudgeReviewModal';

function textAreaValue(testId: string): string {
  const element = screen.getByTestId(testId);
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`${testId} is not a textarea.`);
  return element.value;
}

const resolveEmailProviderMock = vi.fn<() => Promise<ResolvedEmailProvider>>();
const reconstructAdvisorIntakeLinkMock = vi.fn<(input: { intakeId: string; publicKeyRawB64: string }) => Promise<string>>();
vi.mock('@/features/email/resolveEmailProvider', () => ({
  resolveEmailProvider: (): Promise<ResolvedEmailProvider> => resolveEmailProviderMock(),
}));
vi.mock('@/platform/intake/advisorIntakeLink', () => ({
  reconstructAdvisorIntakeLink: (input: { intakeId: string; publicKeyRawB64: string }): Promise<string> =>
    reconstructAdvisorIntakeLinkMock(input),
}));

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailConnectedAccounts: () => Promise.resolve([{ provider: 'm365', account: 'default', label: 'Outlook' }]),
  };
});

const now = new Date('2026-07-10T12:00:00.000Z');

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    link: 'https://example.test/i/abc#link-secret',
    items: [
      { itemId: 'ssn', label: 'Social Security number', state: 'not_started' },
      { itemId: 'income', label: 'Income', state: 'received' },
    ],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
    ...overrides,
  } as IntakeRecord;
}

function providerWithBody(body: string, structuredOutput = vi.fn().mockResolvedValue({ body })): Provider {
  return {
    getMetadata: () => ({ model: 'test-model' }),
    sendMessage: vi.fn(),
    structuredOutput,
    formatAttachmentForRequest: vi.fn(),
    supportsAttachment: vi.fn(),
  } as unknown as Provider;
}

describe('NudgeReviewModal AI rewrite - prepared-send wiring', () => {
  afterEach(() => {
    setPromptDecisionBroker(undefined);
    useIntakeStore.getState().resetForTests();
    reconstructAdvisorIntakeLinkMock.mockReset();
    vi.clearAllMocks();
  });

  it('sends a clean rewrite prompt straight through with no secret finding', async () => {
    const structuredOutput = vi.fn().mockResolvedValue({ body: 'Rewritten in the advisor voice.' });
    const provider = providerWithBody('Rewritten in the advisor voice.', structuredOutput);
    resolveEmailProviderMock.mockResolvedValue({ provider, providerId: 'test-provider', assuredAvailable: true });

    const record = intake();
    const row = deriveOnboardingRow(record, now, DEFAULT_ONBOARDING_CONFIG);
    render(
      <NudgeReviewModal open row={row} intake={record} now={now} onOpenChange={vi.fn()} />
    );

    await waitFor(() => { expect(screen.getByTestId('nudge-review-body')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('nudge-draft-in-my-voice'));

    await waitFor(() => { expect(structuredOutput).toHaveBeenCalled(); });
    const [sentPrompt] = structuredOutput.mock.calls[0] as [string, unknown];
    expect(sentPrompt).toContain('Rewrite this onboarding follow-up email body');
    // enforceNudgeBodyInvariants may append the missing-item list and the
    // real link back on if the model's response dropped them, so check
    // containment rather than an exact match.
    await waitFor(() => {
      expect(textAreaValue('nudge-review-body')).toContain('Rewritten in the advisor voice.');
    });
  });

  it('redacts a secret-bearing draft body and sends only after the advisor approves the redacted copy', async () => {
    const structuredOutput = vi.fn().mockResolvedValue({ body: 'Rewritten body.' });
    const provider = providerWithBody('Rewritten body.', structuredOutput);
    resolveEmailProviderMock.mockResolvedValue({ provider, providerId: 'test-provider', assuredAvailable: true });
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));

    const record = intake();
    const row = deriveOnboardingRow(record, now, DEFAULT_ONBOARDING_CONFIG);
    render(
      <NudgeReviewModal open row={row} intake={record} now={now} onOpenChange={vi.fn()} />
    );

    await waitFor(() => { expect(screen.getByTestId('nudge-review-body')).not.toBeDisabled(); });
    // A secret pasted into the editable draft body - not the known intake
    // link (already redacted unconditionally), a DIFFERENT secret to prove
    // the real scrub layer, not just NudgeReviewModal's own link redaction,
    // is what's catching this.
    fireEvent.change(screen.getByTestId('nudge-review-body'), {
      target: { value: 'By the way, here is my password: hunter2-super-secret for the shared drive.' },
    });
    fireEvent.click(screen.getByTestId('nudge-draft-in-my-voice'));

    await waitFor(() => { expect(structuredOutput).toHaveBeenCalled(); });
    const [sentPrompt] = structuredOutput.mock.calls[0] as [string, unknown];
    expect(sentPrompt).not.toContain('hunter2-super-secret');
    await waitFor(() => {
      expect(textAreaValue('nudge-review-body')).toContain('Rewritten body.');
    });
  });

  it('blocks the rewrite instead of sending when the advisor cancels a flagged draft', async () => {
    const structuredOutput = vi.fn().mockResolvedValue({ body: 'Should never be reached.' });
    const provider = providerWithBody('Should never be reached.', structuredOutput);
    resolveEmailProviderMock.mockResolvedValue({ provider, providerId: 'test-provider', assuredAvailable: true });
    setPromptDecisionBroker(() => Promise.resolve('cancel'));

    const record = intake();
    const row = deriveOnboardingRow(record, now, DEFAULT_ONBOARDING_CONFIG);
    render(
      <NudgeReviewModal open row={row} intake={record} now={now} onOpenChange={vi.fn()} />
    );

    await waitFor(() => { expect(screen.getByTestId('nudge-review-body')).not.toBeDisabled(); });
    fireEvent.change(screen.getByTestId('nudge-review-body'), {
      target: { value: 'Sharing a password: hunter2-super-secret here by mistake.' },
    });
    fireEvent.click(screen.getByTestId('nudge-draft-in-my-voice'));

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument(); });
    expect(structuredOutput).not.toHaveBeenCalled();
  });

  it('preserves an advisor body through a same-intake re-seed, but resets for another intake', async () => {
    const original = intake();
    const view = render(<NudgeReviewModal open row={deriveOnboardingRow(original, now, DEFAULT_ONBOARDING_CONFIG)} intake={original} now={now} onOpenChange={vi.fn()} />);
    await waitFor(() => { expect(screen.getByTestId('nudge-review-body')).not.toBeDisabled(); });
    fireEvent.change(screen.getByTestId('nudge-review-body'), {
      target: { value: "Advisor's careful wording" },
    });
    const refreshed = { ...original, firmName: 'North Star refresh' };
    view.rerender(<NudgeReviewModal open row={deriveOnboardingRow(refreshed, now, DEFAULT_ONBOARDING_CONFIG)} intake={refreshed} now={now} onOpenChange={vi.fn()} />);
    await waitFor(() => {
      expect(textAreaValue('nudge-review-body')).toBe("Advisor's careful wording");
    });
    const anotherIntake = intake({ intakeId: 'intake-2', clientFirstName: 'Priya', link: 'https://example.test/i/def#another-link-secret' });
    view.rerender(<NudgeReviewModal open row={deriveOnboardingRow(anotherIntake, now, DEFAULT_ONBOARDING_CONFIG)} intake={anotherIntake} now={now} onOpenChange={vi.fn()} />);
    await waitFor(() => {
      expect(textAreaValue('nudge-review-body')).not.toContain("Advisor's careful wording");
      expect(textAreaValue('nudge-review-body')).toContain('Priya');
    });
  });

  it('discards a late regenerate from intake A after a successful switch to intake B', async () => {
    const lateLink = deferred<string>();
    reconstructAdvisorIntakeLinkMock.mockReturnValueOnce(lateLink.promise);
    const original = intake({
      clientEmail: 'sarah@example.test',
      firmName: 'Firm A',
    });
    const view = render(
      <NudgeReviewModal
        open
        row={deriveOnboardingRow(original, now, DEFAULT_ONBOARDING_CONFIG)}
        intake={original}
        now={now}
        onOpenChange={vi.fn()}
      />
    );
    await waitFor(() => { expect(screen.getByTestId('nudge-review-body')).not.toBeDisabled(); });
    fireEvent.change(screen.getByTestId('nudge-review-body'), {
      target: { value: 'PRIVATE WORDING TYPED FOR CLIENT A' },
    });

    const refreshedA = intake({
      clientEmail: 'sarah@example.test',
      firmName: 'Firm A',
      publicKeyRawB64: 'public-key-a',
      items: [
        { itemId: 'ssn', label: 'Social Security number', state: 'received' },
        { itemId: 'income', label: 'Income', state: 'received' },
      ],
    });
    delete refreshedA.link;
    useIntakeStore.getState().upsertIntake(refreshedA);
    await waitFor(() => { expect(screen.getByTestId('nudge-regenerate')).toBeInTheDocument(); });
    fireEvent.click(screen.getByTestId('nudge-regenerate'));
    await waitFor(() => { expect(reconstructAdvisorIntakeLinkMock).toHaveBeenCalledTimes(1); });

    const intakeB = intake({
      intakeId: 'intake-2',
      matterId: 'matter-2',
      clientFirstName: 'Priya',
      clientEmail: 'priya@example.test',
      firmName: 'Firm B',
      link: 'https://example.test/i/client-b#client-b-secret',
      items: [{ itemId: 'tax-return', label: 'Tax return', state: 'not_started' }],
    });
    view.rerender(
      <NudgeReviewModal
        open
        row={deriveOnboardingRow(intakeB, now, DEFAULT_ONBOARDING_CONFIG)}
        intake={intakeB}
        now={now}
        onOpenChange={vi.fn()}
      />
    );
    // The reset must happen in the switch render itself, before any effect or
    // B load can run. This catches a fields-only/passive-effect reset.
    expect(textAreaValue('nudge-review-body')).not.toContain('PRIVATE WORDING TYPED FOR CLIENT A');
    expect(screen.getByTestId('nudge-review-to')).toHaveValue('priya@example.test');
    expect(screen.getByTestId('nudge-review-subject')).toHaveValue('A few onboarding items for Firm B');
    expect(screen.getByTestId('nudge-missing-items')).toHaveTextContent('Tax return');
    await waitFor(() => {
      expect(textAreaValue('nudge-review-body')).toContain('Priya');
      expect(screen.getByTestId('nudge-review-to')).toHaveValue('priya@example.test');
      expect(screen.getByTestId('nudge-review-subject')).toHaveValue('A few onboarding items for Firm B');
      expect(screen.getByTestId('nudge-missing-items')).toHaveTextContent('Tax return');
    });

    await act(async () => {
      lateLink.resolve('https://example.test/i/client-a#late-client-a-secret');
      await lateLink.promise;
    });
    await waitFor(() => {
      expect(textAreaValue('nudge-review-body')).toContain('Priya');
      expect(textAreaValue('nudge-review-body')).not.toContain('PRIVATE WORDING TYPED FOR CLIENT A');
      expect(textAreaValue('nudge-review-body')).not.toContain('Sarah');
      expect(textAreaValue('nudge-review-body')).not.toContain('late-client-a-secret');
      expect(screen.getByTestId('nudge-review-to')).toHaveValue('priya@example.test');
      expect(screen.getByTestId('nudge-missing-items')).toHaveTextContent('Tax return');
    });
  });

  it('keeps failed intake B empty when intake A\'s AI rewrite resolves late', async () => {
    const lateRewrite = deferred<{ body: string }>();
    const structuredOutput = vi.fn().mockReturnValue(lateRewrite.promise);
    resolveEmailProviderMock.mockResolvedValue({
      provider: providerWithBody('unused', structuredOutput),
      providerId: 'test-provider',
      assuredAvailable: true,
    });
    const original = intake({
      clientEmail: 'sarah@example.test',
      firmName: 'Firm A',
    });
    const view = render(
      <NudgeReviewModal
        open
        row={deriveOnboardingRow(original, now, DEFAULT_ONBOARDING_CONFIG)}
        intake={original}
        now={now}
        onOpenChange={vi.fn()}
      />
    );
    await waitFor(() => { expect(screen.getByTestId('nudge-review-body')).not.toBeDisabled(); });
    fireEvent.change(screen.getByTestId('nudge-review-body'), {
      target: { value: 'PRIVATE WORDING TYPED FOR CLIENT A' },
    });
    fireEvent.click(screen.getByTestId('nudge-draft-in-my-voice'));
    await waitFor(() => { expect(structuredOutput).toHaveBeenCalledTimes(1); });

    reconstructAdvisorIntakeLinkMock.mockRejectedValueOnce(new Error('Client B link load failed'));
    const failedB = intake({
      // Deliberately reuse the record ID: matter ID alone is a genuine client
      // boundary and must still replace the entire state-owning session.
      matterId: 'matter-2',
      clientFirstName: 'Priya',
      clientEmail: 'priya@example.test',
      firmName: 'Firm B',
      publicKeyRawB64: 'public-key-b',
      items: [{ itemId: 'tax-return', label: 'Tax return', state: 'not_started' }],
    });
    delete failedB.link;
    view.rerender(
      <NudgeReviewModal
        open
        row={deriveOnboardingRow(failedB, now, DEFAULT_ONBOARDING_CONFIG)}
        intake={failedB}
        now={now}
        onOpenChange={vi.fn()}
      />
    );
    // Failed B starts fail-closed in the switch render. It must not wait for
    // the rejecting promise before hiding A's fields and underlying draft.
    expect(textAreaValue('nudge-review-body')).toBe('');
    expect(screen.getByTestId('nudge-review-to')).toHaveValue('');
    expect(screen.getByTestId('nudge-review-subject')).toHaveValue('');
    expect(screen.getByTestId('nudge-missing-items')).toBeEmptyDOMElement();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Regenerate the onboarding link');
      expect(screen.getByTestId('nudge-review-body')).toBeDisabled();
      expect(textAreaValue('nudge-review-body')).toBe('');
      expect(screen.getByTestId('nudge-review-to')).toHaveValue('');
      expect(screen.getByTestId('nudge-review-subject')).toHaveValue('');
      expect(screen.getByTestId('nudge-missing-items')).toBeEmptyDOMElement();
    });

    await act(async () => {
      lateRewrite.resolve({ body: 'LATE AI BODY FOR CLIENT A' });
      await lateRewrite.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Regenerate the onboarding link');
      expect(textAreaValue('nudge-review-body')).toBe('');
      expect(textAreaValue('nudge-review-body')).not.toContain('CLIENT A');
      expect(screen.getByTestId('nudge-review-to')).toHaveValue('');
      expect(screen.getByTestId('nudge-review-subject')).toHaveValue('');
      expect(screen.getByTestId('nudge-missing-items')).toBeEmptyDOMElement();
    });
  });
});
