# 03 - AI Use, Supervision, and AI-Washing Controls

Draft date: 2026-07-09
Audience: CCO, RIA compliance consultant, security reviewer
Status: Draft for review. This is not legal or compliance advice.

## Executive summary

Advisor Prep Hero should be approved as an advisor-supervised drafting and research aid, not an autonomous advice engine. The product can summarize, retrieve, draft, and cite from client materials. A human advisor remains responsible for every client communication, recommendation, compliance record, CRM write-back, advertisement, and external action.

The firm should approve AI use by mode and provider:

- Local-only mode for the most sensitive client work.
- Direct cloud mode only with firm-approved API providers and account settings.
- Firm Assured mode only after DPA, zero-retention evidence, and technical review.

## Supported AI paths

| Path | Supported providers | What leaves the device | Advisor Prep Hero server role | Approval note |
|---|---|---|---|---|
| Local-only | Advisor Prep Hero Local AI if available in the firm's build, Ollama, or another approved local model | No prompt or client-file content leaves the device for AI inference | None for AI inference | Best default for sensitive work. |
| Direct cloud | Anthropic API, OpenAI API, Google Gemini API | Prompt, selected context, attachments included by the user, and response metadata go directly to the provider | None for AI inference | Provider must be approved under the firm's AI/vendor policy. |
| Firm Assured | Firm-configured provider behind Advisor Prep Hero relay | Prompt and selected context route through Advisor Prep Hero relay, then provider | Transient forwarding with no retention claimed | Needs DPA and current technical evidence before approval. |
| Web demo | Demo relay when no personal key is used | Prompt can go through demo relay | Shared demo path | Do not use with real client data. |

## Exact data sent to an AI provider

When the user sends an AI request, the provider may receive:

- The user's question or instruction.
- Prior chat messages needed for context.
- System instructions telling the AI how to behave.
- Selected snippets from the active client matter or workspace.
- File excerpts selected by retrieval/search.
- Attachments or document text the user includes in the request.
- Citation labels and source references needed to answer with citations.
- Model parameters and ordinary API metadata.

The provider should not receive:

- The entire workspace by default.
- Other client matters unless the user chooses an approved cross-client/all-matters action.
- API keys for other providers.
- Local audit-log database contents.
- Local telemetry or diagnostics records.
- Advisor Prep Hero license records.

## Prompt construction controls

Advisor Prep Hero is designed to reduce accidental over-sharing:

- The user works in a client/matter context.
- Retrieval should be scoped to the active client/matter.
- Sensitive or privileged material can be excluded unless explicitly included.
- The app shows an egress indicator so the user can see whether the next AI request stays local or goes to a cloud provider.
- Local-only mode blocks cloud provider sends.
- Citation verification labels help the user see whether cited support was confirmed, grounded but unverified, or unverified.

Firm policy should require users to check both scope and egress mode before sending client data.

## No-training and retention claims

Use precise language. Do not make blanket claims like "AI providers never train on your data" unless the firm has current evidence for the specific provider account and tier.

Advisor Prep Hero can truthfully say:

- In local-only mode, client prompts and file content do not go to a cloud AI provider.
- In direct cloud mode, Advisor Prep Hero does not receive, store, train on, or retain the prompt or response because the request goes directly from the advisor's machine to the selected provider.
- Advisor Prep Hero does not use customer workspace content to train its own AI models.
- Provider training and retention are governed by the firm's account terms with that provider, not by Advisor Prep Hero.

Current provider references the firm should verify:

| Provider | Current public posture to verify | Approval note |
|---|---|---|
| OpenAI API | OpenAI states that business/API data is not used to train models by default, and that API abuse-monitoring logs may be retained for up to 30 days unless different controls apply. | Verify account tier, retention controls, zero-data-retention eligibility, and whether any opt-in sharing is enabled. |
| Anthropic API | Anthropic states that commercial products, including the API, are not used for training by default. | Verify contract/tier and whether consumer Claude accounts are prohibited for client content. |
| Google Gemini API | Google terms differ by paid, free, trial, and product path. | Require paid/business terms review before approval; do not assume free AI Studio terms are acceptable. |
| Ollama/local model | Local model inference runs on the user's machine. | Confirm no cloud-hosted model mode is being used when claiming local-only. |

## Hallucination and citation controls

AI can be wrong. The firm should assume every output is a draft until reviewed.

