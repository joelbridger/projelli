import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WhatHappensNextEditor } from '../WhatHappensNextEditor';
import { copyWelcomeJourney, DEFAULT_WELCOME_JOURNEY, type WelcomeJourney } from '../welcomeJourneyDefaults';

describe('WhatHappensNextEditor', () => {
  it('updates editable welcome copy but never exposes the fixed privacy promise', () => {
    const onChange = vi.fn();
    render(<WhatHappensNextEditor value={DEFAULT_WELCOME_JOURNEY} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Welcome headline'), {
      target: { value: 'Hello, [client_first_name].' },
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      welcome: expect.objectContaining({ headline: 'Hello, [client_first_name].' }),
    }));
    expect(screen.queryByLabelText(/privacy/i)).toBeNull();
    expect(screen.getByText('The security explanation stays fixed so every client gets the same honest promise.')).toBeTruthy();
  });

  it('repairs an empty owner and keeps one timeline milestone visible before saving', () => {
    const onSaveDefault = vi.fn();
    function EditorHarness(): JSX.Element {
      const [journey, setJourney] = useState<WelcomeJourney>(() => copyWelcomeJourney());
      return <WhatHappensNextEditor value={journey} onChange={setJourney} onSaveDefault={onSaveDefault} />;
    }

    render(<EditorHarness />);
    fireEvent.change(screen.getByLabelText('welcome owner'), { target: { value: '' } });
    expect((screen.getByLabelText('welcome owner') as HTMLInputElement).value).toBe('firm');

    for (let index = 0; index < DEFAULT_WELCOME_JOURNEY.timeline.length; index += 1) {
      const visible = screen.getAllByLabelText('Show this milestone').filter((input) => (input as HTMLInputElement).checked);
      fireEvent.click(visible[0]!);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save as firm default' }));
    const saved = onSaveDefault.mock.calls.at(-1)?.[0] as WelcomeJourney;
    const visible = saved.timeline.filter((step) => step.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.owner).toBeTruthy();
  });
});
