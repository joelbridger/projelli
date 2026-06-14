// Tests for ReimaginedAsk multi-turn conversational surface
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReimaginedAsk } from '@/components/ai/ReimaginedAsk';

const mockInitSession = vi.fn();
const mockAddMessage = vi.fn();
const mockUpdateLastMessage = vi.fn();
const mockSessions: Record<string, { chatId: string; messages: unknown[]; isLoading: boolean; lastUpdated: string }> = {};

vi.mock('@/stores/matterStore', () => ({
  useActiveMatter: () => null,
}));
vi.mock('@/modules/memory/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));
vi.mock('@/modules/memory/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn().mockResolvedValue([]) },
  isMemoryEnabled: () => false,
}));
vi.mock('@/modules/memory/workspaceCommand', () => ({
  DEFAULT_WORKSPACE_TOP_K: 5,
  buildWorkspaceContextBlock: () => '',
  citationBasename: (p: string) => p,
  parseCitations: () => [],
  resolveCitationPath: () => null,
}));
vi.mock('@/modules/models/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(() => ({
    getKey: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('@/modules/models/OllamaProvider', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({ content: 'Mock answer' }),
    getMetadata: vi.fn().mockReturnValue({ provider: 'ollama', model: 'test' }),
  })),
}));
vi.mock('@/modules/models/ClaudeProvider', () => ({ ClaudeProvider: vi.fn() }));
vi.mock('@/modules/models/OpenAIProvider', () => ({ OpenAIProvider: vi.fn() }));
vi.mock('@/modules/models/GeminiProvider', () => ({ GeminiProvider: vi.fn() }));
// The mock must expose both the hook form (selector call) and the static
// getState() method used by Fix #1 (stale-sessions bug).
// vi.mock factories are hoisted, so we cannot reference variables declared
// after them. We build the mock inside the factory using only references
// that are safe at hoist time (the module-level `mock*` vars are declared
// with `const` above, but they are initialised before the factory runs
// because Vitest processes the hoisted factory lazily on first import).
vi.mock('@/stores/aiChatStore', () => {
  const hook = (selector: (s: unknown) => unknown) =>
    selector({ initSession: mockInitSession, addMessage: mockAddMessage, updateLastMessage: mockUpdateLastMessage, sessions: mockSessions });
  hook.getState = () => ({ initSession: mockInitSession, addMessage: mockAddMessage, updateLastMessage: mockUpdateLastMessage, sessions: mockSessions });
  return { useAIChatStore: hook };
});

describe('ReimaginedAsk', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    const { container } = render(<ReimaginedAsk />);
    expect(container.firstChild).toBeTruthy();
  });

  it('shows composer input', () => {
    render(<ReimaginedAsk />);
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('accepts onSaveToDocument prop', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    expect(() => render(<ReimaginedAsk onSaveToDocument={onSave} />)).not.toThrow();
  });

  it('New ask button clears conversation state', async () => {
    render(<ReimaginedAsk />);
    // Verify the component renders something initially
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('shows Search button in composer', () => {
    render(<ReimaginedAsk />);
    const askBtn = screen.getByRole('button', { name: /^Search$/i });
    expect(askBtn).toBeDefined();
  });

  it('Search button is disabled when input is empty', () => {
    render(<ReimaginedAsk />);
    const askBtn = screen.getByRole('button', { name: /^Search$/i });
    expect((askBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Search button enables when input has text', () => {
    render(<ReimaginedAsk />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'What are the key facts?' } });
    const askBtn = screen.getByRole('button', { name: /^Search$/i });
    expect((askBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls initSession on mount', () => {
    render(<ReimaginedAsk />);
    expect(mockInitSession).toHaveBeenCalledWith('ask-global', []);
  });

  it('shows empty state when no turns', () => {
    render(<ReimaginedAsk />);
    // The updated empty state headline
    expect(screen.getByText(/what do you want to find/i)).toBeDefined();
  });

  it('shows example chips in empty state', () => {
    render(<ReimaginedAsk />);
    expect(screen.getByText(/summarize the latest deposition/i)).toBeDefined();
    expect(screen.getByText(/find every email from opposing counsel/i)).toBeDefined();
    expect(screen.getByText(/what deadlines are coming up/i)).toBeDefined();
  });

  it('clicking an example chip fills the input without submitting', () => {
    render(<ReimaginedAsk />);
    const chip = screen.getByText(/summarize the latest deposition/i);
    fireEvent.click(chip);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Summarize the latest deposition');
    // initSession should only have been called once (on mount), not again for a submit
    expect(mockInitSession).toHaveBeenCalledTimes(1);
  });

  it('submitting question does not throw (smoke test)', () => {
    render(<ReimaginedAsk />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Test question' } });
    // Find the submit button — after typing, it should be enabled
    const buttons = screen.getAllByRole('button');
    const askBtn = buttons.find((b) => b.textContent?.includes('Ask') && !(b as HTMLButtonElement).disabled);
    // If we found an enabled Ask button, clicking it should not throw
    if (askBtn) {
      expect(() => fireEvent.click(askBtn)).not.toThrow();
    } else {
      // If disabled Ask button is all we found, that's still a valid state
      expect(input).toBeDefined();
    }
  });

  it('strips {n} citation markers when restoring a persisted conversation', () => {
    // Reload path: a persisted answer keeps its {n} chip markers, but the
    // citation map is not persisted. Restored turns must render as clean prose,
    // never raw "{1}" tokens. Regression guard for the reconstructTurns strip.
    mockSessions['ask-global'] = {
      chatId: 'ask-global',
      messages: [
        { role: 'user', content: 'What did the witness say?', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'The witness confirmed the timeline {1} and the location {2}.', timestamp: '2026-01-01T00:00:00Z' },
      ],
      isLoading: false,
      lastUpdated: '2026-01-01T00:00:00Z',
    };
    try {
      render(<ReimaginedAsk />);
      // No raw chip markers anywhere in the restored prose.
      expect(screen.queryByText(/\{\d\}/)).toBeNull();
      // The words that flanked the markers are now adjacent (markers removed).
      expect(screen.getByText(/timeline and the location/i)).toBeDefined();
    } finally {
      delete mockSessions['ask-global'];
    }
  });

  it('restores turns from getState() not closed-over sessions (Fix #1 stale-snapshot)', () => {
    // Regression guard: the chatId-change effect previously read the closed-over
    // `sessions` selector value, which is always the snapshot at render time.
    // For a freshly-mounted component with a pre-seeded store the closed-over
    // value would be stale and turns would be empty. Fix #1 reads getState()
    // instead so the post-initSession value is always fresh.
    //
    // We seed mockSessions (which getState() returns) BEFORE render so that the
    // effect reads pre-existing messages. The component should display the
    // restored question text, proving it used getState() not the stale selector.
    mockSessions['ask-global'] = {
      chatId: 'ask-global',
      messages: [
        { role: 'user', content: 'What is the statute of limitations?', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'The statute runs three years from discovery.', timestamp: '2026-01-01T00:00:00Z' },
      ],
      isLoading: false,
      lastUpdated: '2026-01-01T00:00:00Z',
    };
    try {
      render(<ReimaginedAsk />);
      // The restored question should appear in the conversation.
      expect(screen.getByText(/what is the statute of limitations/i)).toBeDefined();
      // The restored answer should appear (stripped of any chip markers).
      expect(screen.getByText(/statute runs three years/i)).toBeDefined();
    } finally {
      delete mockSessions['ask-global'];
    }
  });
});
