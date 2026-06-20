/// <reference types="@testing-library/jest-dom" />

/**
 * Ch2AboutYou tests
 *
 * Key behaviors:
 * - Continue is gated: requires profession AND non-empty displayName
 * - Selecting a profession calls ctx.setData({ profession })
 * - Typing a name calls ctx.setData({ displayName })
 * - Both missing -> disabled; only profession -> disabled; only name -> disabled
 * - Both set -> enabled; clicking Continue calls ctx.advance
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';
import { ch2AboutYou } from './Ch2AboutYou';

function makeCtx(data: JourneyData = {}): ChapterContext {
  return {
    advance: vi.fn(),
    goBack: vi.fn(),
    skipAll: vi.fn(),
    complete: vi.fn(),
    setData: vi.fn(),
    data,
    reducedMotion: true,
    actions: {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      setConfidentialityMode: vi.fn(),
      chooseWorkspaceFolder: vi.fn().mockResolvedValue('/tmp/ws'),
    },
  };
}

describe('ch2AboutYou — metadata', () => {
  it('has id "about-you"', () => {
    expect(ch2AboutYou.id).toBe('about-you');
  });

  it('has title "About you"', () => {
    expect(ch2AboutYou.title).toBe('About you');
  });
});

describe('ch2AboutYou — canAdvance gate', () => {
  it('returns false when data is empty', () => {
    expect(ch2AboutYou.canAdvance?.({})).toBe(false);
  });

  it('returns false when only profession is set', () => {
    expect(ch2AboutYou.canAdvance?.({ profession: 'legal' })).toBe(false);
  });

  it('returns false when only displayName is set', () => {
    expect(ch2AboutYou.canAdvance?.({ displayName: 'Alice' })).toBe(false);
  });

  it('returns false when displayName is whitespace only', () => {
    expect(ch2AboutYou.canAdvance?.({ profession: 'legal', displayName: '   ' })).toBe(false);
  });

  it('returns true when both profession and displayName are set', () => {
    expect(ch2AboutYou.canAdvance?.({ profession: 'legal', displayName: 'Alice' })).toBe(true);
  });
});

describe('ch2AboutYou — render & interaction', () => {
  it('renders the title', () => {
    render(ch2AboutYou.render(makeCtx()));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('A bit about you');
  });

  it('renders profession cards', () => {
    render(ch2AboutYou.render(makeCtx()));
    expect(screen.getByText('Legal practice')).toBeInTheDocument();
    expect(screen.getByText('Tax and accounting')).toBeInTheDocument();
    expect(screen.getByText('Something else')).toBeInTheDocument();
  });

  it('renders the name input', () => {
    render(ch2AboutYou.render(makeCtx()));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('Continue is disabled when profession and name are both missing', () => {
    render(ch2AboutYou.render(makeCtx()));
    expect(screen.getByTestId('chapter-continue')).toBeDisabled();
  });

  it('clicking a profession card calls setData with that profession', () => {
    const ctx = makeCtx();
    render(ch2AboutYou.render(ctx));
    fireEvent.click(screen.getByText('Legal practice'));
    expect(ctx.setData).toHaveBeenCalledWith({ profession: 'legal' });
  });

  it('typing a name calls setData with displayName', () => {
    const ctx = makeCtx();
    render(ch2AboutYou.render(ctx));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Alice' } });
    expect(ctx.setData).toHaveBeenCalledWith({ displayName: 'Alice' });
  });

  it('Continue is enabled when profession and name are pre-set in data', () => {
    const ctx = makeCtx({ profession: 'legal', displayName: 'Alice' });
    render(ch2AboutYou.render(ctx));
    expect(screen.getByTestId('chapter-continue')).not.toBeDisabled();
  });

  it('clicking Continue when gate passes calls ctx.advance', () => {
    const ctx = makeCtx({ profession: 'legal', displayName: 'Alice' });
    render(ch2AboutYou.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(ctx.advance).toHaveBeenCalledOnce();
  });

  it('clicking Back calls ctx.goBack', () => {
    const ctx = makeCtx();
    render(ch2AboutYou.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-back'));
    expect(ctx.goBack).toHaveBeenCalledOnce();
  });
});
