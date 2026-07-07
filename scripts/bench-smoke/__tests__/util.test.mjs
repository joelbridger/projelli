import { describe, it, expect, vi } from 'vitest';
import {
  withGuard,
  clickElement,
  ensureClientsTableTab,
  openAllClientsTable,
  openSmokeClientDocuments,
  openSmokeClientOverview,
  openSmokeClientDocumentsSubtab,
  openSmokeClientNote,
  openSettingsAiPrivacy,
  openAccountConnectionsTab,
  openAskSurface,
} from '../checks/_util.mjs';
import { DriverError } from '../driver.mjs';
import { makeResult, STATUS } from '../result.mjs';

describe('withGuard', () => {
  it('passes through a well-formed result unchanged (plus durationMs)', async () => {
    const check = withGuard('id', 'Section', async () => makeResult({ id: 'id', section: 'Section', status: STATUS.PASS, detail: 'ok' }));
    const result = await check({});
    expect(result.status).toBe(STATUS.PASS);
    expect(typeof result.durationMs).toBe('number');
  });

  it('turns a thrown DriverError into SETUP-BLOCKED, not FAIL', async () => {
    const check = withGuard('id', 'Section', async () => {
      throw new DriverError('bench unreachable');
    });
    const result = await check({});
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
    expect(result.detail).toMatch(/bench unreachable/);
  });

  it('turns any other thrown error into FAIL, not a crash', async () => {
    const check = withGuard('id', 'Section', async () => {
      throw new TypeError('unexpected shape');
    });
    const result = await check({});
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/unexpected shape/);
  });
});

describe('clickElement', () => {
  // Regression test: a prior version of the checks called
  // `driver.click(el.testid ?? undefined)`, which silently sent the literal
  // string "undefined" as a testid whenever an element was matched only by
  // text (no data-testid) — every such click timed out looking for
  // `[data-testid="undefined"]`. clickElement must route text-only matches
  // through clickByText instead of ever calling click(undefined).
  it('clicks by testid when the element has one', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await clickElement(driver, { testid: 'sync-button', text: 'Sync now' });
    expect(driver.click).toHaveBeenCalledWith('sync-button');
    expect(driver.clickByText).not.toHaveBeenCalled();
  });

  it('falls back to clicking by text when the element has no testid', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await clickElement(driver, { text: 'Sync now' });
    expect(driver.clickByText).toHaveBeenCalledWith('Sync now');
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('never calls click() with an undefined testid', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await clickElement(driver, { text: 'Approve 1 change' });
    for (const call of driver.click.mock.calls) {
      expect(call[0]).not.toBeUndefined();
    }
  });

  it('throws when the element has neither a testid nor text', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await expect(clickElement(driver, {})).rejects.toThrow(/neither a testid nor visible text/);
  });

  it('throws when there is no element at all', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await expect(clickElement(driver, undefined)).rejects.toThrow(/no element to click/);
  });
});

describe('ensureClientsTableTab', () => {
  it('opens the rail-pinned All Clients row', async () => {
    const driver = { click: vi.fn(), evalJs: vi.fn().mockResolvedValue(true) };
    await ensureClientsTableTab(driver);
    expect(driver.click).toHaveBeenCalledWith('spine-nav-matters');
    expect(driver.click).toHaveBeenCalledWith('spine-all-clients-row');
  });

  it('opens the clients section first when All Clients is collapsed', async () => {
    const driver = { click: vi.fn(), evalJs: vi.fn().mockResolvedValue(false) };
    await ensureClientsTableTab(driver);
    expect(driver.click).toHaveBeenNthCalledWith(1, 'spine-nav-matters');
    expect(driver.click).toHaveBeenNthCalledWith(2, 'spine-clients-toggle');
    expect(driver.click).toHaveBeenNthCalledWith(3, 'spine-all-clients-row');
  });
});

describe('openAllClientsTable', () => {
  it('clicks spine-nav-matters, then the permanent All Clients rail row', async () => {
    const driver = { click: vi.fn(), evalJs: vi.fn().mockResolvedValue(true) };
    await openAllClientsTable(driver);
    expect(driver.click).toHaveBeenNthCalledWith(1, 'spine-nav-matters');
    expect(driver.click).toHaveBeenNthCalledWith(2, 'spine-all-clients-row');
  });
});

