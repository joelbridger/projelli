# Onboarding v3 — trust-claim sources (verify before final)

Every security/spec claim shown on Screens 1 and 2, with the precise mechanism, the source,
and where I verified it. Checked **2026-06-26**. No "compliant," no "guaranteed," no
"enterprise-grade" without the specifics behind it.

---

## 0. The hard rule: Keepance is NOT SOC 2 (do not claim it)

Keepance's own code says so plainly, so the onboarding must never imply otherwise:
- `src/features/privacy/FirmSecurityPack.tsx:168` — "**SOC 2:** Keepance is not SOC 2 certified."
- `src/platform/privacy/confidentialityReport.ts:18` — "Never claim SOC 2 or signed DPA (they don't exist)."
- `src/config/pricing.ts:132` — "independent SOC 2 and a DPA are on our roadmap, not yet in place."

**So in this onboarding SOC 2 is only ever the AI PROVIDER's property**, never Keepance's:
- Screen 1 note: "When you use a cloud provider, that provider is independently audited (SOC 2 Type 2)."
- Screen 2 cloud chip: "Provider is SOC 2 Type 2."

Verified: grepped the live Keepance source (2026-06-26); confirmed no scene claims Keepance is SOC 2.

## Screen 1 — security pills (round 5; all accurate)

| Pill shown | Mechanism / basis | Source |
|---|---|---|
| "Keepance stores none of your data" | Local-first: your documents and app state live on your computer; Keepance has no content server and never sees/stores your data. (Firm sync, when used, stores only E2EE ciphertext the relay can't read.) | CLAUDE.md "BYOK forever - Keepance never holds AI keys, never sees user data"; `confidentialityReport.ts`; `FirmSecurityPack.tsx` |
| "Fully encrypted (AES-256)" | Encrypted workspace vault is AES-256-GCM; keys in the OS keychain. AES-256 is the real standard the app uses. | CLAUDE.md "Vault: AES-256-GCM flat files (keepance-vault crate)" |
| "AI provider is SOC 2 certified" | PROVIDER-attributed (never Keepance). The cloud AI providers hold SOC 2 Type 2. Reworded from Jameson's "AI is SOC 2 compliant" to keep attribution clear and avoid the vague/banned word "compliant". | per-provider sections A.1-A.3 below |

Round-5 wording changes: pill 3 dropped "+ enterprise-grade" and the word "compliant"; uses
"AI provider is SOC 2 certified" (accurate + clearly the provider's, not Keepance's).
Accent: all UI accents now use the app's standardized `--kp-accent` = **#1f74c4** (the bright
brand `#5dc6ff` is too light for white button text); the pink->blue gradient is page-background only.

## Screen 2 — Card 1 bullets ("Use ChatGPT, Claude, or Gemini")

| Bullet shown | Basis | Source |
|---|---|---|
| "Keepance never sees your key or your data" | BYOK / Direct: request goes from your machine to your provider, not through Keepance. | `FirmSecurityPack.tsx:110-113` "Direct (bring your own key): data leaves to your chosen AI provider, not to Keepance" |
| "Providers are SOC 2 Type 2 certified" | Provider-attributed; verified per provider. | sections A.1-A.3 |
| "Encrypted in transit and at rest" | Provider encryption (TLS 1.2+ in transit, AES-256 at rest). | sections A.1-A.3 |
| "Providers don't train on your data (on paid API usage)" | OpenAI + Anthropic: API data not used for training by default. Google: not trained on the PAID tier only (free tier IS). The "(on paid API usage)" caveat makes it accurate for all three. | sections A.1-A.3 |

**Wording note (avoided an inaccuracy):** I deliberately did NOT say "temporary chats" anywhere; that
is a ChatGPT *consumer-app* feature, not how BYOK API usage works. The bullet states the real
API-default behavior with the paid-tier caveat.

**Help link:** Card 1's expanded "I need help setting this up" link is SHOWN ONLY in this prototype.
Its real action (open a help ticket / email) is being planned in a separate session and is wired later.

---

## A. Cloud option ("Use your own AI key")

**Framing on the card (always true for all three providers):**
> "Your key connects you straight to your provider. Keepance never sees your key or your data."

This is the BYOK mechanism: the request goes from the user's machine directly to the provider's
API using the user's own key. (This matches Keepance's own architecture: keys live in the OS
keychain, requests go direct to the provider, never through a Keepance content server.)

**Two universal trust chips (true for OpenAI, Anthropic, and Google):**
- "Encrypted in transit and at rest"
- "SOC 2 Type 2 audited"

### 1. OpenAI
| Claim shown | Exact source wording | Source |
|---|---|---|
| Not used for training (default) | "By default, data from ... the API Platform (after March 1, 2023) isn't used for training our models, unless you have explicitly opted in." | openai.com/enterprise-privacy |
| Encryption | "Data encryption at rest (AES-256) and in transit ... (TLS 1.2+)." | openai.com/enterprise-privacy |
| SOC 2 Type 2 | "Our API Platform has been audited and certified for SOC 2 Type 2 compliance." | openai.com/enterprise-privacy |
| Get-a-key link | API keys console | https://platform.openai.com/api-keys |

Verified: read the live page text directly (openai.com/enterprise-privacy, 2026-06-26).

### 2. Anthropic
| Claim shown | Exact source wording | Source |
|---|---|---|
| Not used for training (default) | "By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models." | privacy.claude.com/en/articles/7996868 |
| Encryption | AES-256 at rest, TLS 1.2+ in transit | trust.anthropic.com (Trust Center) |
| SOC 2 Type 2 | "SOC 2 Type II" listed; "2025 Type 2 SOC 2 and CSA STAR L2 Report.pdf" available; also ISO 27001:2022, ISO 42001 | trust.anthropic.com |
| Get-a-key link | API keys console | https://console.anthropic.com/settings/keys |

