// scripts/bench-smoke/__tests__/wave2.test.mjs — QA finding (harness honesty):
// checkWealthboxQueueAndReview used to gate PASS on driver.waitFor('review
// card', ...), a whole-page substring text match. The toolbar's OWN
// confirmation copy ("Added to the Wealthbox review card on this client's
// map") satisfied that match all by itself — the check could PASS having
// only ever seen the toast, never the real card
// ([data-testid="crm-write-card-collapsed"]). These tests pin the fixed
// behavior: PASS/FAIL now hinges on the real card's testid (and, once
// expanded, a reachable Approve control), not on any text match.
import { describe, it, expect, vi } from 'vitest';
import { checkWealthboxQueueAndReview } from '../checks/wave2.mjs';
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

const SEND_BUTTON = [{ testid: 'docx-send-to-wealthbox' }];

describe('checkWealthboxQueueAndReview', () => {
  it('does NOT PASS when only a toast/confirmation appears and the real review card never renders (the exact false-positive this check used to have)', async () => {
    const driver = makeDriver({
      // Every driver.waitFor call (including the old literal "review card"
      // match) resolves found:true — simulating a naive text-match hitting
      // the toolbar's own confirmation copy instead of the real card.
      waitFor: vi.fn().mockResolvedValue({ found: true }),
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, elements: SEND_BUTTON })
        .mockResolvedValueOnce({
          ok: true,
          elements: [{ testid: 'docx-send-to-wealthbox-confirmation', text: 'Queued for Wealthbox review' }],
        }),
    });

    const result = await checkWealthboxQueueAndReview({ driver });

    expect(result.status).not.toBe(STATUS.PASS);
  });

  it('PASSes only once the real card testid appears AND expanding it reveals a reachable Approve control', async () => {
    const driver = makeDriver({
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, elements: SEND_BUTTON })
        .mockResolvedValueOnce({ ok: true, elements: [{ testid: 'crm-write-card-collapsed' }] })
        .mockResolvedValueOnce({
          ok: true,
          elements: [{ testid: 'crm-write-card-collapsed' }, { testid: 'crm-approve-btn', text: 'Approve 1 change' }],
        }),
    });

    const result = await checkWealthboxQueueAndReview({ driver });

    expect(result.status).toBe(STATUS.PASS);
    expect(driver.click).toHaveBeenCalledWith('crm-write-card-collapsed');
  });

  // Coordinator review catch (P2): CrmWritePendingBanner (QA finding P2) made
  // CrmWriteReviewCard mount ONLY on the Overview sub-tab — Documents (where
  // this check clicks Send to Wealthbox, per openSmokeClientDocumentsSubtab)
  // now shows only the pending-review banner once a write is queued. Without
  // navigating back to Overview, a genuinely WORKING app would false-FAIL
  // here (the collapsed card lives on a sub-tab this check never visits).
  it('navigates back to Overview via the pending-review banner Review-now action before looking for the real card', async () => {
    const clickOrder = [];
    const driver = makeDriver({
      click: vi.fn().mockImplementation(async (testid) => { clickOrder.push(testid); }),
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, elements: SEND_BUTTON })
        .mockResolvedValueOnce({ ok: true, elements: [{ testid: 'crm-write-card-collapsed' }] })
        .mockResolvedValueOnce({
          ok: true,
          elements: [{ testid: 'crm-write-card-collapsed' }, { testid: 'crm-approve-btn', text: 'Approve 1 change' }],
        }),
    });

    const result = await checkWealthboxQueueAndReview({ driver });

    expect(result.status).toBe(STATUS.PASS);
    const sendIdx = clickOrder.indexOf('docx-send-to-wealthbox');
    const reviewNowIdx = clickOrder.indexOf('hub-crm-pending-banner-review-now');
    const cardIdx = clickOrder.indexOf('crm-write-card-collapsed');
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(reviewNowIdx).toBeGreaterThan(sendIdx);
    expect(cardIdx).toBeGreaterThan(reviewNowIdx);
  });

  it('falls back to clicking the Overview sub-tab directly if the pending-review banner is not clickable', async () => {
    const driver = makeDriver({
      click: vi.fn().mockImplementation(async (testid) => {
        if (testid === 'hub-crm-pending-banner-review-now') throw new Error('not found');
      }),
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, elements: SEND_BUTTON })
        .mockResolvedValueOnce({ ok: true, elements: [{ testid: 'crm-write-card-collapsed' }] })
        .mockResolvedValueOnce({
          ok: true,
          elements: [{ testid: 'crm-write-card-collapsed' }, { testid: 'crm-approve-btn', text: 'Approve 1 change' }],
        }),
    });

    const result = await checkWealthboxQueueAndReview({ driver });

    expect(result.status).toBe(STATUS.PASS);
    expect(driver.click).toHaveBeenCalledWith('hub-subtab-overview');
  });

  it('FAILs when the card renders but expanding it never reveals an Approve control', async () => {
    const driver = makeDriver({
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, elements: SEND_BUTTON })
        .mockResolvedValueOnce({ ok: true, elements: [{ testid: 'crm-write-card-collapsed' }] })
        .mockResolvedValueOnce({ ok: true, elements: [{ testid: 'crm-write-card-collapsed' }] }),
    });

    const result = await checkWealthboxQueueAndReview({ driver });

    expect(result.status).toBe(STATUS.FAIL);
  });

  it('is SETUP-BLOCKED (not FAIL) when the card never appears because the client is not linked to a Wealthbox household', async () => {
    const driver = makeDriver({
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, elements: SEND_BUTTON })
        .mockResolvedValueOnce({
          ok: true,
          elements: [{ testid: 'x', text: 'Link this client to a Wealthbox household first.' }],
        }),
    });

    const result = await checkWealthboxQueueAndReview({ driver });

    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });

  it('is SETUP-BLOCKED when the Send to Wealthbox button is not present at all', async () => {
    const driver = makeDriver({
      snapshot: vi.fn().mockResolvedValue({ ok: true, elements: [] }),
    });

    const result = await checkWealthboxQueueAndReview({ driver });

    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
  });
});