describe('openSmokeClientDocuments', () => {
  it('clicks the matter-launch-documents testid for the given matterId, then waits for the given text', async () => {
    const driver = { click: vi.fn(), evalJs: vi.fn().mockResolvedValue(true), waitFor: vi.fn().mockResolvedValue({ found: true }) };
    await openSmokeClientDocuments(driver, { matterId: 'matter_abc', waitForText: 'Documents' });
    expect(driver.click).toHaveBeenCalledWith('matter-launch-documents-matter_abc');
    expect(driver.waitFor).toHaveBeenCalledWith('Documents', 10);
  });

  it('normalizes to the Clients table tab first (ensureClientsTableTab), before the launch-documents click', async () => {
    // The per-client Documents launch exists on the All Clients table.
    const calls = [];
    const driver = {
      click: vi.fn((testid) => calls.push(`click:${testid}`)),
      evalJs: vi.fn().mockResolvedValue(false),
      waitFor: vi.fn().mockResolvedValue({ found: true }),
    };
    await openSmokeClientDocuments(driver, { matterId: 'matter_abc' });
    expect(calls).toEqual(['click:spine-nav-matters', 'click:spine-clients-toggle', 'click:spine-all-clients-row', 'click:matter-launch-documents-matter_abc']);
  });

  it('still attempts the launch-documents click when ensureClientsTableTab throws (e.g. minimal fake driver)', async () => {
    const driver = { click: vi.fn(), waitFor: vi.fn().mockResolvedValue({ found: true }) };
    await openSmokeClientDocuments(driver, { matterId: 'matter_abc' });
    expect(driver.click).toHaveBeenCalledWith('matter-launch-documents-matter_abc');
  });

  it('throws a DriverError when the expected text never appears', async () => {
    const driver = { click: vi.fn(), waitFor: vi.fn().mockResolvedValue({ found: false, error: 'timed out' }) };
    await expect(openSmokeClientDocuments(driver, { matterId: 'matter_abc' })).rejects.toThrow(DriverError);
  });
});

describe('openSmokeClientOverview', () => {
  it('clicks the hub-subtab-overview testid', async () => {
    const driver = { click: vi.fn() };
    await openSmokeClientOverview(driver);
    expect(driver.click).toHaveBeenCalledWith('hub-subtab-overview');
  });
});

describe('openSmokeClientNote', () => {
  it('switches to Tree view first, then double-clicks the filename and waits for the docx toolbar text', async () => {
    const driver = { clickByText: vi.fn(), doubleClickByText: vi.fn(), waitFor: vi.fn().mockResolvedValue({ found: true }) };
    await openSmokeClientNote(driver, { fileName: 'Meeting Notes.docx', waitForText: 'Draft follow-up' });
    expect(driver.clickByText).toHaveBeenCalledWith('Tree');
    expect(driver.doubleClickByText).toHaveBeenCalledWith('Meeting Notes.docx');
    expect(driver.waitFor).toHaveBeenCalledWith('Draft follow-up', 10);
  });

  it('still opens the note when the Tree/Grid toggle is not present (clickByText throws)', async () => {
    const driver = {
      clickByText: vi.fn().mockRejectedValue(new DriverError('no matching element')),
      doubleClickByText: vi.fn(),
      waitFor: vi.fn().mockResolvedValue({ found: true }),
    };
    await openSmokeClientNote(driver, { fileName: 'Meeting Notes.docx' });
    expect(driver.doubleClickByText).toHaveBeenCalledWith('Meeting Notes.docx');
  });

  it('throws a DriverError when the docx toolbar never appears', async () => {
    const driver = { clickByText: vi.fn(), doubleClickByText: vi.fn(), waitFor: vi.fn().mockResolvedValue({ found: false, error: 'timed out' }) };
    await expect(openSmokeClientNote(driver, { fileName: 'x.docx' })).rejects.toThrow(DriverError);
  });
});

describe('openSmokeClientDocumentsSubtab', () => {
  it('clicks the hub-subtab-documents testid', async () => {
    const driver = { click: vi.fn() };
    await openSmokeClientDocumentsSubtab(driver);
    expect(driver.click).toHaveBeenCalledWith('hub-subtab-documents');
  });
});

describe('openSettingsAiPrivacy', () => {
  it('clicks settings-gear then settings-category-ai-privacy, in order', async () => {
    const calls = [];
    const driver = { click: vi.fn((testid) => calls.push(testid)) };
    await openSettingsAiPrivacy(driver);
    expect(calls).toEqual(['settings-gear', 'settings-category-ai-privacy']);
  });

  it('propagates a DriverError from either click (best-effort callers catch it)', async () => {
    const driver = { click: vi.fn().mockRejectedValue(new DriverError('gear not found')) };
    await expect(openSettingsAiPrivacy(driver)).rejects.toThrow(DriverError);
  });
});

describe('openAccountConnectionsTab', () => {
  it('clicks account-identity then account-tab-connections, in order', async () => {
    const calls = [];
    const driver = { click: vi.fn((testid) => calls.push(testid)) };
    await openAccountConnectionsTab(driver);
    expect(calls).toEqual(['account-identity', 'account-tab-connections']);
  });
});

describe('openAskSurface', () => {
  it('clicks spine-nav-search (the Ask surface\'s kept internal spine id)', async () => {
    const driver = { click: vi.fn() };
    await openAskSurface(driver);
    expect(driver.click).toHaveBeenCalledWith('spine-nav-search');
  });
});
