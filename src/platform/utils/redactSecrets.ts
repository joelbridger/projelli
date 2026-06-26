/**
 * redactSecrets — scrub anything that looks like an AI provider API key out of
 * free text, so a key a user pasted into a message (e.g. the AI-setup help
 * ticket, which sits right under "Paste your API key") never leaves their
 * machine. Covers Anthropic (`sk-ant-...`), OpenAI (`sk-...`, `sk-proj-...`),
 * and Google (`AIza...`). The length floors keep ordinary prose from being
 * redacted by accident.
 */
export const REDACTED_API_KEY = '[redacted possible API key]';

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED_API_KEY)
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, REDACTED_API_KEY)
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, REDACTED_API_KEY);
}
