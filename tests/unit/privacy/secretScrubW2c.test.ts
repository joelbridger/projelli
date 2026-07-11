import { afterEach, describe, expect, it } from 'vitest';
import type { Provider } from '@/platform/providers/Provider';
import { agendaMarkdownFromBrief } from '@/features/meetings/agendaExport';
import { DocSummaryService } from '@/platform/analysis/DocSummaryService';
import { createWorkflowEngine } from '@/features/workflows/engine/WorkflowEngine';
import type { WorkflowTemplate } from '@/platform/types/workflow';
import { setPromptDecisionBroker } from '@/platform/privacy/promptPreparation';

const SECRET = 'https://example.test/i/abc#intake-secret';
function provider(sent: string[]): Provider {
  return {
    getMetadata: () => ({ providerId: 'ollama', model: 'test-model' }),
    sendMessage: async (prompt) => {
      sent.push(prompt);
      return { content: '## Topics to cover\n- Review\n## Documents to bring\n- None\n## Since we last met\n- Update', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, cost: 0, model: 'test-model' };
    },
    structuredOutput: async () => ({ thesis: 'Summary', bullets: [], assumptions: [], risks: [], open_questions: [], actions: [], confidence: 1, citations: [] }),
    formatAttachmentForRequest: () => ({ _text_extract: { text: '', pageCount: 0, fileName: '' } }),
    supportsAttachment: () => false,
  } as Provider;
}
afterEach(() => setPromptDecisionBroker());
describe('secret scrub wave 2c real send paths', () => {
  it('redacts a meeting agenda before its provider receives it', async () => {
    const sent: string[] = []; setPromptDecisionBroker(async () => 'send_redacted_copy');
    await agendaMarkdownFromBrief({ markdown: `Private link: ${SECRET}` }, { clientLabel: 'Client', eventTitle: 'Review', matterId: 'matter-1', provider: provider(sent) });
    expect(sent).toHaveLength(1); expect(sent[0]).not.toContain('intake-secret'); expect(sent[0]).toContain('[private-link-hidden]');
  });
  it('redacts a document summary before its structured provider receives it', async () => {
    const sent: string[] = []; const testProvider = provider(sent);
    testProvider.structuredOutput = async <T>(prompt: string) => {
      sent.push(prompt);
      return {
        thesis: 'Summary', bullets: [], assumptions: [], risks: [], open_questions: [], actions: [], confidence: 1, citations: [],
      } as T;
    };
    setPromptDecisionBroker(async () => 'send_redacted_copy'); await new DocSummaryService(testProvider).generateSummary('doc-1', `Link: ${SECRET}`);
    expect(sent).toHaveLength(1); expect(sent[0]).not.toContain('intake-secret'); expect(sent[0]).toContain('[private-link-hidden]');
  });
  it('blocks a background workflow before any provider call', async () => {
    const sent: string[] = []; const template = { id: 'secret-test', name: 'Secret test', description: '', category: 'test', version: '1', steps: [{ id: 'generate', name: 'Generate', type: 'generate', config: { promptTemplate: 'Use {{answer}}', outputFile: 'result.md' } }] } as unknown as WorkflowTemplate;
    const engine = createWorkflowEngine(provider(sent), { writeFile: async () => undefined, readFile: async () => '' }, async () => ({}), undefined, { audit: { providerId: 'ollama', getConfidentialityMode: () => 'local-only', background: true } });
    const run = await engine.execute(template, { answer: SECRET });
    expect(run.status).toBe('failed'); expect(run.error).toContain('prompt_review_required'); expect(sent).toEqual([]);
  });
});
