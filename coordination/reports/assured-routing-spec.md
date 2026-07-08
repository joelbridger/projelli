Workflows are inconsistent:
- [resolveTemplateModel.ts](/home/jameson/lp-ux-integrate/src/features/workflows/engine/resolveTemplateModel.ts:149) resolves workflow providers.
- Current path: local-only/local pin → chosen personal key → any personal key → mock/error.
- Missing check: Assured should be checked before personal keys for cloud workflow models.
- [useWorkflowRunner.ts](/home/jameson/lp-ux-integrate/src/app/workflow/useWorkflowRunner.ts:479) creates the real provider without Assured.
- [WorkflowEngine.ts](/home/jameson/lp-ux-integrate/src/features/workflows/engine/WorkflowEngine.ts:350) can already audit `assuredAvailable`, but the runner never passes it.
Redline and inline edit are inconsistent:
- [resolveRedlineProvider.ts](/home/jameson/lp-ux-integrate/src/app/shell/layout/resolveRedlineProvider.ts:48) picks personal keys first.
- [DocxEditor.tsx](/home/jameson/lp-ux-integrate/src/features/documents/media/DocxEditor.tsx:1813) blocks cloud redline if no personal key exists.
- [redline.ts](/home/jameson/lp-ux-integrate/src/features/documents/docx/redline.ts:323) can already audit Assured, but callers do not pass it.
- [resolveInlineEditProvider.ts](/home/jameson/lp-ux-integrate/src/app/shell/layout/resolveInlineEditProvider.ts:36) also requires a personal key.
- [useInlineAiEdit.ts](/home/jameson/lp-ux-integrate/src/features/documents/editor/useInlineAiEdit.ts:182) sends through that provider.
Other AI send paths with the same issue:
- [matterAtAGlance.ts](/home/jameson/lp-ux-integrate/src/platform/matter/matterAtAGlance.ts:160) uses personal keys first.
- [clientMap/provider.ts](/home/jameson/lp-ux-integrate/src/features/matters/clientMap/provider.ts:71) uses personal keys first.
- [clientMap/generator.ts](/home/jameson/lp-ux-integrate/src/features/matters/clientMap/generator.ts:110) logs `assuredAvailable: false`.
- [customSection.ts](/home/jameson/lp-ux-integrate/src/features/matters/clientMap/customSection.ts:40) logs `assuredAvailable: false`.
- [generateBrief.ts](/home/jameson/lp-ux-integrate/src/features/meetings/generateBrief.ts:365) uses the At-a-Glance resolver.
- [agendaExport.ts](/home/jameson/lp-ux-integrate/src/features/meetings/agendaExport.ts:78) uses the At-a-Glance resolver.
- [meetingStore.ts](/home/jameson/lp-ux-integrate/src/features/meetings/meetingStore.ts:581) uses the At-a-Glance resolver.
- [useChatSending.ts](/home/jameson/lp-ux-integrate/src/features/ask/hooks/useChatSending.ts:889) requires a personal key before chat can use Assured.
- [AIChatViewer.tsx](/home/jameson/lp-ux-integrate/src/features/ask/AIChatViewer.tsx:430) fact extraction builds a provider without Assured.
**Minimal Shared Seam**
Do not patch each feature separately. Add one shared resolver, then make every send path call it.
Suggested shape:
```ts
resolveActiveGenerationProvider({
  mode,
  preferredProvider,
  preferredModel,
  stream,
  allowCloudFallback,
  preservePinnedLocal,
})
```
It should return:
```ts
{
  provider,
  providerId,
  model,
  assuredAvailable,
  assuredRoute,
  destination,
  source,
}
```
The existing badge resolver, [activeEgressProvider.ts](/home/jameson/lp-ux-integrate/src/platform/privacy/activeEgressProvider.ts), should use the same route decision. Right now it has an Assured slot internally, but callers feed it `null`, so the badge mirrors the wrong BYOK-first behavior.
**Behavior Rules**
- If Assured and BYOK both exist, Assured wins.
- If Assured exists but no personal key exists, the send still works through Assured.
- If Assured is configured but missing local firm tokens, fall back before sending.
- If the Assured proxy request starts and then fails, do not silently retry through BYOK. That could leak data after the user expected the firm-safe route.
- Local-only mode always blocks Assured and BYOK.
- Explicit local workflow templates stay local.
- Explicit cloud workflow templates should use Assured when an Assured route exists. My recommendation: in Assured mode, firm privacy wins over a cloud template’s personal-provider preference.
- Streaming sends must pass `stream: true`; normal sends and structured output should pass `stream: false`.
- Audit should record the route that was actually used, not whatever mode is current later.
One risk I found: [firmStore.ts](/home/jameson/lp-ux-integrate/src/platform/firm/firmStore.ts) appears to clear `assuredProviders` for non-admin users during refresh. If firm members are supposed to use Assured too, that may hide the route from them.
**TDD Test Plan**
Start with failing tests.
Add shared resolver tests for:
- Local-only beats Assured and BYOK.
- Assured OpenAI beats personal Anthropic.
- Assured works with no personal key.
- Missing Assured tokens falls back to BYOK.
- Pinned local workflow model stays local.
- Assured send failure does not auto-retry through BYOK.
Update badge tests in:
- [single-source-egress.test.ts](/home/jameson/lp-ux-integrate/tests/unit/privacy/single-source-egress.test.ts)
Add or update surface tests for:
- Ask: [no-provider-resolution.test.ts](/home/jameson/lp-ux-integrate/tests/unit/ask/no-provider-resolution.test.ts)
- Workflows: [workflow-provider-resolution.test.ts](/home/jameson/lp-ux-integrate/tests/unit/workflow/workflow-provider-resolution.test.ts)
- Redline: [resolve-redline-provider.test.ts](/home/jameson/lp-ux-integrate/tests/unit/resolve-redline-provider.test.ts)
- Inline edit: [inline-edit-provider.test.ts](/home/jameson/lp-ux-integrate/tests/unit/inline-edit-provider.test.ts)
- Redline audit: [docx-redline-audit.test.ts](/home/jameson/lp-ux-integrate/tests/unit/docx-redline-audit.test.ts)
- Client Map and meetings: existing Client Map, At-a-Glance, Meeting Brief, and Agenda Export tests should assert `assured-proxy`.
Email tests should mostly stay unchanged because email already has the desired behavior.
**Blast Radius**
This is a privacy-routing change, not a provider rewrite. The provider layer already supports Assured through `createProvider(..., assured)`. The main work is replacing scattered “pick a key” logic with one shared route decision.
Likely changed tests:
- Badge tests that currently expect BYOK in Assured mode.
- Ask tests that assume a personal key is needed.
- Workflow provider tests that assume BYOK-first cloud choice.
- Redline and inline-edit tests that assume missing personal key blocks cloud.
- Client Map and meeting audit tests that hard-code `assuredAvailable: false`.
Highest risks:
- Accidentally breaking local-only.
- Accidentally making local workflow templates use cloud.
- Audit saying “Assured” when the real send used BYOK, or the reverse.
- Firm members not seeing Assured because `assuredProviders` is admin-only during refresh.
SPEC-COMPLETE
