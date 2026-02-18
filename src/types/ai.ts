// AI Chat Types

/**
 * API key configuration for AI providers
 */
export interface APIKey {
  provider: 'anthropic' | 'openai' | 'google';
  key: string;
  isValid: boolean;
  lastValidated?: Date;
}

/**
 * Message in an AI chat conversation
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO datetime
}

/**
 * AI Chat file structure
 * Stored as .aichat files in the workspace
 */
export interface AIChatFile {
  id: string;
  title: string;
  created: string; // ISO datetime
  updated: string; // ISO datetime
  messages: ChatMessage[];
  provider?: 'anthropic' | 'openai' | 'google'; // Optional: which AI provider
  model?: string; // Optional: specific model ID (e.g. 'claude-sonnet-4-5-20250514')
}
