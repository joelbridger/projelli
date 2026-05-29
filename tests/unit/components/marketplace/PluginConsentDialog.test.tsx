import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  PluginConsentDialog,
  usePluginConsentDialog,
} from '@/components/marketplace/PluginConsentDialog';
import type { PluginManifest, PluginPermission } from '@/types/plugin';

function makeManifest(
  permissions: PluginPermission[],
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id: 'word-counter',
    name: 'Word Counter',
    version: '1.0.0',
    apiVersion: '1',
    author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
    description: 'Counts words in your editor.',
    main: 'index.js',
    permissions,
    minKeepanceVersion: '2.0.0',
    category: 'utility',
    tags: ['editor'],
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('PluginConsentDialog (controlled)', () => {
  it('renders nothing when manifest is null', () => {
    render(
      <PluginConsentDialog
        open={true}
        manifest={null}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId('plugin-consent-dialog')).not.toBeInTheDocument();
  });

  it('shows the plugin name and author in the title', () => {
    const manifest = makeManifest(['workspace:read']);
    render(
      <PluginConsentDialog
        open={true}
        manifest={manifest}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    const title = screen.getByTestId('plugin-consent-dialog-title');
    expect(title).toHaveTextContent('Word Counter');
    expect(title).toHaveTextContent('Jameson Daines');
  });

  it('renders the requested permissions inside the body', () => {
    const manifest = makeManifest(['workspace:read', 'ai:invoke']);
    render(
      <PluginConsentDialog
        open={true}
        manifest={manifest}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId('plugin-permission-workspace:read'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('plugin-permission-ai:invoke'),
    ).toBeInTheDocument();
  });

  it('shows a Source line composed from author.githubUser + plugin id by default', () => {
    const manifest = makeManifest(['workspace:read']);
    render(
      <PluginConsentDialog
        open={true}
        manifest={manifest}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId('plugin-consent-dialog-source'),
    ).toHaveTextContent('github.com/jamesondaines/word-counter');
  });

  it('prefers manifest.homepage for the Source line when present', () => {
    const manifest = makeManifest(['workspace:read'], {
      homepage: 'https://github.com/keepance/word-counter',
    });
    render(
      <PluginConsentDialog
        open={true}
        manifest={manifest}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId('plugin-consent-dialog-source'),
    ).toHaveTextContent('github.com/keepance/word-counter');
  });

  it('Approve button fires onApprove', () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    render(
      <PluginConsentDialog
        open={true}
        manifest={makeManifest(['workspace:read'])}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('plugin-consent-dialog-approve'));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Cancel button fires onCancel', () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    render(
      <PluginConsentDialog
        open={true}
        manifest={makeManifest(['workspace:read'])}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('plugin-consent-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('snapshot: 3-permission dialog', () => {
    const manifest = makeManifest([
      'workspace:read',
      'editor:selection',
      'ai:invoke',
    ]);
    const { baseElement } = render(
      <PluginConsentDialog
        open={true}
        manifest={manifest}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(baseElement).toMatchSnapshot();
  });

  it('snapshot: 6-permission dialog', () => {
    const manifest = makeManifest([
      'workspace:read',
      'workspace:write',
      'editor:selection',
      'editor:write',
      'ai:invoke',
      'network',
    ]);
    const { baseElement } = render(
      <PluginConsentDialog
        open={true}
        manifest={manifest}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(baseElement).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// usePluginConsentDialog
// ---------------------------------------------------------------------------

interface HostHandle {
  confirm: ((m: PluginManifest) => Promise<boolean>) | null;
}

function HostComponent({ handle }: { handle: HostHandle }) {
  const { confirm, dialog } = usePluginConsentDialog();
  handle.confirm = confirm;
  return <div>{dialog}</div>;
}

describe('usePluginConsentDialog', () => {
  it('confirm() resolves true when user approves', async () => {
    const handle: HostHandle = { confirm: null };
    render(<HostComponent handle={handle} />);
    expect(handle.confirm).not.toBeNull();

    let resolved: boolean | null = null;
    await act(async () => {
      void handle.confirm!(makeManifest(['workspace:read'])).then((v) => {
        resolved = v;
      });
    });

    // Dialog should be visible
    expect(screen.getByTestId('plugin-consent-dialog')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-consent-dialog-approve'));
    });

    expect(resolved).toBe(true);
  });

  it('confirm() resolves false when user cancels', async () => {
    const handle: HostHandle = { confirm: null };
    render(<HostComponent handle={handle} />);

    let resolved: boolean | null = null;
    await act(async () => {
      void handle.confirm!(makeManifest(['workspace:read'])).then((v) => {
        resolved = v;
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-consent-dialog-cancel'));
    });

    expect(resolved).toBe(false);
  });

  it('overlapping confirm() calls cancel the prior one and open the new manifest', async () => {
    const handle: HostHandle = { confirm: null };
    render(<HostComponent handle={handle} />);

    let firstResolved: boolean | null = null;
    let secondResolved: boolean | null = null;

    await act(async () => {
      void handle.confirm!(makeManifest(['workspace:read'])).then((v) => {
        firstResolved = v;
      });
    });
    await act(async () => {
      void handle
        .confirm!(makeManifest(['network'], { name: 'Second Plugin' }))
        .then((v) => {
          secondResolved = v;
        });
    });

    expect(firstResolved).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-consent-dialog-approve'));
    });
    expect(secondResolved).toBe(true);
  });
});
