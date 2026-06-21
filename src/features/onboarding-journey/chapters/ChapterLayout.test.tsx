/// <reference types="@testing-library/jest-dom" />

/**
 * ChapterLayout tests
 *
 * Verifies: title rendered as h2, scene rendered, footer buttons present,
 * Continue disabled when continueDisabled=true, Back hidden when onBack omitted,
 * and accessibility: h2 is focused on mount for keyboard/screen-reader nav.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChapterLayout } from './ChapterLayout';

describe('ChapterLayout', () => {
  it('renders the title as an h2', () => {
    render(
      <ChapterLayout title="Test Title" onContinue={vi.fn()}>
        <p>body</p>
      </ChapterLayout>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Test Title' });
    expect(heading).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <ChapterLayout title="T" onContinue={vi.fn()}>
        <p data-testid="body-content">Hello</p>
      </ChapterLayout>,
    );
    expect(screen.getByTestId('body-content')).toBeInTheDocument();
  });

  it('renders the scene when provided', () => {
    render(
      <ChapterLayout
        title="T"
        scene={<div data-testid="scene-el" />}
        onContinue={vi.fn()}
      >
        <p>body</p>
      </ChapterLayout>,
    );
    expect(screen.getByTestId('scene-el')).toBeInTheDocument();
  });

  it('renders a Continue button with the default label', () => {
    render(
      <ChapterLayout title="T" onContinue={vi.fn()}>
        <p>body</p>
      </ChapterLayout>,
    );
    expect(screen.getByTestId('chapter-continue')).toHaveTextContent('Continue');
  });

  it('renders Continue with a custom label', () => {
    render(
      <ChapterLayout title="T" onContinue={vi.fn()} continueLabel="Start">
        <p>body</p>
      </ChapterLayout>,
    );
    expect(screen.getByTestId('chapter-continue')).toHaveTextContent('Start');
  });

  it('calls onContinue when Continue is clicked', () => {
    const onContinue = vi.fn();
    render(
      <ChapterLayout title="T" onContinue={onContinue}>
        <p>body</p>
      </ChapterLayout>,
    );
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('disables Continue when continueDisabled is true', () => {
    render(
      <ChapterLayout title="T" onContinue={vi.fn()} continueDisabled>
        <p>body</p>
      </ChapterLayout>,
    );
    expect(screen.getByTestId('chapter-continue')).toBeDisabled();
  });

  it('does NOT disable Continue by default', () => {
    render(
      <ChapterLayout title="T" onContinue={vi.fn()}>
        <p>body</p>
      </ChapterLayout>,
    );
    expect(screen.getByTestId('chapter-continue')).not.toBeDisabled();
  });

  it('hides the Back button when onBack is not provided', () => {
    render(
      <ChapterLayout title="T" onContinue={vi.fn()}>
        <p>body</p>
      </ChapterLayout>,
    );
    expect(screen.queryByTestId('chapter-back')).not.toBeInTheDocument();
  });

  it('shows the Back button when onBack is provided', () => {
    render(
      <ChapterLayout title="T" onContinue={vi.fn()} onBack={vi.fn()}>
        <p>body</p>
      </ChapterLayout>,
    );
    expect(screen.getByTestId('chapter-back')).toBeInTheDocument();
  });

  it('calls onBack when Back is clicked', () => {
    const onBack = vi.fn();
    render(
      <ChapterLayout title="T" onContinue={vi.fn()} onBack={onBack}>
        <p>body</p>
      </ChapterLayout>,
    );
    fireEvent.click(screen.getByTestId('chapter-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('ChapterLayout — accessibility', () => {
  it('focuses the h2 heading on mount so keyboard users land on the new chapter', () => {
    render(
      <ChapterLayout title="Accessibility Test" onContinue={vi.fn()}>
        <p>body</p>
      </ChapterLayout>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Accessibility Test' });
    expect(document.activeElement).toBe(heading);
  });

  it('the h2 has tabIndex=-1 so focus() works without showing in the tab order', () => {
    render(
      <ChapterLayout title="Tab Index" onContinue={vi.fn()}>
        <p>body</p>
      </ChapterLayout>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Tab Index' });
    expect(heading).toHaveAttribute('tabindex', '-1');
  });
});
