/**
 * Task 1.2 — Recording an explicit confidentiality choice.
 *
 * When the user picks a confidentiality mode, the app must write TWO values
 * into the settings store:
 *   1. The chosen mode under CONFIDENTIALITY_MODE_SETTING_KEY.
 *   2. `true` under CONFIDENTIALITY_CHOICE_MADE_KEY, so the resolver knows
 *      the user made a real, informed decision and cloud generation is allowed
 *      (if the chosen mode permits it).
 *
 * This keeps the "no cloud until chosen" invariant: personal installs that have
 * never been through the choice screen stay blocked even if a mode value exists.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { CONFIDENTIALITY_CHOICE_MADE_KEY } from '@/platform/privacy/resolvePersonalEgressDefault';
import { useRecordConfidentialityChoice } from '@/platform/hooks/useConfidentialityMode';

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
});

describe('useRecordConfidentialityChoice', () => {
  it('writes the chosen mode AND the choice-made marker when the user picks "direct"', () => {
    const { result } = renderHook(() => useRecordConfidentialityChoice());
    act(() => {
      result.current('direct');
    });
    const state = useSettingsStore.getState();
    expect(state.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).toBe('direct');
    expect(state.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY)).toBe(true);
  });

  it('writes the chosen mode AND the choice-made marker when the user picks "local-only"', () => {
    const { result } = renderHook(() => useRecordConfidentialityChoice());
    act(() => {
      result.current('local-only');
    });
    const state = useSettingsStore.getState();
    expect(state.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).toBe('local-only');
    expect(state.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY)).toBe(true);
  });

  it('writes the chosen mode AND the choice-made marker when the user picks "assured"', () => {
    const { result } = renderHook(() => useRecordConfidentialityChoice());
    act(() => {
      result.current('assured');
    });
    const state = useSettingsStore.getState();
    expect(state.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).toBe('assured');
    expect(state.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY)).toBe(true);
  });

  it('always sets the choice-made marker, even if the mode was already set', () => {
    // Pre-set the mode to simulate an install that had a mode but never went
    // through the informed-choice screen.
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    // choice-made marker resolves to the schema default (false) when not explicitly set.
    expect(useSettingsStore.getState().getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY)).toBe(false);

    const { result } = renderHook(() => useRecordConfidentialityChoice());
    act(() => {
      result.current('direct');
    });
    expect(useSettingsStore.getState().getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY)).toBe(true);
  });
});
