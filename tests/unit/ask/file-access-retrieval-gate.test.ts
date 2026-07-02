/**
 * F2.5 (Codex round-5 delta) — ambient retrieval gating + prompt/registration
 * agreement.
 *
 * P1: the persistent Ask-my-workspace TOGGLE is ambient (not per-message intent),
 * so for a cloud provider it must ALSO require file-access consent; a TYPED
 * `@workspace` mention is the user's per-message ask and stays allowed; local
 * providers are unaffected.
 *
 * P2: the system prompt's "you have file tools" block must be derived from what
 * was ACTUALLY registered (fileToolsRegistered), so the model is never told about
 * tools it doesn't have.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveWorkspaceRetrieval,
  fileToolsRegistered,
} from '@/platform/ai/fileAccessConsent';
import { buildSystemPrompt } from '@/features/ask/hooks/buildSystemPrompt';

describe('resolveWorkspaceRetrieval — ambient toggle blocked until consent (cloud)', () => {
  it('cloud + toggle ON + NO consent → ambient retrieval BLOCKED', () => {
    const r = resolveWorkspaceRetrieval({
      explicitWorkspace: false,
      askWorkspaceMode: true,
      isCloudProvider: true,
      fileAccessGranted: false,
    });
    expect(r.shouldRetrieve).toBe(false);
    expect(r.ambientBlockedByConsent).toBe(true);
  });

  it('cloud + toggle ON + consent GRANTED → ambient retrieval runs', () => {
    const r = resolveWorkspaceRetrieval({
      explicitWorkspace: false,
      askWorkspaceMode: true,
      isCloudProvider: true,
      fileAccessGranted: true,
    });
    expect(r.shouldRetrieve).toBe(true);
    expect(r.ambientBlockedByConsent).toBe(false);
  });

  it('LOCAL + toggle ON + NO consent → ambient retrieval STILL runs (unaffected)', () => {
    const r = resolveWorkspaceRetrieval({
      explicitWorkspace: false,
      askWorkspaceMode: true,
      isCloudProvider: false,
      fileAccessGranted: false,
    });
    expect(r.shouldRetrieve).toBe(true);
    expect(r.ambientBlockedByConsent).toBe(false);
  });
});

describe('resolveWorkspaceRetrieval — explicit @workspace always allowed', () => {
  it('cloud + typed @workspace + NO consent → retrieval runs (user asked)', () => {
    const r = resolveWorkspaceRetrieval({
      explicitWorkspace: true,
      askWorkspaceMode: false,
      isCloudProvider: true,
      fileAccessGranted: false,
    });
    expect(r.shouldRetrieve).toBe(true);
    expect(r.ambientBlockedByConsent).toBe(false);
  });

  it('typed @workspace is not counted as an ambient block even with the toggle on', () => {
    const r = resolveWorkspaceRetrieval({
      explicitWorkspace: true,
      askWorkspaceMode: true,
      isCloudProvider: true,
      fileAccessGranted: false,
    });
    expect(r.shouldRetrieve).toBe(true);
    expect(r.ambientBlockedByConsent).toBe(false);
  });

  it('no toggle, no mention → no retrieval, not a consent block', () => {
    const r = resolveWorkspaceRetrieval({
      explicitWorkspace: false,
      askWorkspaceMode: false,
      isCloudProvider: true,
      fileAccessGranted: false,
    });
    expect(r.shouldRetrieve).toBe(false);
    expect(r.ambientBlockedByConsent).toBe(false);
  });
});

describe('prompt matches registration (fileToolsRegistered ↔ buildSystemPrompt)', () => {
  const TOOL_MARKER = 'read_file, write_file'; // appears only in the tools block

  const promptFor = (hasWorkspace: boolean) =>
    buildSystemPrompt({
      messages: [{ role: 'user', content: 'hi', timestamp: 't' }],
      hasWorkspace,
      rootPath: '/ws',
      fileBlock: '',
      retrievedSources: [],
      facts: [],
      withheldExportNote: '',
    });

  it('registered → prompt DOES advertise the file tools', () => {
    const registered = fileToolsRegistered({ hasWorkspace: true, isCloudProvider: true, fileAccessGranted: true });
    expect(registered).toBe(true);
    expect(promptFor(registered)).toContain(TOOL_MARKER);
  });

  it('not consented → NOT registered → prompt does NOT advertise file tools', () => {
    const registered = fileToolsRegistered({ hasWorkspace: true, isCloudProvider: true, fileAccessGranted: false });
    expect(registered).toBe(false);
    expect(promptFor(registered)).not.toContain(TOOL_MARKER);
  });

  it('local provider → NOT registered → prompt does NOT advertise file tools', () => {
    const registered = fileToolsRegistered({ hasWorkspace: true, isCloudProvider: false, fileAccessGranted: true });
    expect(registered).toBe(false);
    expect(promptFor(registered)).not.toContain(TOOL_MARKER);
  });

  it('no workspace → NOT registered → prompt does NOT advertise file tools', () => {
    const registered = fileToolsRegistered({ hasWorkspace: false, isCloudProvider: true, fileAccessGranted: true });
    expect(registered).toBe(false);
    expect(promptFor(registered)).not.toContain(TOOL_MARKER);
  });
});