Advisor Prep Hero's safeguards:

- Answers are designed to cite local source material.
- Citation checks can verify whether a citation points to real local source text.
- The UI can distinguish verified, grounded-but-unverified, and unverified citations.
- Out-of-scope questions can be refused when the files do not support an answer.
- The audit log can record retrieval, egress, citation, and approval events.

Required firm rule:

No advisor may rely on AI output without reading the cited source, applying professional judgment, and following the firm's review procedure. If a citation is missing or unverified, the user must verify the point manually before using it.

## Human approval rules

The firm should require human review before:

- Sending a client email or letter drafted by AI.
- Updating CRM notes, tasks, fields, or meeting summaries.
- Opening or changing account paperwork.
- Sending information to a custodian.
- Publishing marketing copy, website copy, newsletters, social posts, or performance language.
- Using AI-generated recommendations, advice language, suitability notes, Reg BI notes, or meeting-prep materials.
- Including client information in support requests.
- Running cross-client/all-matters searches.
- Including sensitive/privileged materials in a cloud AI request.
- Taking any action that could move money, change payment instructions, trade securities, or change custody/access.

Advisor Prep Hero should not be approved for autonomous trading, money movement, custody, payment changes, or unsupervised investment recommendations.

## Compliance Rule mapping

Rule 206(4)-7 requires investment advisers to adopt and implement written policies and procedures reasonably designed to prevent violations, review them at least annually, and designate a CCO. For Advisor Prep Hero, that means the firm's written policies should cover:

- Approved AI modes and providers.
- User training.
- Human review.
- Recordkeeping.
- Vendor review.
- Incident escalation.
- Annual review of whether the AI use policy still matches the product and provider terms.

## Marketing Rule and client-content review

Rule 206(4)-1 prohibits misleading adviser advertisements and requires substantiation and fair/balanced treatment of benefits and risks. AI-generated ads, newsletters, website copy, client letters, testimonials, endorsements, and performance language must go through the firm's normal compliance review before use.

Advisor Prep Hero should be described carefully:

- "Local-first desktop workspace" is acceptable if true.
- "Client files are not stored on Advisor Prep Hero servers in normal desktop use" is acceptable if true.
- "Direct cloud mode sends prompts to the firm's selected AI provider" must be said when discussing cloud AI.
- "Local-only mode keeps AI prompts and file content on the device" is acceptable if the mode is actually active.

## AI-washing risk

The SEC has brought enforcement actions for false or misleading AI claims. For Advisor Prep Hero and for firms using it, claims must be exact and supportable.

### Do-not-say list

Do not say:

- "SEC approved."
- "Reg S-P compliant by default."
- "Compliance guaranteed."
- "No vendor review needed."
- "No data ever leaves the machine" without saying this applies only to local-only mode.
- "All AI providers never train on your data" without provider-specific evidence.
- "Advisor Prep Hero is SOC 2 certified" unless and until the report exists.
- "Zero retention" unless the exact path, contract, and evidence support it.
- "Fully automatic compliant client communications."
- "AI advice you can rely on without review."
- "Safe to upload all client files into ChatGPT."
- "No risk of hallucination."

### Safer approved language

Use language like:

- "Advisor Prep Hero is local-first: your client files live on your computer or firm-approved storage, not in an Advisor Prep Hero cloud workspace."
- "In local-only mode, prompts and client files are processed on the device."
- "In direct cloud mode, prompts go from your machine to the AI provider your firm approved, under your account. Advisor Prep Hero is not in that path."
- "AI output is a draft. Review the cited source before using it."
- "This pack helps a CCO evaluate the product. It is not a legal opinion or compliance certification."

## Sources

- 17 CFR 275.206(4)-7, compliance policies and procedures: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206%284%29-7
- 17 CFR 275.206(4)-1, investment adviser marketing: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206%284%29-1
- SEC 2026 Examination Priorities: https://www.sec.gov/files/2026-exam-priorities.pdf
- SEC AI-washing enforcement release, 2024: https://www.sec.gov/newsroom/press-releases/2024-36
- OpenAI API data controls: https://developers.openai.com/api/docs/guides/your-data
- Anthropic commercial/API training statement: https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- Google Gemini API terms: https://ai.google.dev/gemini-api/terms
- Ollama FAQ: https://docs.ollama.com/faq
