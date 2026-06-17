/**
 * LanguagePicker — covers Group VI Task 6.7:
 *   - renders the three supported language options;
 *   - clicking a different option calls i18n.changeLanguage, persists via
 *     setLanguage, and emits a `language_changed` audit event.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { LanguagePicker } from '@/features/settings/LanguagePicker';
import { useSettingsStore } from '@/stores/settingsStore';
import { AuditService } from '@/modules/audit/AuditService';
import i18n from '@/i18n';

describe('LanguagePicker', () => {
  let audit: AuditService;
  let appendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Reset language to a known baseline before each test.
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    useSettingsStore.setState({ language: null });
    audit = new AuditService('test-language-picker');
    appendSpy = vi.spyOn(audit, 'append');
  });

  afterEach(() => {
    cleanup();
    appendSpy.mockRestore();
    try {
      localStorage.removeItem('audit_log_test-language-picker');
    } catch {
      // ignore
    }
  });

  it('renders the three supported language options with native labels', () => {
    render(<LanguagePicker auditService={audit} />);

    const select = screen.getByTestId('language-picker-select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();

    const options = Array.from(select.querySelectorAll('option')).map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
    expect(options).toEqual([
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Español' },
      { value: 'de', label: 'Deutsch' },
    ]);
  });

  it('defaults to the current i18n language', async () => {
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    render(<LanguagePicker auditService={audit} />);
    const select = screen.getByTestId('language-picker-select') as HTMLSelectElement;
    expect(select.value).toBe('es');
  });

  it('changing the language calls i18n.changeLanguage, persists, and audits', async () => {
    render(<LanguagePicker auditService={audit} />);
    const select = screen.getByTestId('language-picker-select') as HTMLSelectElement;

    expect(i18n.language).toBe('en');
    expect(useSettingsStore.getState().language).toBeNull();

    await act(async () => {
      fireEvent.change(select, { target: { value: 'de' } });
      // allow the async handler to resolve
      await Promise.resolve();
    });

    expect(i18n.language).toBe('de');
    expect(useSettingsStore.getState().language).toBe('de');
    expect(appendSpy).toHaveBeenCalledTimes(1);

    const event = appendSpy.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'language_changed',
      payload: { from: 'en', to: 'de' },
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe('string');
  });

  it('does not emit an audit event when selecting the already-active language', async () => {
    render(<LanguagePicker auditService={audit} />);
    const select = screen.getByTestId('language-picker-select') as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: 'en' } });
      await Promise.resolve();
    });

    expect(appendSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().language).toBeNull();
  });
});
