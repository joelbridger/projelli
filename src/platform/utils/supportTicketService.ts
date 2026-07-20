import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { AI_SETUP_HELP_ENDPOINT, BUG_REPORT_ENDPOINT } from './supportEndpoints';

type BugReportPayload = {
  message: string;
  email?: string;
  version?: string;
  os?: string;
  user_agent?: string;
};

type AiSetupHelpPayload = {
  message: string;
  provider: string;
  context: string;
  version: string;
  os: string;
  user_agent: string;
  email?: string;
};

async function postSupportTicket(endpoint: string, payload: BugReportPayload | AiSetupHelpPayload, signal?: AbortSignal): Promise<Response> {
  const fetchFn = await getCorsSafeFetch({ signalEgress: false });
  return fetchFn(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  });
}

/** Send a bug report without exposing the internal endpoint to UI modules. */
export function submitBugReport(payload: BugReportPayload): Promise<Response> {
  return postSupportTicket(BUG_REPORT_ENDPOINT, payload);
}

/** Send an AI setup-help request without exposing the internal endpoint to UI modules. */
export function submitAiSetupHelpTicket(payload: AiSetupHelpPayload, signal: AbortSignal): Promise<Response> {
  return postSupportTicket(AI_SETUP_HELP_ENDPOINT, payload, signal);
}
