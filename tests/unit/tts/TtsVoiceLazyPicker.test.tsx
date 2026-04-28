/**
 * Task 18 — TtsVoiceLazyPicker
 *
 * Voice picker with lazy-download support for non-English voices.
 * When the user selects Spanish or German, and the voice isn't yet
 * downloaded, the component initiates a download via TTSService.downloadVoice().
 *
 * Covers:
 *   - Renders a voice <select> with all catalog entries
 *   - Shows the currently-selected voice
 *   - On selecting a bundled voice, no download is triggered
 *   - On selecting a non-bundled voice, download is triggered
 *   - Shows a "Downloading…" indicator while download is in progress
 *   - Shows a download error when the download fails
 *   - Reverts to bundled English voice on download failure
 *   - data-testid="tts-voice-picker" present
 *   - data-testid="tts-download-error" present when error exists
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TtsVoiceLazyPicker } from '@/components/tts/TtsVoiceLazyPicker';

// Mock Tauri invoke so downloads can be simulated.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

// Mock TTSService to control downloadVoice() and isVoiceDownloaded().
vi.mock('@/modules/tts/TTSService', () => ({
  TTSService: {
    downloadVoice: vi.fn(),
    isVoiceDownloaded: vi.fn((id: string) => id === 'en_US-amy-medium'),
    listVoices: vi.fn(() => [
      { id: 'en_US-amy-medium', name: 'English (Amy, medium)', language: 'en', bundled: true },
      { id: 'es_ES-mls-medium', name: 'Spanish (MLS, medium)', language: 'es', bundled: false },
      { id: 'de_DE-thorsten-medium', name: 'German (Thorsten, medium)', language: 'de', bundled: false },
    ]),
    isAvailable: vi.fn().mockResolvedValue(true),
    _resetCache: vi.fn(),
  },
}));

import * as ttsModule from '@/modules/tts/TTSService';
const mockDownloadVoice = vi.mocked(ttsModule.TTSService.downloadVoice);
const mockIsVoiceDownloaded = vi.mocked(ttsModule.TTSService.isVoiceDownloaded);

describe('TtsVoiceLazyPicker', () => {
  const onVoiceChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: only bundled voice is "downloaded"
    mockIsVoiceDownloaded.mockImplementation((id: string) => id === 'en_US-amy-medium');
    mockDownloadVoice.mockResolvedValue('/data/voices/es_ES-mls-medium/es_ES-mls-medium.onnx');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a voice select with data-testid', () => {
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    expect(screen.getByTestId('tts-voice-picker')).toBeInTheDocument();
  });

  it('shows all catalog voices as options', () => {
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    const select = screen.getByTestId('tts-voice-picker') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('en_US-amy-medium');
    expect(options).toContain('es_ES-mls-medium');
    expect(options).toContain('de_DE-thorsten-medium');
  });

  it('displays the current voice as selected', () => {
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    const select = screen.getByTestId('tts-voice-picker') as HTMLSelectElement;
    expect(select.value).toBe('en_US-amy-medium');
  });

  it('calls onVoiceChange immediately when switching to bundled voice', () => {
    // Start on Spanish (pretend already downloaded)
    mockIsVoiceDownloaded.mockReturnValue(true);
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="es_ES-mls-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByTestId('tts-voice-picker'), {
      target: { value: 'en_US-amy-medium' },
    });
    expect(onVoiceChange).toHaveBeenCalledWith('en_US-amy-medium');
    expect(mockDownloadVoice).not.toHaveBeenCalled();
  });

  it('initiates download when selecting a non-downloaded non-bundled voice', async () => {
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByTestId('tts-voice-picker'), {
      target: { value: 'es_ES-mls-medium' },
    });
    await waitFor(() => {
      expect(mockDownloadVoice).toHaveBeenCalledWith('es_ES-mls-medium');
    });
  });

  it('shows downloading indicator while download is in progress', async () => {
    let resolveDownload!: (v: string) => void;
    mockDownloadVoice.mockReturnValue(
      new Promise<string>((r) => {
        resolveDownload = r;
      }),
    );
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByTestId('tts-voice-picker'), {
      target: { value: 'es_ES-mls-medium' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('tts-voice-downloading')).toBeInTheDocument();
    });
    resolveDownload('/data/voices/es_ES-mls-medium/es_ES-mls-medium.onnx');
  });

  it('calls onVoiceChange after successful download', async () => {
    mockDownloadVoice.mockResolvedValue(
      '/data/voices/es_ES-mls-medium/es_ES-mls-medium.onnx',
    );
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByTestId('tts-voice-picker'), {
      target: { value: 'es_ES-mls-medium' },
    });
    await waitFor(() => {
      expect(onVoiceChange).toHaveBeenCalledWith('es_ES-mls-medium');
    });
  });

  it('shows download error when download fails', async () => {
    mockDownloadVoice.mockRejectedValue(new Error('Network error'));
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByTestId('tts-voice-picker'), {
      target: { value: 'es_ES-mls-medium' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('tts-download-error')).toBeInTheDocument();
    });
  });

  it('reverts to bundled English voice on download failure', async () => {
    mockDownloadVoice.mockRejectedValue(new Error('Network error'));
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByTestId('tts-voice-picker'), {
      target: { value: 'es_ES-mls-medium' },
    });
    await waitFor(() => {
      expect(onVoiceChange).toHaveBeenCalledWith('en_US-amy-medium');
    });
  });

  it('does not show download error initially', () => {
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={false}
      />,
    );
    expect(screen.queryByTestId('tts-download-error')).toBeNull();
  });

  it('is disabled when disabled prop is true', () => {
    render(
      <TtsVoiceLazyPicker
        currentVoiceId="en_US-amy-medium"
        onVoiceChange={onVoiceChange}
        disabled={true}
      />,
    );
    const select = screen.getByTestId('tts-voice-picker') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
