# Keepance vs the field: reviewer comparison matrix

**For:** journalists, bloggers, podcast hosts, and vertical-community reviewers
**As of:** June 2026
**Full HTML version:** keepance.com/press-kit/comparison-matrix (deploy-gated, pending Jameson review)

---

## The one-line version

Every serious AI tool in the legal, tax, consulting, and advisor markets is cloud SaaS. Their privacy story is a contract ("we don't train on your data"). Keepance with a local Ollama model is the only option in any of these markets where the claim is architectural: nothing reaches any server other than the machine on the user's desk.

---

## Pricing note

All competitor figures are approximate bands, as of June 2026. Verify with each vendor before publishing.

---

## Master matrix

| Dimension | Keepance | Clio Duo | CoCounsel | Intuit Assist | Blue J | M365 Copilot | Gamma | Jump | Zocks | ChatGPT (consumer) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Local / zero-egress option** | Yes (Ollama; local model = nothing leaves the machine) | No | No | No | No | No | No | No | No | No |
| **Cloud BYOK (your key, direct to provider)** | Yes | No | No | No | No | No | No | No | No | No |
| **No-training policy (cloud)** | N/A (user's own key, user's own provider terms) | Contractual, SOC 2 | Contractual, zero retention, SOC 2 | Training policy not fully public | Contractual, 24-hr deletion, SOC 2 | No training (enterprise tenant), SOC 2 | Free/Plus train by default; Team+ no-training | No training; SOC 2 Type II + HIPAA | No audio/video stored; SOC 2 Type II | Consumer Free/Plus train by default |
| **SOC 2 / signed DPA** | Not yet (in progress) | SOC 2 Type II | SOC 2 + ISO 27001 | Intuit enterprise posture | SOC 2 | SOC 2 / ISO / FedRAMP | No DPA published | SOC 2 Type II + HIPAA | SOC 2 Type II | No |
| **Conversations become files you own** | Yes, automatic (Markdown on disk) | Stored in Clio | Stored in TR cloud | Stored in Intuit | Cloud only | Saves to M365/SharePoint | Deck lives in Gamma | Notes in Jump cloud | Notes in Zocks cloud | Conversation in OpenAI |
| **Files are plain-text and portable** | Yes (Markdown) | No | No | No | No | Partial (Word/PPTX) | Partial (export PDF/PPTX) | No | Partial (archiving) | No |
| **Profession workflow templates** | 28 built-in + community marketplace | Matter-type actions (deep Clio integration) | Litigation task library (Westlaw-grounded) | Tax advisory planning (60+ return data points) | Research + confidence scoring (primary authority) | General productivity | Deck templates (best-in-class slides) | Meeting-notes templates (30+ CRM integrations) | Meeting-notes; eMoney sync | General-purpose |
| **Proprietary research database** | No (sits beside Westlaw / Checkpoint) | No | Yes -- Westlaw + Shepard's | No | Yes -- primary tax authority + citations | No | No | No | No | No (hallucination risk) |
| **Practice-management integration** | No (sits beside Clio, Drake, eMoney) | Yes -- Clio matters, billing, deadlines | Yes -- Westlaw / Practical Law | Yes -- built into Lacerte / ProConnect | Research only | Yes -- M365 / SharePoint / Teams | No | Yes -- 30+ CRM integrations | Yes -- eMoney + Smarsh/Global Relay | No |
| **Meeting-notes + CRM sync** | No (not a meeting-notes tool) | No | No | No | No | Partial (Teams transcription) | No | Yes -- purpose-built, 27,000 advisors | Yes -- purpose-built, no audio stored | No |
| **Polished deck / branded PDF output** | Partial (basic PPTX export) | No | No | No | No | Yes -- real PPTX in Word/PowerPoint | Yes -- best-in-class AI deck design | No | No | No |
| **AI provider choice** | Claude, OpenAI, Gemini, Ollama | Clio-selected | TR models | Intuit-selected | Blue J proprietary | Azure OpenAI (tenant) | Multiple (Gamma-selected) | Jump-selected | Zocks-selected | OpenAI only |
| **Multimodal (image + PDF in chat)** | Yes (native PDF for Claude; text-extract for others) | Partial | Deep doc review | Partial (return data ingestion) | Partial | Yes (in Word / Teams / Edge) | Yes (source images for slides) | Partial (transcript only) | Partial (transcript only) | Yes (native since 2023) |
| **Works offline** | Yes (local Ollama for inference too) | No | No | No | No | No | No | No | No | No |
| **Price (approx., 2026)** | $49 one-time / $149/yr / $499/yr + API costs | ~$49-59/mo add-on to Clio | ~$225-428/mo (~$2,700-5,000/yr) | Free (bundled) | ~$1,498/yr | ~$18-30/mo/seat | ~$9-18/mo individual | ~$75-175/advisor/mo | ~$67-184/mo | $0-20/mo |
| **Pricing model** | One-time or annual; no per-seat usage fees | Monthly per-seat SaaS | Monthly per-seat SaaS | Bundled SaaS | Annual SaaS | Monthly per-seat add-on | Monthly SaaS | Monthly per-advisor SaaS | Monthly per-advisor SaaS | Monthly SaaS |
| **Desktop app (not browser-only)** | Yes (Windows + Mac + Linux, Tauri) | No | No | No | No | Yes (Office desktop + web) | No | Partial (browser + mobile) | Partial (browser + mobile) | Partial (browser + mobile apps) |

