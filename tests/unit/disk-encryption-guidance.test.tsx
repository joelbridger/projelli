/**
 * VG-6d-v1 — unmissable disk-encryption guidance.
 *
 * Until the encrypted workspace vault ships, workspace document files rely on
 * the OS's full-disk encryption. These tests pin the two surfaces that make
 * that unmissable:
 *
 *   1. DiskEncryptionGuidance renders the callout with the detected
 *      platform's "here is how to check it is on" line (BitLocker /
 *      FileVault / LUKS).
 *   2. The first-run wizard's data step mounts the guidance.
 *   3. The Data Map gains a row saying document files rely on disk
 *      encryption, and that row renders through the expanded printable
 *      region (the print / save-PDF path) with the print-contract
 *      structure (.row > h2 title, p body).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

// Keep the AI step's local-path detection deterministic; these tests never
// drive past the data step.
vi.mock('@/modules/models/OllamaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/models/OllamaProvider')>();
  return { ...actual, detectOllama: vi.fn(async () => ({ reachable: false, models: [] })) };
});

import {
  DiskEncryptionGuidance,
  detectDesktopPlatform,
} from '@/features/onboarding/DiskEncryptionGuidance';
import { FirstRunWizard } from '@/features/onboarding/FirstRunWizard';
import { DataMapContent, DATA_MAP_ROWS } from '@/components/privacy/DataMapDialog';

const UA = {
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
  macos:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)',
} as const;

function stubUserAgent(ua: string) {
  vi.stubGlobal('navigator', { userAgent: ua });
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('detectDesktopPlatform', () => {
  it('detects macOS, Linux, and defaults to Windows', () => {
    stubUserAgent(UA.macos);
    expect(detectDesktopPlatform()).toBe('macos');

    stubUserAgent(UA.linux);
    expect(detectDesktopPlatform()).toBe('linux');

    stubUserAgent(UA.windows);
    expect(detectDesktopPlatform()).toBe('windows');

    // Unknown UA falls back to Windows (the most common desktop).
    stubUserAgent('');
    expect(detectDesktopPlatform()).toBe('windows');
  });
});

describe('DiskEncryptionGuidance', () => {
  it('renders the title and the Windows (BitLocker) check line on Windows', () => {
    stubUserAgent(UA.windows);
    render(<DiskEncryptionGuidance />);

    expect(screen.getByTestId('disk-encryption-guidance')).toBeInTheDocument();
    expect(
      screen.getByText('One thing to check: your disk encryption'),
    ).toBeInTheDocument();
    const check = screen.getByTestId('disk-encryption-check-windows');
    expect(check.textContent).toContain('BitLocker');
    expect(check.textContent).toContain('Device encryption');
  });

  it('renders the macOS (FileVault) check line on a Mac', () => {
    stubUserAgent(UA.macos);
    render(<DiskEncryptionGuidance />);

    const check = screen.getByTestId('disk-encryption-check-macos');
    expect(check.textContent).toContain('FileVault');
    expect(screen.queryByTestId('disk-encryption-check-windows')).toBeNull();
  });

  it('renders the Linux (LUKS) check line on Linux', () => {
    stubUserAgent(UA.linux);
    render(<DiskEncryptionGuidance />);

    const check = screen.getByTestId('disk-encryption-check-linux');
    expect(check.textContent).toContain('LUKS');
    expect(check.textContent).toContain('lsblk');
  });

  it('explains plainly that files rely on the OS full-disk encryption', () => {
    stubUserAgent(UA.windows);
    render(<DiskEncryptionGuidance />);
    expect(
      screen.getByText(/full-disk encryption is what protects them/i),
    ).toBeInTheDocument();
  });
});

describe('FirstRunWizard data step mounts the guidance', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows DiskEncryptionGuidance inside the data step body', () => {
    render(<FirstRunWizard onComplete={vi.fn()} onSkip={vi.fn()} />);

    // welcome -> profession -> workspace -> data
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    fireEvent.click(screen.getByTestId('profession-card-legal'));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    const dataStep = screen.getByTestId('onboarding-data-step');
    expect(dataStep).toBeInTheDocument();
    const guidance = screen.getByTestId('disk-encryption-guidance');
    expect(dataStep.contains(guidance)).toBe(true);
  });
});

describe('Data Map disk-encryption row', () => {
  it('DATA_MAP_ROWS includes the disk-encryption row with per-OS checks', () => {
    const row = DATA_MAP_ROWS.find(
      (r) => r.title === 'Document files rely on your disk encryption',
    );
    expect(row).toBeDefined();
    expect(row!.body).toContain('BitLocker on Windows');
    expect(row!.body).toContain('FileVault on macOS');
    expect(row!.body).toContain('LUKS on Linux');
    expect(row!.caveat).toContain('How to check');
    expect(row!.caveat).toContain('Device encryption');
  });

  it('renders through the expanded printable region with the print-contract structure', () => {
    // The print / save-PDF path deep-clones #keepance-data-map-printable
    // (the expanded variant) and styles `.row h2` / `.row p` / `.caveat`.
    // Verify the new row is inside that region with that exact structure.
    render(<DataMapContent printableId="keepance-data-map-printable" />);

    const printable = document.getElementById('keepance-data-map-printable');
    expect(printable).not.toBeNull();

    // Every row in the register renders into the printable region.
    const sections = printable!.querySelectorAll('[data-testid="data-map-section"]');
    expect(sections.length).toBe(DATA_MAP_ROWS.length);

    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Document files rely on your disk encryption',
    });
    const rowEl = heading.closest('.row');
    expect(rowEl).not.toBeNull();
    expect(printable!.contains(rowEl)).toBe(true);

    // Body is a <p> (print CSS `.row p`), caveat carries the `.caveat` class.
    const body = Array.from(rowEl!.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('BitLocker on Windows'),
    );
    expect(body).toBeDefined();
    const caveat = rowEl!.querySelector('p.caveat');
    expect(caveat?.textContent).toContain('How to check');
  });
});
