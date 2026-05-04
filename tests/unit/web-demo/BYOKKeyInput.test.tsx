/**
 * Stream D-web Group V · Task 5.3 — BYOKKeyInput tests.
 *
 * Coverage:
 *   - Defaults to "Demo AI · 5 messages" mode.
 *   - Toggle reveals the input.
 *   - Invalid keys show an inline error and DO NOT open the confirm dialog.
 *   - Valid keys open the confirm dialog.
 *   - Confirm writes to localStorage['byokKey'] and collapses to status row.
 *   - Cancel does not write to localStorage.
 *   - Remove clears localStorage and returns to demo mode.
 *   - isValidAnthropicKey helper rejects garbage and accepts well-shaped keys.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  BYOKKeyInput,
  BYOK_STORAGE_KEY_NAME,
  isValidAnthropicKey,
} from '@/web-demo/BYOKKeyInput';

const VALID_KEY = 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INVALID_KEY = 'not-an-anthropic-key';

beforeEach(() => {
  localStorage.clear();
});

describe('isValidAnthropicKey', () => {
  it('accepts well-shaped Anthropic keys', () => {
    expect(isValidAnthropicKey(VALID_KEY)).toBe(true);
    expect(isValidAnthropicKey('sk-ant-' + 'a'.repeat(40))).toBe(true);
  });

  it('rejects keys without the sk-ant- prefix', () => {
    expect(isValidAnthropicKey(INVALID_KEY)).toBe(false);
    expect(isValidAnthropicKey('sk-' + 'a'.repeat(40))).toBe(false);
  });

  it('rejects empty / too-short values', () => {
    expect(isValidAnthropicKey('')).toBe(false);
    expect(isValidAnthropicKey('sk-ant-short')).toBe(false);
  });
});

describe('BYOKKeyInput', () => {
  it('defaults to "Demo AI · 5 messages" mode', () => {
    render(<BYOKKeyInput />);
    expect(screen.getByTestId('byok-status-demo')).toBeInTheDocument();
    expect(screen.queryByTestId('byok-key-field')).not.toBeInTheDocument();
  });

  it('toggle reveals the input', () => {
    render(<BYOKKeyInput />);
    fireEvent.click(screen.getByTestId('byok-toggle-button'));
    expect(screen.getByTestId('byok-key-field')).toBeInTheDocument();
  });

  it('shows an inline error and skips the confirm dialog for invalid keys', () => {
    render(<BYOKKeyInput />);
    fireEvent.click(screen.getByTestId('byok-toggle-button'));
    fireEvent.change(screen.getByTestId('byok-key-field'), {
      target: { value: INVALID_KEY },
    });
    fireEvent.click(screen.getByTestId('byok-save-button'));

    expect(screen.getByTestId('byok-error')).toBeInTheDocument();
    expect(screen.queryByTestId('byok-confirm-dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(BYOK_STORAGE_KEY_NAME)).toBeNull();
  });

  it('opens the confirm dialog for a valid key', () => {
    render(<BYOKKeyInput />);
    fireEvent.click(screen.getByTestId('byok-toggle-button'));
    fireEvent.change(screen.getByTestId('byok-key-field'), {
      target: { value: VALID_KEY },
    });
    fireEvent.click(screen.getByTestId('byok-save-button'));

    expect(screen.getByTestId('byok-confirm-dialog')).toBeInTheDocument();
    // Not yet stored.
    expect(localStorage.getItem(BYOK_STORAGE_KEY_NAME)).toBeNull();
  });

  it('confirming the dialog persists the key and collapses the input', () => {
    render(<BYOKKeyInput />);
    fireEvent.click(screen.getByTestId('byok-toggle-button'));
    fireEvent.change(screen.getByTestId('byok-key-field'), {
      target: { value: VALID_KEY },
    });
    fireEvent.click(screen.getByTestId('byok-save-button'));
    fireEvent.click(screen.getByTestId('byok-confirm-store'));

    expect(localStorage.getItem(BYOK_STORAGE_KEY_NAME)).toBe(VALID_KEY);
    expect(screen.getByTestId('byok-status-active')).toBeInTheDocument();
    expect(screen.queryByTestId('byok-key-field')).not.toBeInTheDocument();
  });

  it('cancel from the confirm dialog does not write the key', () => {
    render(<BYOKKeyInput />);
    fireEvent.click(screen.getByTestId('byok-toggle-button'));
    fireEvent.change(screen.getByTestId('byok-key-field'), {
      target: { value: VALID_KEY },
    });
    fireEvent.click(screen.getByTestId('byok-save-button'));
    fireEvent.click(screen.getByTestId('byok-confirm-cancel'));

    expect(localStorage.getItem(BYOK_STORAGE_KEY_NAME)).toBeNull();
    // Input still visible, ready for another attempt.
    expect(screen.getByTestId('byok-key-field')).toBeInTheDocument();
  });

  it('Remove clears localStorage and returns to demo mode', () => {
    localStorage.setItem(BYOK_STORAGE_KEY_NAME, VALID_KEY);
    render(<BYOKKeyInput />);

    expect(screen.getByTestId('byok-status-active')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('byok-remove-button'));

    expect(localStorage.getItem(BYOK_STORAGE_KEY_NAME)).toBeNull();
    expect(screen.getByTestId('byok-status-demo')).toBeInTheDocument();
  });
});
