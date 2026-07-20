import { describe, it, expect } from 'vitest';
import { describeWorkspaceOpenError, isTransientWorkspaceOpenFailure } from './workspaceOpenErrors';
import { BRAND } from '@/config/brand';
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

  it('QA-33 flagship repro: shows the polished message for vault_status\'s exact wire shape (not raw backend text)', () => {
    // src-tauri/src/commands/vault/mod.rs's VaultCommandError::ServiceUnavailable
    // is #[serde(rename = "serviceUnavailable")]'d to match KeychainError's tag
    // exactly (see service_unavailable_serializes_with_the_same_kind_tag_as_
    // keychain_error in vault/mod.rs) — this is the actual shape a stopped
    // VaultSvc produces during workspace-open, not keychain_get's shape.
    const message = describeWorkspaceOpenError({
      kind: 'serviceUnavailable',
      message: 'the OS credential storage service did not respond in time — it may be stopped, disabled, or unreachable',
    });
    expect(message).toBe(
      `Windows' credential storage service isn't running, so ${BRAND.name} couldn't finish opening this workspace. Your files are safe. Try again, or restart the "Credential Manager" service (services.msc) if this keeps happening.`,
    );
  });

  it('does NOT show the polished message for a generic (non-ServiceUnavailable) vault keychain error', () => {
    // A plain VaultCommandError::Keychain (some other keyring failure, not a
    // timeout) — this one legitimately falls through to the raw message,
    // since it isn't the credential-service-outage case.
    const message = describeWorkspaceOpenError({ kind: 'keychain', message: 'no matching entry' });
    expect(message).toBe('no matching entry');
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