Verified: read privacy.claude.com article (commercial/API policy) and the live Trust Center grid (2026-06-26).
Note: the exact opt-in exception (feedback/thumbs-up can be used) is real but omitted from the card to keep it calm; it does not change the default.

### 3. Google (Gemini API) — the honest nuance Jameson flagged
| Claim shown | Exact source wording | Source |
|---|---|---|
| Paid key: NOT used for training | "When you use Paid Services ... Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products." | ai.google.dev/gemini-api/terms |
| Free tier: CAN be used | "For Unpaid Services, Google uses ... [the] content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies." | ai.google.dev/gemini-api/terms |
| Encryption | "All data that Gemini processes [is] encrypted at rest and in transit"; TLS by default | Google Cloud Gemini compliance docs |
| SOC 2 | Gemini maintains SOC 1/2/3 (Google Cloud quarterly reports) | cloud.google.com/security/compliance/soc-2 ; Google Workspace blog (SOC compliance for Gemini) |
| Get-a-key link | Google AI Studio API keys | https://aistudio.google.com/app/apikey |

**On the card, Google's training line is stated honestly:**
> "On a paid Gemini key (billing turned on), your prompts are not used to train Google's models. On the free tier they can be, so use a paid key."

Verified: read the Gemini API terms page text (Paid vs Unpaid wording) directly; SOC 2 + encryption from Google Cloud compliance docs + Google Workspace announcement (2026-06-26).

---

## B. Local option ("Keep it on your computer")

Confirmed against the actual Keepance Rust source (not just docs):

| Claim shown | Real value | Source (file:line) |
|---|---|---|
| On-device AI model | **Qwen3-4B-Instruct-2507, Q4_K_M GGUF** | src-tauri/src/commands/local_llm/model_download.rs:19-25 |
| On-device AI size | **2,497,280,736 bytes = ~2.5 GB** (decimal) / 2.33 GiB. Checksum-enforced constant `MODEL_SIZE_BYTES`. | src-tauri/src/commands/local_llm/model_download.rs:24 |
| Private search engine model | **multilingual-e5-small** (384-dim, fastembed) | src-tauri/src/commands/rag/model_download.rs:21-28 |
| Private search size | **~465 MB** total (onnx model ~448 MB). Computed at download time, not a hard constant. | src-tauri/src/commands/rag/model_download.rs:21-28, 463-465 |
| Capability note | Small on-device model: strong at search/retrieval over your files, weaker than big cloud models at long reasoning / complex drafting. | inherent to a 4B local model; honest framing, no benchmark claim made |

**Two honest flags for you to decide on:**
1. **Size wording.** The app's *current* in-app copy says "about 2.4 GB" (src/locales/en.json:804,815). The
   true size is **~2.5 GB decimal (2.33 GiB)**. I used **"about 2.5 GB"** on the card for accuracy. If you
   prefer to match the existing in-app "2.4 GB," tell me and I'll align both (and I'd update en.json too).
2. **Download time.** There is **no existing in-app source** for a download-time figure. I wrote "usually a
   few minutes on a typical connection" as a soft estimate (≈3 GB total; ~4-8 min at 50-100 Mbps). It is an
   estimate I introduced, not a measured/claimed number. Say the word and I'll drop the time entirely or make it firmer.

---

## C. Screen 1 animated icons (Lottie) — license record

Three real animated Lottie icons, all under the **Lottie Simple License** (free, including
commercial use). Verified on each animation's own page; downloaded, de-containered, and
validated as real Lottie JSON ('v' + 'layers'). Full record (direct .lottie URLs, authors) is
in `assets/lottie/SOURCES.md`.

| File | Step | Icon | Source page | License |
|---|---|---|---|---|
| step1.json | Connect your AI and files | dashed nodes connecting (RECOLORED to brand blue) | lottiefiles.com/free-animation/connecting-MfAEXBXvEV (Paphavee Sakdanaraseth) | Lottie Simple License (free) |
| step2.json | Keepance builds Client Maps | network hub / hub-and-spoke (RECOLORED to brand blue) | lottiefiles.com/free-animation/network-7KEcvrCIx4 (Lara) | Lottie Simple License (free) |
| step3.json | Ask anything, with sources | neural-net node graph, circles + lines (RECOLORED to brand blue, to match step1/step2) | lottiefiles.com/free-animation/neural-network-loading-JLFLS47ab1 (Vojta Šára) | Lottie Simple License (free) |

Notes: step2 is heavier (402 KB) and the faintest of the three; a lighter, cleaner node-graph
alternative (also free-licensed) is logged in `assets/lottie/SOURCES.md` if you want a swap.
Style is color-cohesive but not an identical line set (step1/step3 line, step2 sphere). These
are real animated icons for the draft; a designer can swap/recolor to a uniform brand set later.

## Sources (links)
- OpenAI enterprise privacy: https://openai.com/enterprise-privacy/
- OpenAI business data: https://openai.com/business-data/
- Anthropic commercial/API training policy: https://privacy.claude.com/en/articles/7996868
- Anthropic Trust Center: https://trust.anthropic.com/
- Google Gemini API terms (Paid vs Unpaid): https://ai.google.dev/gemini-api/terms
- Google Cloud SOC 2: https://cloud.google.com/security/compliance/soc-2
- Google Workspace blog (SOC compliance for Gemini): https://workspaceupdates.googleblog.com/2024/08/gemini-soc-compliance.html
- Key consoles: OpenAI https://platform.openai.com/api-keys · Anthropic https://console.anthropic.com/settings/keys · Google https://aistudio.google.com/app/apikey
