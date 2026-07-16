import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationsBellConsumerFixture } from './fixtures/notificationsBellConsumer';

describe('notification-bell public consumer contract', () => {
  it('compiles and renders a typed descriptor through the public v1-frame package', () => {
    render(<NotificationsBellConsumerFixture />);

    expect(
      screen.getByRole('button', { name: 'Open fixture notifications' })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('v1-shell-notification-slot')).toBeNull();
  });
});
