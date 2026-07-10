import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WhatHappensNextEditor } from '../WhatHappensNextEditor';
import { DEFAULT_WELCOME_JOURNEY } from '../welcomeJourneyDefaults';

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
});
