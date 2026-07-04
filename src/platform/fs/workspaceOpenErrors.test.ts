import { describe, it, expect } from 'vitest';
import { describeWorkspaceOpenError, isTransientWorkspaceOpenFailure } from './workspaceOpenErrors';
import { TimeoutError } from '@/lib/withTimeout';

describe('describeWorkspaceOpenError', () => {
  it('names the credential-service outage honestly for a serviceUnavailable kind', () => {
    const message = describeWorkspaceOpenError({
      kind: 'serviceUnavailable',
      message: 'the OS credential storage service did not respond in time',
    });
    expect(message).toContain("credential storage service isn't running");
    expect(message).toContain('Your files are safe');
  });

  it('surfaces a TimeoutError message as-is', () => {
    const message = describeWorkspaceOpenError(new TimeoutError('Opening the workspace', 30_000));
    expect(message).toBe('Opening the workspace timed out after 30s');
  });

  it('surfaces a plain Error message as-is', () => {
    const message = describeWorkspaceOpenError(new Error('Workspace path does not exist: /foo'));
    expect(message).toBe('Workspace path does not exist: /foo');
  });

  it('falls back to a generic message for a structured error with no usable text', () => {
    const message = describeWorkspaceOpenError({ kind: 'other' });
    expect(message).toBe('Could not open this workspace. Please try again.');
  });

  it('reads .message off a non-Error structured error object', () => {
    const message = describeWorkspaceOpenError({ kind: 'io', message: 'disk is full' });
    expect(message).toBe('disk is full');
  });

  it('falls back to a generic message for a totally unrecognized value', () => {
    expect(describeWorkspaceOpenError(null)).toBe('Could not open this workspace. Please try again.');
    expect(describeWorkspaceOpenError(undefined)).toBe('Could not open this workspace. Please try again.');
    expect(describeWorkspaceOpenError('raw string')).toBe('Could not open this workspace. Please try again.');
  });
});

describe('isTransientWorkspaceOpenFailure', () => {
  it('treats a TimeoutError as transient', () => {
    expect(isTransientWorkspaceOpenFailure(new TimeoutError('Checking vault status', 5_000))).toBe(true);
  });

  it('treats a serviceUnavailable KeychainError as transient', () => {
    expect(isTransientWorkspaceOpenFailure({ kind: 'serviceUnavailable', message: 'x' })).toBe(true);
  });

  it('treats a keychain-tagged VaultCommandError as transient', () => {
    expect(isTransientWorkspaceOpenFailure({ kind: 'keychain', message: 'x' })).toBe(true);
  });

  it('does not treat a plain "path does not exist" error as transient', () => {
    expect(isTransientWorkspaceOpenFailure(new Error('Workspace path does not exist: /foo'))).toBe(false);
  });

  it('does not treat an unrelated structured error as transient', () => {
    expect(isTransientWorkspaceOpenFailure({ kind: 'path_traversal', message: 'x' })).toBe(false);
  });
});