---

## Per-incumbent summary

### Clio Duo (legal)

**Approximate price:** ~$49-59/mo add-on to Clio Manage, or bundled in Elite
**Vendor page:** clio.com/products/clio-duo/

**Where Clio Duo wins:** Already inside the firm's workflow. Knows matters, billing codes, client names, and deadlines. SOC 2 Type II. One-click setup for existing Clio subscribers.

**Where Keepance wins:** Local zero-egress with Ollama, own-your-files architecture, much deeper legal profession templates, and roughly 4-10x cheaper for a solo attorney.

**Pick Clio Duo when:** the primary pain is AI that understands your matter and billing context. Keepance and Clio Duo run alongside each other.

---

### CoCounsel / Thomson Reuters (legal)

**Approximate price:** ~$225-428/mo per seat
**Vendor page:** legal.thomsonreuters.com/en/products/co-counsel

**Where CoCounsel wins:** Westlaw-grounded research with Shepard's citation verification. Deep litigation drafting and doc-review. Strong bar-association recognition. Zero retention at the LLM layer.

**Where Keepance wins:** Price (roughly 20x cheaper), zero-egress option via local model, own-your-files.

**Pick CoCounsel when:** you need citation-verified, Westlaw-grounded research. Keepance does not have a research database and does not compete on this.

---

### Intuit Assist (tax)

**Approximate price:** Free, bundled in Lacerte / ProConnect / ProSeries
**Vendor page:** proconnect.intuit.com

**Where Intuit Assist wins:** Already paid for. Pulls 60+ return data points for planning conversations. Zero incremental cost.

**Where Keepance wins:** Local zero-egress with Ollama removes the IRC §7216 third-party disclosure question. Keepance works with Drake (about a third of small-firm tax market; Intuit Assist does not reach Drake users). Explicit §7216-consent and WISP templates included.

**Pick Intuit Assist when:** you are on Lacerte / ProConnect and want advisory planning AI at no extra cost. Keepance is the companion for drafting, regulatory documentation, and Drake compatibility.

---

### Blue J (tax)

**Approximate price:** ~$1,498/yr (CPA.com promo ~$998/yr)
**Vendor page:** bluej.com

**Where Blue J wins:** Genuine primary-tax-authority research with predictive confidence scoring. Cited, auditable research trail. SOC 2.

**Where Keepance wins:** Price (about 10x cheaper), local zero-egress option, and general practice workflows (notices, engagements, WISP templates) that Blue J does not cover.

**Pick Blue J when:** primary-authority tax research with citations is the job. Many CPAs use Blue J for research and Keepance for drafting.

---

### Microsoft 365 Copilot (consulting, cross-vertical)

**Approximate price:** ~$18-30/mo per seat add-on
**Vendor page:** microsoft.com/en-us/microsoft-365/business/copilot-for-microsoft-365

**Where M365 Copilot wins:** Lives inside Word, PowerPoint, Outlook, and Teams. Generates real formatted PPTX. Enterprise tenant isolation and no-training policy (enterprise tier).

**Where Keepance wins:** A cloud tenant still uploads to Microsoft's servers. Only a local model satisfies a strict NDA no-upload clause. Per-client folder isolation and profession-specific templates.

**Pick M365 Copilot when:** the deliverable lives in Word or PowerPoint and the client's NDA does not require zero-upload.

---

### Gamma (consulting)

**Approximate price:** ~$9-18/mo individual
**Vendor page:** gamma.app

**Where Gamma wins:** Polished, designed AI decks in minutes. Best deck-from-prompt output in the market. Free and Plus tiers train by default (Team+ no-training).

**Where Keepance wins:** Everything before the deck: research, client analysis, draft narrative, per-client notes folder. Only a local model honors a strict no-upload clause during the confidential thinking phase.

