import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import {
  checkWholeBookView,
  checkEstateBeneficiaryGap,
  checkEstateBeneficiaryGapDismissLive,
  checkWholePracticeAsk,
  findGapRowScript,
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

describe('findGapRowScript', () => {
  // Executed against a fake DOM (node:vm), same technique as
  // click-by-text.test.mjs — proves the generated script's querySelector
  // logic actually finds the right row, not just that its source text looks
  // plausible.
  function runAgainstFakeDom(js, rows) {
    const context = vm.createContext({
      document: {
        querySelectorAll: (selector) => {
          expect(selector).toBe('[data-testid^="book-row-"]');
          return rows;
        },
      },
    });
    return vm.runInContext(js, context);
  }

  function makeRow(testid, hasGap) {
    return {
      getAttribute: (name) => (name === 'data-testid' ? testid : null),
      querySelector: (sel) => {
        expect(sel).toBe('[data-testid="book-gap-chip"]');
        return hasGap ? {} : null;
      },
    };
  }

  it('returns the testid of the first row containing a book-gap-chip', () => {
    const rows = [makeRow('book-row-matter_a', false), makeRow('book-row-matter_b', true)];
    const result = runAgainstFakeDom(findGapRowScript(), rows);
    expect(result).toBe('book-row-matter_b');
  });

  it('returns null when no row has a gap chip', () => {
    const rows = [makeRow('book-row-matter_a', false), makeRow('book-row-matter_b', false)];
    const result = runAgainstFakeDom(findGapRowScript(), rows);
    expect(result).toBeNull();
  });

  it('returns null when there are no rows at all', () => {
    const result = runAgainstFakeDom(findGapRowScript(), []);
    expect(result).toBeNull();
  });
});

describe('checkWholeBookView', () => {
  it('is SETUP-BLOCKED when no book-view container is found', async () => {
    const driver = makeDriver({ snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }) });
    const result = await checkWholeBookView({ driver });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });

  it('FAILs when book-view is present but no book-row-* rows exist', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [{ testid: 'book-view', tag: 'div' }] }),
    });
    const result = await checkWholeBookView({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/no ranked client rows/);
  });

  it('FAILs when clicking the first row never opens a client hub', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'book-view', tag: 'div' },
          { testid: 'book-row-matter_a', tag: 'div' },
        ],
      }),
      waitFor: vi.fn().mockResolvedValue({ found: false, error: 'timed out' }),
    });
    const result = await checkWholeBookView({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/did not open a client hub/);
  });

  it('PASSes when the book view renders ranked rows and a row click opens the hub', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'book-view', tag: 'div' },
          { testid: 'book-row-matter_a', tag: 'div' },
          { testid: 'book-row-matter_b', tag: 'div' },
        ],
      }),
    });
    const result = await checkWholeBookView({ driver });
    expect(result.status).toBe(STATUS.PASS);
    expect(driver.click).toHaveBeenCalledWith('book-row-matter_a');
    expect(result.detail).toMatch(/2 ranked client row/);
  });
});

describe('checkEstateBeneficiaryGap', () => {
  it('is SETUP-BLOCKED when evalJs finds no gap row', async () => {
    const driver = makeDriver({ evalJs: vi.fn().mockResolvedValue(null) });
    const result = await checkEstateBeneficiaryGap({ driver });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });

  it('FAILs when the flagged row has no resolvable gap control in its Client Map sub-tab', async () => {
    const driver = makeDriver({
      evalJs: vi.fn().mockResolvedValue('book-row-matter_a'),
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }),
    });
    const result = await checkEstateBeneficiaryGap({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/no resolvable gap row/);
  });

  it('PASSes without clicking anything when a resolvable gap row is present (read-only default)', async () => {
    // Regression guard for a Codex-review finding: this check used to click
    // clientmap-ask-flag on every normal run, mutating fixture state (a real
    // gap-resolve) during a supposedly read-only pass. It must now only
    // assert presence — dismissal moved to the --live-only sibling check.
    const driver = makeDriver({
      evalJs: vi.fn().mockResolvedValue('book-row-matter_a'),
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
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
  it('is SETUP-BLOCKED when no scope-option-whole-practice control is found', async () => {
    const driver = makeDriver({ snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }) });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });

  it('FAILs when the scope pill text never appears after selecting the option', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [{ testid: 'scope-option-whole-practice', tag: 'button' }] }),
      waitFor: vi.fn().mockResolvedValue({ found: false }),
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.FAIL);
  });

  it('FAILs when the pill text appears (waitFor found) but no ask-scope-pill testid is in the snapshot', async () => {
    // Regression guard for a Codex-review finding: waitFor('Whole practice
    // (summaries only)') alone is not proof the scope actually switched if
    // the snapshot never shows the pill control — a stale/mocked waitFor
    // (or a copy collision) must not be enough on its own for a PASS.
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [{ testid: 'scope-option-whole-practice', tag: 'button' }] }),
      waitFor: vi.fn().mockResolvedValue({ found: true }),
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/no \[data-testid="ask-scope-pill"\]/);
  });

  it('PASSes and notes the consent gate when it is present', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'scope-option-whole-practice', tag: 'button' },
          { testid: 'ask-scope-pill', tag: 'div' },
          { testid: 'chat-file-access-consent', tag: 'div' },
        ],
      }),
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.PASS);
    expect(result.detail).toMatch(/consent gate/);
    expect(result.detail).toMatch(/appears as required/);
  });

  it('PASSes without treating an absent consent gate as a failure', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({
        ok: true,
        elements: [
          { testid: 'scope-option-whole-practice', tag: 'button' },
          { testid: 'ask-scope-pill', tag: 'div' },
        ],
      }),
    });
    const result = await checkWholePracticeAsk({ driver });
    expect(result.status).toBe(STATUS.PASS);
    expect(result.detail).toMatch(/No consent gate was present/);
  });
});
