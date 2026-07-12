/**
 * isImportingContent (QA-90) — the pure selector the Ask "still importing"
 * banner is built on. True while email, Wealthbox CRM, OneDrive, or
 * workspace file indexing is actively importing; false otherwise. An AI
 * model download is deliberately excluded — that's a different signal (can
 * the AI answer at all), not "is content still coming in."
 */

import { describe, it, expect } from 'vitest';
import type { SetupProgress } from '@/platform/utils/setup-progress-commands';
import { EMPTY_SETUP_PROGRESS, isImportingContent } from '@/platform/utils/setup-progress-commands';

function progressWith(overrides: Partial<SetupProgress>): SetupProgress {
  return { ...EMPTY_SETUP_PROGRESS, ...overrides };
}

describe('isImportingContent — QA-90', () => {
  it('is false for a fully idle snapshot', () => {
    expect(isImportingContent(progressWith({}))).toBe(false);
  });

  it('is true while email is syncing', () => {
    const p = progressWith({ email: { connected: true, credentialsAvailable: true, accounts: [], syncing: true, messagesImported: 1 } });
    expect(isImportingContent(p)).toBe(true);
  });

  it('is true while Wealthbox CRM is syncing', () => {
    const p = progressWith({ crm: { connected: true, credentialsAvailable: true, syncing: true, householdsProcessed: 1, recordsIndexed: 1 } });
    expect(isImportingContent(p)).toBe(true);
  });

  it('is true while OneDrive is syncing', () => {
    const p = progressWith({ oneDrive: { syncing: true, status: 'syncing', itemsChecked: 1, itemsImported: 0 } });
    expect(isImportingContent(p)).toBe(true);
  });

  it('is true while workspace file indexing is running', () => {
    const p = progressWith({ fileIndex: { indexing: true, processed: 1, total: 10, percent: 10 } });
    expect(isImportingContent(p)).toBe(true);
  });

  it('is false once every source has finished', () => {
    const p = progressWith({
      email: { connected: true, credentialsAvailable: true, accounts: [], syncing: false, messagesImported: 100 },
      crm: { connected: true, credentialsAvailable: true, syncing: false, householdsProcessed: 5, recordsIndexed: 20 },
      oneDrive: { syncing: false, status: 'done', itemsChecked: 10, itemsImported: 10 },
      fileIndex: { indexing: false, processed: 10, total: 10, percent: 100 },
    });
    expect(isImportingContent(p)).toBe(false);
  });

  it('is false for an AI model download alone (not a content import)', () => {
    const p = progressWith({
      ai: {
        mode: 'local',
        state: 'downloading',
        percent: 40,
        cloudKeyPresent: false,
        localLlm: { state: 'downloading', percent: 40 },
        searchModel: { state: 'none', percent: null },
      },
    });
    expect(isImportingContent(p)).toBe(false);
  });
});