**Recommended workflow:** think and draft in Keepance (local or BYOK), finish the deck in Gamma.

---

### Jump (advisor)

**Approximate price:** ~$75-175/advisor/mo
**Vendor page:** jumpai.com

**Where Jump wins:** Purpose-built meeting notes with 30+ CRM integrations. SOC 2 Type II and HIPAA. Category leader (27,000+ advisors).

**Where Keepance wins:** With a local Ollama model, there is no AI vendor surface for Reg S-P service-provider oversight. Own-your-files. Price (roughly 6-14x cheaper). General drafting and analysis outside the meeting workflow.

**Pick Jump when:** the primary pain is meeting notes, follow-ups, and CRM sync, and the practice is ready for formal vendor approval. Keepance covers pre- and post-meeting thinking that Jump does not address.

---

### Zocks (advisor)

**Approximate price:** ~$67-184/mo
**Vendor page:** zocks.ai

**Where Zocks wins:** Privacy-forward meeting notes: no audio or video stored. Native eMoney sync and Smarsh / Global Relay archiving. SOC 2 Type II.

**Where Keepance wins:** "Notes only" still means notes reached Zocks's cloud. With Keepance on a local model, nothing reaches any server. Reg S-P vendor-oversight surface is zero. Own-your-files.

**Pick Zocks when:** meeting notes with no audio retention and proven archiving integration are the requirements. Keepance covers drafting and analysis outside the meeting workflow.

---

### ChatGPT Free / Plus (cross-vertical baseline)

**Approximate price:** $0-20/mo
**Vendor page:** chat.openai.com

**Where ChatGPT wins:** Zero setup. Broadest consumer AI capability. Native image generation, voice mode, code interpreter. Fast for one-off general questions with no sensitive data.

**Where Keepance wins:** Consumer Free / Plus tiers train on input by default. Every conversation goes to OpenAI's servers. No conversation becomes a file the practitioner owns. The privilege (US v. Heppner), §7216, Reg S-P, and NDA risks are at their highest with consumer ChatGPT.

**Pick ChatGPT when:** the question is general-knowledge, the data is not client-sensitive, and you do not need the answer as a persistent file. ChatGPT Business / Enterprise (no-training tiers) are a meaningfully different product when confidentiality matters.

---

## Where Keepance wins (summary)

- The only product in any of these four markets with a zero-egress local-model option
- Own your files in plain Markdown: no vendor lock-in, no disappearing history
- 28 profession-specific workflow templates + community marketplace
- Price: $149/yr vs $1,200-5,000/yr for purpose-built tools
- Compatible with any system of record (Drake, Clio, eMoney) because it does not try to integrate with them; it sits beside them
- 2026 regulatory forcing functions (US v. Heppner for privilege; IRC §7216 / §6713 + FTC Safeguards Rule for tax; SEC Reg S-P deadline June 3 2026; rising NDA no-upload clauses) all push toward a zero-egress architecture

## Where incumbents win (do not fight these)

- Proprietary research databases: CoCounsel / Westlaw (legal citation); Blue J / Checkpoint (tax authority)
- Deep practice-management integration: Clio Duo (matter/billing context); Intuit Assist (return-data-aware planning)
- Meeting-notes and CRM sync: Jump and Zocks are purpose-built; Keepance is not
- Polished deck output: Gamma and M365 Copilot-in-PowerPoint produce designed, print-ready decks
- SOC 2 and signed DPAs: formal vendor approval at RIA firms and multi-lawyer firms requires these; Keepance is pursuing SOC 2 but does not have it yet

---

## Guardrails for reviewers

- "Nothing leaves your machine" applies specifically to users running a local AI model (Ollama). With a cloud BYOK key (Anthropic, OpenAI, Google), the prompt goes to that provider under the user's own API key. Keepance never sees that data; the provider does.
- Regulatory references (US v. Heppner, IRC §7216, SEC Reg S-P) are informational only, not legal or compliance advice. Practitioners should verify with their own counsel.
- US v. Heppner (Rakoff, S.D.N.Y., Feb 17 2026; defendant convicted May 7 2026) is a real and significant ruling but is a leading cautionary case, not settled black-letter law. Later courts are applying a fact-specific approach.
- Keepance pricing: $49 one-time (Personal) / $149/yr (Professional, includes one practice pack) / $499/yr (Practice, up to 5 seats). Not "$499 one-time."
- All competitor pricing is approximate, as of June 2026. Verify with vendor before publishing.

---

**Press contact:** support@keepance.com
**Full press kit:** keepance.com/press-kit
**Live comparison page:** keepance.com/press-kit/comparison-matrix (deploy-gated)
