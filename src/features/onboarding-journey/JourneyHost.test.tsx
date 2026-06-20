/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JourneyHost } from './JourneyHost';
import type { Chapter, ChapterContext } from './engine/types';

// ---------------------------------------------------------------------------
// Stub chapters — minimal, defined inline so this file is self-contained
// ---------------------------------------------------------------------------
function makeChapter(id: string, title: string): Chapter {
  return {
    id,
    title,
    render: (ctx: ChapterContext) => (
      <div data-testid={`chapter-${id}`}>
        <p>{title}</p>
        <button onClick={ctx.advance}>Next</button>
        <button onClick={ctx.goBack}>Back</button>
        <button onClick={ctx.complete}>Finish</button>
      </div>
    ),
  };
}

const ch1 = makeChapter('ch1', 'Welcome');
const ch2 = makeChapter('ch2', 'Your Profile');
const ch3 = makeChapter('ch3', 'All Set');

const THREE = [ch1, ch2, ch3];

const stubActions = {
  saveApiKey: vi.fn().mockResolvedValue(undefined),
  setConfidentialityMode: vi.fn(),
  chooseWorkspaceFolder: vi.fn().mockResolvedValue('/tmp/ws'),
};

function renderHost(chapters = THREE, onComplete = vi.fn(), onExit = vi.fn()) {
  render(
    <JourneyHost
      chapters={chapters}
      reducedMotion={true}
      onComplete={onComplete}
      onExit={onExit}
      actions={stubActions}
    />,
  );
  return { onComplete, onExit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('JourneyHost – renders', () => {
  it('renders the first chapter on mount', () => {
    renderHost();
    expect(screen.getByTestId('chapter-ch1')).toBeInTheDocument();
  });

  it('shows the chapter title in the progress strip', () => {
    renderHost();
    // The live region in the progress strip shows the current chapter title
    expect(screen.getByText('Welcome', { selector: '[aria-live]' })).toBeInTheDocument();
  });

  it('renders one progress marker per chapter', () => {
    renderHost();
    // Each step has aria-current="step" or none; all markers are rendered
    const markers = screen.getAllByTitle(/Welcome|Your Profile|All Set/);
    expect(markers).toHaveLength(3);
  });

  it('marks the first step with aria-current="step"', () => {
    renderHost();
    const currentMarker = screen.getByTitle('Welcome');
    expect(currentMarker).toHaveAttribute('aria-current', 'step');
  });
});

describe('JourneyHost – navigation', () => {
  it('advances to the next chapter when the chapter calls ctx.advance', () => {
    renderHost();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByTestId('chapter-ch2')).toBeInTheDocument();
  });

  it('shows the updated chapter title after advancing', () => {
    renderHost();
    fireEvent.click(screen.getByText('Next'));
    // The live region in the progress strip should now show "Your Profile"
    expect(screen.getByText('Your Profile', { selector: '[aria-live]' })).toBeInTheDocument();
  });
});

describe('JourneyHost – skip setup', () => {
  it('shows a "Skip setup" button persistently', () => {
    renderHost();
    expect(screen.getByRole('button', { name: /skip setup/i })).toBeInTheDocument();
  });

  it('opens a confirm dialog when "Skip setup" is clicked', () => {
    renderHost();
    fireEvent.click(screen.getByRole('button', { name: /skip setup/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('calls onExit when the user confirms skip', () => {
    const { onExit } = renderHost();
    fireEvent.click(screen.getByRole('button', { name: /skip setup/i }));
    // The confirm button in the dialog
    fireEvent.click(screen.getByRole('button', { name: /^Skip setup$/i }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('does NOT call onExit when the user cancels skip', () => {
    const { onExit } = renderHost();
    fireEvent.click(screen.getByRole('button', { name: /skip setup/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue setup/i }));
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('JourneyHost – complete', () => {
  it('calls onComplete when the chapter calls ctx.complete', () => {
    const { onComplete } = renderHost();
    fireEvent.click(screen.getByText('Finish'));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

describe('JourneyHost – progress strip aria', () => {
  it('announces the current chapter name via aria-live region', () => {
    renderHost();
    // The live region shows the current chapter title
    const liveRegion = screen.getByText('Welcome', { selector: '[aria-live]' });
    expect(liveRegion).toBeInTheDocument();
  });
});
