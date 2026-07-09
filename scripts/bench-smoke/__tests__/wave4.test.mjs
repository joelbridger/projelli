import { describe, it, expect, vi } from 'vitest';
import {
  checkAllClientsHub,
  checkEstateBeneficiaryGap,
  checkEstateBeneficiaryGapDismissLive,
  checkWholePracticeAsk,
} from '../checks/wave4.mjs';
import { STATUS } from '../result.mjs';

function makeDriver(overrides = {}) {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    clickByText: vi.fn().mockResolvedValue(undefined),
    doubleClickByText: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue({ found: true }),
    evalJs: vi.fn().mockResolvedValue(null),
    snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }),
    captureScreenshot: vi.fn().mockResolvedValue('shot.jpeg'),
    ...overrides,
  };
}

describe('checkAllClientsHub', () => {
  it('is SETUP-BLOCKED when the permanent All Clients rail row is missing', async () => {
    const driver = makeDriver({ snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }) });
    const result = await checkAllClientsHub({ driver });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });

  it('FAILs when All Clients opens but no matter rows exist', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [{ testid: 'spine-all-clients-row', tag: 'button' }] }),
    });
    const result = await checkAllClientsHub({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/no client table rows/);
  });

  it('FAILs when clicking the first row never opens a client hub', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'spine-all-clients-row', tag: 'button' },
          { testid: 'matter-row-matter_a', tag: 'button' },
        ],
      }),
      waitFor: vi.fn().mockResolvedValue({ found: false, error: 'timed out' }),
      evalJs: vi.fn().mockResolvedValue(false),
    });
    const result = await checkAllClientsHub({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/did not open a client hub/);
  });

  it('PASSes when All Clients renders matter rows and a row click opens the hub', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'spine-all-clients-row', tag: 'button' },
          { testid: 'matter-row-shell-matter_a', tag: 'div' },
          { testid: 'matter-row-matter_a', tag: 'button' },
          { testid: 'matter-row-matter_b', tag: 'button' },
        ],
      }),
      evalJs: vi.fn().mockResolvedValue(true),
    });
    const result = await checkAllClientsHub({ driver });
    expect(result.status).toBe(STATUS.PASS);
    expect(driver.click).toHaveBeenCalledWith('matter-row-matter_a');
    expect(result.detail).toMatch(/2 client row/);
  });
});

describe('checkEstateBeneficiaryGap', () => {
  it('is SETUP-BLOCKED when All Clients has no matter rows to inspect', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [{ testid: 'spine-all-clients-row', tag: 'button' }] }),
    });
    const result = await checkEstateBeneficiaryGap({ driver });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });

  it('is SETUP-BLOCKED when no opened client has a resolvable gap control', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'spine-all-clients-row', tag: 'button' },
          { testid: 'matter-row-matter_a', tag: 'button' },
        ],
      }),
    });
    const result = await checkEstateBeneficiaryGap({ driver });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
    expect(result.detail).toMatch(/No clientmap-ask-flag row/);
  });

  it('PASSes without resolving anything when a resolvable gap row is present (read-only default)', async () => {
    // Regression guard for a Codex-review finding: this check used to click
    // clientmap-ask-flag on every normal run, mutating fixture state (a real
    // gap-resolve) during a supposedly read-only pass. It must now only
    // assert presence — dismissal moved to the --live-only sibling check.
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'spine-all-clients-row', tag: 'button' },
          { testid: 'matter-row-matter_a', tag: 'button' },
          { testid: 'clientmap-ask-know', tag: 'button' },
          { testid: 'clientmap-ask-flag', tag: 'button' },
        ],
      }),
    });
    const result = await checkEstateBeneficiaryGap({ driver });
    expect(result.status).toBe(STATUS.PASS);
    expect(driver.click).not.toHaveBeenCalledWith('clientmap-ask-know');
    expect(driver.click).not.toHaveBeenCalledWith('clientmap-ask-flag');
    expect(result.detail).toMatch(/Not dismissed here/);
  });
});

