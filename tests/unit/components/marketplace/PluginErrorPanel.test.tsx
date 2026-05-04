import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from '@testing-library/react';
import { PluginErrorPanel } from '@/components/marketplace/PluginErrorPanel';
import { setActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import { usePluginManagerStore } from '@/stores/pluginManagerStore';
import { AuditService } from '@/modules/audit/AuditService';

interface MockManager {
  enable: Mock;
  disable: Mock;
  restart: Mock;
  uninstall: Mock;
  installFromTarball: Mock;
  listInstalled: Mock;
}

function makeManager(overrides: Partial<MockManager> = {}): MockManager {
  return {
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    installFromTarball: vi.fn(async () => {}),
    listInstalled: vi.fn(() => []),
    ...overrides,
  };
}

function setError(pluginId: string, message: string | null): void {
  usePluginManagerStore.getState().setError(pluginId, message);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePluginManagerStore.setState({
    installedPlugins: [],
    statusByPluginId: {},
    errorsByPluginId: {},
  });
  setActivePluginManager(null);
});

afterEach(() => {
  cleanup();
  setActivePluginManager(null);
});

describe('PluginErrorPanel - error rendering', () => {
  it('renders the error message from the store', () => {
    setError('word-counter', 'TypeError: cannot read property of undefined');
    render(<PluginErrorPanel pluginId="word-counter" />);
    expect(
      screen.getByTestId('plugin-error-message-word-counter'),
    ).toHaveTextContent('TypeError: cannot read property of undefined');
  });

  it('renders a generic fallback when no error in the store', () => {
    render(<PluginErrorPanel pluginId="word-counter" />);
    expect(
      screen.getByTestId('plugin-error-message-word-counter'),
    ).toHaveTextContent(/crashed/i);
  });
});

describe('PluginErrorPanel - audit log filter', () => {
  it('shows only audit entries matching the pluginId', () => {
    const audit = new AuditService('plugin-error-test');
    audit.log('user_action', 'plugin event A', {
      metadata: { id: 'word-counter' },
    });
    audit.log('user_action', 'unrelated plugin', {
      metadata: { id: 'other-plugin' },
    });
    audit.log('user_action', 'plugin event B', {
      metadata: { pluginId: 'word-counter' },
    });
    audit.log('user_action', 'unrelated event with no plugin', {});

    setError('word-counter', 'crashed');
    render(
      <PluginErrorPanel pluginId="word-counter" auditService={audit} />,
    );

    const log = screen.getByTestId('plugin-error-log-list-word-counter');
    expect(log.textContent).toContain('plugin event A');
    expect(log.textContent).toContain('plugin event B');
    expect(log.textContent).not.toContain('unrelated plugin');
    expect(log.textContent).not.toContain('unrelated event with no plugin');
  });

  it('caps log to 50 entries', () => {
    const audit = new AuditService('plugin-error-cap-test');
    for (let i = 0; i < 75; i += 1) {
      audit.log('user_action', `event-${i.toString()}`, {
        metadata: { id: 'word-counter' },
      });
    }
    render(
      <PluginErrorPanel pluginId="word-counter" auditService={audit} />,
    );
    const entries = screen.getAllByTestId(/^plugin-error-log-entry-/);
    expect(entries.length).toBeLessThanOrEqual(50);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('hides the log section entirely when no matching entries exist', () => {
    const audit = new AuditService('plugin-error-empty-test');
    render(
      <PluginErrorPanel pluginId="word-counter" auditService={audit} />,
    );
    expect(
      screen.queryByTestId('plugin-error-log-word-counter'),
    ).not.toBeInTheDocument();
  });
});

describe('PluginErrorPanel - actions', () => {
  it('Restart click calls manager.restart', async () => {
    setError('word-counter', 'crashed');
    const manager = makeManager();
    setActivePluginManager(manager as never);
    render(<PluginErrorPanel pluginId="word-counter" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-error-restart-word-counter'));
    });
    expect(manager.restart).toHaveBeenCalledWith('word-counter');
  });

  it('Disable click calls manager.disable', async () => {
    setError('word-counter', 'crashed');
    const manager = makeManager();
    setActivePluginManager(manager as never);
    render(<PluginErrorPanel pluginId="word-counter" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-error-disable-word-counter'));
    });
    expect(manager.disable).toHaveBeenCalledWith('word-counter');
  });

  it('Restart failure surfaces an inline error message', async () => {
    setError('word-counter', 'crashed');
    const manager = makeManager({
      restart: vi.fn(async () => {
        throw new Error('worker spawn failed');
      }),
    });
    setActivePluginManager(manager as never);
    render(<PluginErrorPanel pluginId="word-counter" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-error-restart-word-counter'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-error-action-error-word-counter'),
      ).toHaveTextContent('worker spawn failed'),
    );
  });

  it('does nothing when no manager is set', async () => {
    setError('word-counter', 'crashed');
    render(<PluginErrorPanel pluginId="word-counter" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-error-restart-word-counter'));
    });
    // Just verify nothing throws and the panel still renders.
    expect(
      screen.getByTestId('plugin-error-panel-word-counter'),
    ).toBeInTheDocument();
  });
});
