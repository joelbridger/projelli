/// <reference types="@testing-library/jest-dom" />

/**
 * Ch8SeeItWork tests
 *
 * Ch8 is the final chapter. Its Continue button calls ctx.complete() (not
 * ctx.advance()). The sample toggle sets addSamples on both ctx.setData and
 * the button label. We do NOT write localStorage — the App does that on
 * onComplete.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';
import { ch8SeeItWork } from './Ch8SeeItWork';

// ---------------------------------------------------------------------------
// Helper: stub ChapterContext
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ch8SeeItWork — metadata', () => {
  it('has id "done"', () => {
    expect(ch8SeeItWork.id).toBe('done');
  });

  it('has title "Done"', () => {
    expect(ch8SeeItWork.title).toBe('Done');
  });
});

describe('ch8SeeItWork — initial render', () => {
  it('renders the chapter title "You\'re set"', () => {
    render(ch8SeeItWork.render(makeCtx()));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent("You're set");
  });

  it('renders the sample toggle', () => {
    render(ch8SeeItWork.render(makeCtx()));
    expect(screen.getByTestId('ch8-samples-toggle')).toBeInTheDocument();
  });

  it('renders the recap line', () => {
    render(ch8SeeItWork.render(makeCtx()));
    expect(screen.getByText(/Your files stay on your computer/i)).toBeInTheDocument();
  });

  it('renders Back and Continue buttons', () => {
    render(ch8SeeItWork.render(makeCtx()));
    expect(screen.getByTestId('chapter-back')).toBeInTheDocument();
    expect(screen.getByTestId('chapter-continue')).toBeInTheDocument();
  });
});

describe('ch8SeeItWork — sample toggle', () => {
  it('toggle defaults to checked (addSamples true)', () => {
    render(ch8SeeItWork.render(makeCtx()));
    const toggle = screen.getByTestId('ch8-samples-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('shows "Open the sample case" when addSamples is true (default)', () => {
    render(ch8SeeItWork.render(makeCtx()));
    expect(screen.getByTestId('chapter-continue')).toHaveTextContent('Open the sample case');
  });

  it('unchecking the toggle changes the button label to "Create my first matter"', () => {
    render(ch8SeeItWork.render(makeCtx()));
    const toggle = screen.getByTestId('ch8-samples-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('chapter-continue')).toHaveTextContent('Create my first matter');
  });

  it('unchecking calls ctx.setData({ addSamples: false })', () => {
    const ctx = makeCtx();
    render(ch8SeeItWork.render(ctx));
    fireEvent.click(screen.getByTestId('ch8-samples-toggle'));
    expect(ctx.setData).toHaveBeenCalledWith({ addSamples: false });
  });

  it('rechecking the toggle restores "Open the sample case" label', () => {
    render(ch8SeeItWork.render(makeCtx()));
    const toggle = screen.getByTestId('ch8-samples-toggle');
    fireEvent.click(toggle); // uncheck
    fireEvent.click(toggle); // recheck
    expect(screen.getByTestId('chapter-continue')).toHaveTextContent('Open the sample case');
  });

  it('respects ctx.data.addSamples=false as the initial state', () => {
    render(ch8SeeItWork.render(makeCtx({ addSamples: false })));
    const toggle = screen.getByTestId('ch8-samples-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('chapter-continue')).toHaveTextContent('Create my first matter');
  });
});

describe('ch8SeeItWork — final button calls ctx.complete()', () => {
  it('Continue calls ctx.complete() (not ctx.advance())', () => {
    const ctx = makeCtx();
    render(ch8SeeItWork.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(ctx.complete).toHaveBeenCalledOnce();
    expect(ctx.advance).not.toHaveBeenCalled();
  });

  it('Continue also calls ctx.setData({ addSamples }) with the current toggle state', () => {
    const ctx = makeCtx();
    render(ch8SeeItWork.render(ctx));
    // Default is true; click Continue right away
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(ctx.setData).toHaveBeenCalledWith({ addSamples: true });
  });

  it('does NOT write to localStorage', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const ctx = makeCtx();
    render(ch8SeeItWork.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});

describe('ch8SeeItWork — Back navigation', () => {
  it('Back calls ctx.goBack()', () => {
    const ctx = makeCtx();
    render(ch8SeeItWork.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-back'));
    expect(ctx.goBack).toHaveBeenCalledOnce();
  });
});
