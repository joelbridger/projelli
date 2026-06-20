/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { House } from './House';
import { Papers } from './Papers';
import { Lock } from './Lock';
import { Brain } from './Brain';
import { Cloud } from './Cloud';
import { PaperPlane } from './PaperPlane';
import { KeyShape } from './KeyShape';
import { ReceiptTag } from './ReceiptTag';
import { FilingCabinet } from './FilingCabinet';
import { SceneFrame } from './SceneFrame';
import { motionClass } from './reducedMotion';

// ---------------------------------------------------------------------------
// motionClass helper
// ---------------------------------------------------------------------------
describe('motionClass', () => {
  it('returns the animated class when reducedMotion is false', () => {
    expect(motionClass(false, 'scene-pop')).toBe('scene-pop');
  });

  it('returns empty string when reducedMotion is true', () => {
    expect(motionClass(true, 'scene-pop')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// SceneFrame
// ---------------------------------------------------------------------------
describe('SceneFrame', () => {
  it('renders with role="img" and the given aria-label', () => {
    render(<SceneFrame label="Your computer, a private space"><span>child</span></SceneFrame>);
    const frame = screen.getByRole('img', { name: 'Your computer, a private space' });
    expect(frame).toBeInTheDocument();
  });

  it('marks inner content aria-hidden', () => {
    const { container } = render(
      <SceneFrame label="A scene"><span data-testid="inner">inner</span></SceneFrame>,
    );
    // The inner wrapper div should be aria-hidden
    const inner = container.querySelector('[aria-hidden="true"]');
    expect(inner).toBeInTheDocument();
  });

  it('accepts an optional className', () => {
    const { container } = render(<SceneFrame label="Test" className="my-class"><span /></SceneFrame>);
    expect(container.firstElementChild).toHaveClass('my-class');
  });
});

// ---------------------------------------------------------------------------
// Shape components — shared contract checks
// ---------------------------------------------------------------------------
type ShapeComponent = (props: { reducedMotion?: boolean; className?: string; size?: number }) => React.JSX.Element | null;

const shapes: Array<{ name: string; Component: ShapeComponent }> = [
  { name: 'House', Component: House },
  { name: 'Papers', Component: Papers },
  { name: 'Lock', Component: Lock },
  { name: 'Brain', Component: Brain },
  { name: 'Cloud', Component: Cloud },
  { name: 'PaperPlane', Component: PaperPlane },
  { name: 'KeyShape', Component: KeyShape },
  { name: 'ReceiptTag', Component: ReceiptTag },
  { name: 'FilingCabinet', Component: FilingCabinet },
];

describe('Shape components — renders without crashing', () => {
  for (const { name, Component } of shapes) {
    it(`${name} renders`, () => {
      const { container } = render(<Component />);
      expect(container.firstElementChild).toBeInTheDocument();
    });
  }
});

describe('Shape components — aria-hidden (decorative by default)', () => {
  for (const { name, Component } of shapes) {
    it(`${name} root is aria-hidden`, () => {
      const { container } = render(<Component />);
      expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    });
  }
});

describe('Shape components — animation class behavior', () => {
  for (const { name, Component } of shapes) {
    it(`${name} includes an animation class when reducedMotion=false`, () => {
      const { container } = render(<Component reducedMotion={false} />);
      // At least one element in the tree should have a scene- animation class
      const animated = container.querySelector('[class*="scene-"]');
      expect(animated).toBeInTheDocument();
    });

    it(`${name} has NO scene- animation classes when reducedMotion=true`, () => {
      const { container } = render(<Component reducedMotion={true} />);
      const animated = container.querySelector('[class*="scene-"]');
      expect(animated).not.toBeInTheDocument();
    });
  }
});

describe('Shape components — className prop forwarded', () => {
  for (const { name, Component } of shapes) {
    it(`${name} accepts and applies className`, () => {
      const { container } = render(<Component className="test-class" />);
      expect(container.firstElementChild).toHaveClass('test-class');
    });
  }
});
