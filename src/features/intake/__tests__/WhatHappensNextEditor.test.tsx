import { useState, type JSX } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WhatHappensNextEditor } from '../WhatHappensNextEditor';
import { copyWelcomeJourney, DEFAULT_WELCOME_JOURNEY, type WelcomeJourney } from '../welcomeJourneyDefaults';

function inputValue(element: HTMLElement): string {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error('Expected an input element.');
  }
  return element.value;
}

function isCheckedInput(element: HTMLElement): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.checked;
}

describe('WhatHappensNextEditor', () => {
  it('updates editable welcome copy but never exposes the fixed privacy promise', () => {
    const onChange = vi.fn<(next: WelcomeJourney) => void>();
    render(<WhatHappensNextEditor value={DEFAULT_WELCOME_JOURNEY} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Welcome headline'), {
      target: { value: 'Hello, [client_first_name].' },
    });

    const changed = onChange.mock.calls[0]?.[0];
    if (!changed) throw new Error('Expected the welcome journey to change.');
    expect(changed.welcome.headline).toBe('Hello, [client_first_name].');
    expect(screen.queryByLabelText(/privacy/i)).toBeNull();
    expect(screen.getByText('The security explanation stays fixed so every client gets the same honest promise.')).toBeTruthy();
  });

  it('repairs an empty owner and keeps one timeline milestone visible before saving', () => {
    const onSaveDefault = vi.fn<(next: WelcomeJourney) => void>();
    function EditorHarness(): JSX.Element {
      const [journey, setJourney] = useState<WelcomeJourney>(() => copyWelcomeJourney());
      return <WhatHappensNextEditor value={journey} onChange={setJourney} onSaveDefault={onSaveDefault} />;
    }

    render(<EditorHarness />);
    fireEvent.change(screen.getByLabelText('welcome owner'), { target: { value: '' } });
    expect(inputValue(screen.getByLabelText('welcome owner'))).toBe('firm');

    for (let index = 0; index < DEFAULT_WELCOME_JOURNEY.timeline.length; index += 1) {
      const visible = screen.getAllByLabelText('Show this milestone').filter(isCheckedInput);
      const firstVisible = visible[0];
      if (!firstVisible) throw new Error('Expected a visible timeline milestone.');
      fireEvent.click(firstVisible);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save as firm default' }));
    const saved = onSaveDefault.mock.calls.at(-1)?.[0];
    if (!saved) throw new Error('Expected the firm default to be saved.');
    const visible = saved.timeline.filter((step) => step.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.owner).toBeTruthy();
  });
});