describe('checkEstateBeneficiaryGapDismissLive', () => {
  it('is SKIPPED without --live', async () => {
    const driver = makeDriver();
    const result = await checkEstateBeneficiaryGapDismissLive({ driver, live: false });
    expect(result.status).toBe(STATUS.SKIPPED);
  });

  it('is SETUP-BLOCKED under --live when no resolve control is present', async () => {
    const driver = makeDriver({ snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }) });
    const result = await checkEstateBeneficiaryGapDismissLive({ driver, live: true });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });

  it('never clicks clientmap-ask-know ("I know this" opens an answer prompt, not an immediate resolve)', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'clientmap-ask-know', tag: 'button' },
          { testid: 'clientmap-ask-flag', tag: 'button' },
        ],
      }),
      waitFor: vi.fn().mockResolvedValue({ found: true }),
    });
    await checkEstateBeneficiaryGapDismissLive({ driver, live: true });
    expect(driver.click).not.toHaveBeenCalledWith('clientmap-ask-know');
    expect(driver.click).toHaveBeenCalledWith('clientmap-ask-flag');
  });

  it('PASSes when dismissing drops the resolvable-row count', async () => {
    const snapshotSequence = [
      { ok: true, elements: [{ testid: 'clientmap-ask-flag', tag: 'button' }, { testid: 'clientmap-ask-flag', tag: 'button' }] },
      { ok: true, elements: [{ testid: 'clientmap-ask-flag', tag: 'button' }] },
    ];
    const snapshot = vi.fn().mockImplementation(() => Promise.resolve(snapshotSequence.shift()));
    const driver = makeDriver({
      snapshot,
      waitFor: vi.fn().mockResolvedValue({ found: false }), // "Nothing outstanding" not shown
    });
    const result = await checkEstateBeneficiaryGapDismissLive({ driver, live: true });
    expect(result.status).toBe(STATUS.PASS);
    expect(result.detail).toMatch(/dropped from 2 to 1/);
  });

  it('PASSes when dismissing reaches the "Nothing outstanding" clean state', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [{ testid: 'clientmap-ask-flag', tag: 'button' }] }),
      waitFor: vi.fn().mockResolvedValue({ found: true }), // "Nothing outstanding" shown
    });
    const result = await checkEstateBeneficiaryGapDismissLive({ driver, live: true });
    expect(result.status).toBe(STATUS.PASS);
    expect(result.detail).toMatch(/clean state shown/);
  });

  it('FAILs when the resolve control is clicked but the gap row is still present afterward', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [{ testid: 'clientmap-ask-flag', tag: 'button' }] }),
      waitFor: vi.fn().mockResolvedValue({ found: false }),
    });
    const result = await checkEstateBeneficiaryGapDismissLive({ driver, live: true });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/still present afterward/);
  });
});

describe('checkWholePracticeAsk', () => {
  it('FAILs when the hidden whole-practice scope control still renders', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'scope-toggle', tag: 'button' },
        ],
      }),
      evalJs: vi.fn().mockResolvedValue(true),
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/still renders/);
  });

  it('is SETUP-BLOCKED when no visible Ask scope controls are found', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }),
      evalJs: vi.fn().mockResolvedValue(false),
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
    expect(result.detail).toMatch(/No Ask scope toggle/);
  });

  it('FAILs when any remaining visible scope control is missing', async () => {
    const evalJs = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(JSON.stringify(['scope-option-all-matters', 'scope-option-email']));
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [{ testid: 'scope-toggle', tag: 'button' }],
      }),
      evalJs,
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/scope-option-documents/);
  });

  it('FAILs when a visible scope click does not update the scope pill', async () => {
    const evalJs = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(JSON.stringify(['scope-option-all-matters', 'scope-option-email', 'scope-option-documents']))
      .mockResolvedValueOnce('Wrong label');
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [{ testid: 'scope-toggle', tag: 'button' }],
      }),
      evalJs,
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(driver.click).toHaveBeenCalledWith('scope-option-all-matters');
    expect(result.detail).toMatch(/instead of "All"/);
  });

  it('PASSes when whole-practice is hidden and the remaining scopes switch', async () => {
    const evalJs = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(JSON.stringify(['scope-option-all-matters', 'scope-option-email', 'scope-option-documents']))
      .mockResolvedValueOnce('All')
      .mockResolvedValueOnce('Email')
      .mockResolvedValueOnce('Docs');
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [{ testid: 'scope-toggle', tag: 'button' }],
      }),
      evalJs,
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.PASS);
    expect(driver.click).toHaveBeenCalledWith('scope-option-all-matters');
    expect(driver.click).toHaveBeenCalledWith('scope-option-email');
    expect(driver.click).toHaveBeenCalledWith('scope-option-documents');
    expect(result.detail).toMatch(/Whole-practice Ask scope option is absent/);
  });
});
