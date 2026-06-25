# Local AI for Keepance: Research, Decision, and Implementation Plan

**Date:** 2026-06-25
**Author:** Claude (senior staff engineer / lead technical research), for Jameson
**Status:** DECISION — approved by Jameson 2026-06-25 ("go with all recommendations"). Build is GREEN; production ship to paying customers still gated on Jameson's explicit go (per the no-autonomous-deploy rule).
**Cross-checks:** Independent OpenAI Codex review (model picks + engine call) + a fact-checked multi-source web study (24 sources, 103 claims, top 25 adversarially verified, 23 confirmed) + a full read of the Keepance codebase.
**Supersedes:** the inconsistent current guidance (app defaults to `llama3.2:3b`; `website/local-model-setup/index.html` recommends `llama3.1:8b`). After this lands, both should speak one story.

---

## 0. TL;DR

- **Default local model → `Qwen3-4B-Instruct-2507`, Q4_K_M GGUF.** ~2.5 GB on disk, ~5–6 GB RAM to run with a 16K context, runs CPU-only on the 16GB-laptop bar, **Apache-2.0 (verified — free to bundle/redistribute)**, 262K context window (far beyond our need). It is one of the most *faithful* small models measured (~5.7% hallucination on Vectara's leaderboard), and the leading open faithfulness-checker (HalluGuard) is built on it. Both independent reviews converged on it.
- **"Trust-brand" alternative → IBM Granite 3.x Instruct** (Apache-2.0, US enterprise brand, purpose-built for cited RAG). Bigger/slower (8B-class, ~4.9 GB). Offered as a one-click "prefer a US enterprise model" switch for advisors who react to model provenance.
- **"Sharper but slower" option → Qwen2.5-7B-Instruct** (Apache-2.0, best small-model table handling). **"Fast / old-laptop" floor → Llama 3.2 3B** (our current default, demoted).
- **AVOID for grounded answers:** Phi-4-mini (clean MIT license but ~23.5% hallucination — ~4× our pick) and Llama-3.1-8B (~28% hallucination, worst tested).
- **Delivery → EMBED `llama.cpp` (MIT) directly in Keepance.** One-click local AI, no separate Ollama install. Keep "connect my own Ollama" as an advanced setting. Model ships as a visible, resumable, integrity-checked first-run download (reuse the e5-small `model_download.rs` pattern).
- **Honest limits:** local is meaningfully worse than cloud at grounded faithfulness (2–4× more hallucination; 12–23 pt gap on faithfulness benchmarks). RAG reduces but never eliminates it. Spreadsheet/number reasoning is the weakest area for *every* model (even Claude 3.5 Sonnet tops out ~77% on a real spreadsheet benchmark). Design around these; don't pretend them away.

---

## 1. The job the local model actually has to do

Keepance's local RAG pipeline already does the hard part with **no LLM brainpower**:

1. The Rust backend (`src-tauri/src/commands/rag/`) embeds every file (PDF via PDF.js + OCR, Word/Excel/PowerPoint natively) with **fastembed / multilingual-e5-small** (384-dim, CPU ONNX) into **LanceDB** at `<workspace>/.keepance/vectors/`.
2. On a query, it retrieves the **top 8 chunks** (`DEFAULT_WORKSPACE_TOP_K = 8`, `src/platform/rag/workspaceCommand.ts:39`), ~384 tokens each → roughly **3,000–6,000 tokens** of context after the envelope/history.
3. It wraps them in a prompt-injection-guarded `<workspace_context>` block instructing: *answer only from context, cite inline as `[filename paragraph N]`* (`buildWorkspaceContextBlock`, `workspaceCommand.ts:115`).
4. It sends that to the chosen provider with **output capped at 4,096 tokens** (`useChatSending.ts:1305`).

**Implication for model choice:** the LLM is doing *grounded reading comprehension with citations over ~8 short passages*, not open-ended reasoning. The differentiator between models on this task is **faithfulness** (does it stick to the passages?), **not raw size/intelligence**. This is why a lean 4B model is sufficient — and why faithfulness, not parameter count, drove the pick.

**Existing assets that are exactly right (keep + strengthen):**
- `rag_verify_citation` (`src-tauri/src/commands/rag/mod.rs:2091`) checks every emitted citation against the real files and flags fakes.
- The "Avianca trap" guard refuses to answer when retrieval fails rather than bluffing (`useChatSending.ts:369-393`).
- `normalizeNumericCitations` (`workspaceCommand.ts:214`) repairs sloppy `[1]`-style citations from small models.
The research independently recommends exactly this shape (small generator + verifier pass + citation-or-refuse). We were already on the right track.

---

## 2. Current state in the code (what we're changing)

| Item | Today | Reference |
|---|---|---|
| Local generative path | External Ollama daemon only (no embedded engine) | `src/platform/providers/OllamaProvider.ts` |
| Default local model | `llama3.2:3b` | `OllamaProvider.ts:46` |
| Website recommends | `llama3.1:8b` (Mistral 7B backup) — **inconsistent** | `website/local-model-setup/index.html:221` |
| **Context-window bug** | `OllamaProvider` sets `num_predict` (output) but **never `num_ctx`** → input context can silently truncate at Ollama's default (often 2–4K), throwing away retrieved chunks | `OllamaProvider.ts:254-258`; `context-limits.ts` `getMaxContextTokens` is UI-only |
| Local-only enforcement | Real, fail-closed | `localOnlyGuard.ts`, `egress.ts` |
| Model download pattern | Resumable, visible, fail-fast (e5-small) — reusable for the GGUF | `src-tauri/src/commands/rag/model_download.rs` |
| Sidecar precedent | Piper TTS bundled as Tauri `externalBin` | `tauri.conf.json:81-83`, `src-tauri/src/sidecars/` |

---

## 3. The three worries, quantified

Jameson's stated priors: local models are (a) large to store, (b) resource-intensive, (c) weak reasoners. All true in degree; the degree is the story.

### (a) Size — bounded; our pick is a one-time ~2.5 GB download
"Quantization" (Q4_K_M ≈ 4 bits/weight) more than halves size at minor quality cost. Verified Q4_K_M on-disk sizes (Codex pulled these directly from the model repos):

| Model | Q4_K_M size |
|---|---|
| Llama 3.2 1B / 3B | ~0.8 GB / **2.02 GB** |
| **Qwen3-4B-Instruct-2507** | **2.50 GB** |
| Phi-4-mini 3.8B | 2.49 GB |
| Gemma 3 4B | 2.49 GB |
| Qwen2.5-7B | ~4.7 GB |
| Llama 3.1 8B | 4.92 GB |
| IBM Granite 3.2 8B | 4.94 GB |

### (b) Resources — memory fine on 16GB; the real cost is speed
- **RAM:** ~5–6 GB to run a 4B at Q4 with a 16K context. Fits 16GB with headroom. (Caution: the RAG indexer has hit OOM on low-RAM machines — BUG-099/F-501 — so the 16GB bar is what makes co-residence with the indexer safe; on 8GB we'd fall back to the smallest model or cloud.)
- **No GPU required** (CPU-only ONNX/llama.cpp).
- **Speed is the genuine trade for privacy.** CPU generation: ~8–16 tok/s for a 4B (≈ slightly slower than reading speed); ~4–9 tok/s for 7B/8B; ~25–45 tok/s for Llama 3.2 3B. Plus a **prefill delay**: reading a 16K-token prompt can take seconds to ~a minute on older laptops before the first token. Set this expectation in the UI.

### (c) Reasoning — weak in general, but our task needs *faithfulness*, which the best small models now do well
Faithfulness varies enormously **at the same size**, proving size isn't the lever. Vectara HHEM hallucination rates (lower = better): **Qwen3-4b 5.7%**, Gemma-3-4b 6.4%, Ministral-3b 7.3%, **Phi-4-mini 23.5%**. The one place reasoning weakness truly bites is **numbers/tables** (§5).

---

## 4. Model comparison (scored for Keepance's job)

| Model | Maker | Size (Q4) | RAM | CPU speed | Faithfulness (for size) | Tables | Bundleable? | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Qwen3-4B-Instruct-2507** | Alibaba (CN) | 2.5 GB | ~5–6 GB | ~8–16 t/s | **Best** (~5.7% halluc.) | Good | **Apache-2.0 ✓** | ⭐ **Default** |
| **IBM Granite 3.x 8B** | IBM (US) | 4.9 GB | ~7–8 GB | ~4–8 t/s | Good; purpose-built cited RAG | Solid | **Apache-2.0 ✓** | ⭐ **Trust-brand alt** |
| Qwen2.5-7B | Alibaba (CN) | 4.7 GB | ~6–7 GB | ~4–9 t/s | Stronger than 4B | **Very good** | Apache-2.0 ✓ | "Sharper/slower" mode |
| Llama 3.2 3B | Meta (US) | 2.0 GB | ~4–5 GB | **~25–45 t/s** | Weak/brittle | Weak–OK | Llama license (conditions) | Speed floor only |
| Gemma 3 4B | Google (US) | 2.5 GB | ~5–6 GB | ~7–14 t/s | Good (~6.4%) | Good | Gemma terms (conditions + remote-restrict) | Avoid bundling |
| Phi-4-mini 3.8B | Microsoft (US) | 2.5 GB | ~5–6 GB | ~8–15 t/s | **Poor (~23.5%)** | OK | MIT (cleanest) | ❌ Avoid for grounded |
| Llama 3.1 8B | Meta (US) | 4.9 GB | ~7–8 GB | ~4–8 t/s | **Worst (~28%)** | OK | Llama license | ❌ Don't default |

**Reviewer disagreement, resolved:** Codex favored Phi-4-mini as a backup for its clean MIT license + reasoning. The fact-checked study showed Phi-4-mini is among the *worst* small models at faithfulness (~4× our pick). For cited financial-document answers, a clean license on a model that fabricates is a bad trade — **rejected Phi-4-mini.** (This is the concrete payoff of running two independent reviewers.)

### The provenance question (a real product call, decided)
Qwen is made by Alibaba (China). **Technically a non-issue**: once embedded, the model runs fully offline with no network access — it physically cannot exfiltrate (frozen weights doing local arithmetic; no telemetry path because we grant none). For a privacy product this is even a selling point ("can't leak, by construction"). **But** some advisors may react to "Chinese AI" regardless. **Decision:** ship **Qwen3-4B as default**, expose **IBM Granite as a first-class one-click alternative** ("prefer a US enterprise model"), accepting Granite's larger/slower footprint. (Jameson's lean; approved.)

---

## 5. The honest gap: local vs cloud (shapes positioning, not the decision)

- **Hallucination:** small open models make things up ~**2–4×** more than frontier cloud, or sit **12–23 points** lower on faithfulness benchmarks. FaithBench/RAGTruth: Llama-3.1-8B 28.38% vs GPT-4o 15.85%, Claude-3.7 16.05%, Gemini-2.5-Pro 6.65%. FaithJudge: GPT-4o 79.5 vs Qwen-2.5-7B 71.9, Llama-3.1-8B 60.8. Our pick narrows but doesn't close this.
- **RAG helps, never fixes:** even with the right passages, models add unsupported details or contradict the source. No setting takes hallucination to zero.
- **"Fail silently":** wrong answers still sound confident and may carry a citation — a confident-wrong-with-citation answer is *more* dangerous than an obvious error. This is the core liability for advisor software.
- **Tables/spreadsheets = worst case for everyone:** MiMoTable (428 real spreadsheets) — best frontier model Claude 3.5 Sonnet only **77.4%**, declining with difficulty. A small local model is below that. **Design rule: don't let the LLM do arithmetic on raw tables.** Extract cells deterministically in Rust, compute totals in code, hand the model *computed facts* to explain.

**Positioning:** present local as the *"maximum-privacy, slightly-less-sharp"* option, keep the citation/refuse rails on, and make uncertainty visible. Frame the product as *"answers from your documents,"* never *"financial advice."*

---

## 6. Delivery: embed llama.cpp (not "install Ollama")

| | Today (Ollama) | Decision: embed llama.cpp |
|---|---|---|
| Setup | User installs a 2nd program (~3.25 GB Windows release — too big to bundle), runs a command, connects it | One product, one click; ~2.5 GB model fetched once in background |
| Control | We don't control model file, prompt format, **context length**, stop tokens, updates | We own all of it (fixes the `num_ctx` truncation bug by construction) |
| License | n/a | llama.cpp = **MIT** (free to bundle) |

**Decision:** embed `llama.cpp` as the default local experience; keep "connect my own Ollama server" as an advanced option for power users. Engine integration approach (sidecar binary vs linked Rust crate such as `llama-cpp-2`), cross-platform CPU build, and Provider wiring are being scoped by a Codex spike (see §8); the robust choice will be appended here before implementation.

---

## 7. Risk register (the wide net)

1. **Confident-wrong answers / liability** → keep citation-check + refuse-if-ungrounded; add a second "does this match the sources?" verifier pass; frame as "answers from your documents."
2. **Fake/mismatched citations** → `rag_verify_citation` already verifies; tighten to regenerate/flag on failure.
3. **Spreadsheet math** → compute in code, not in the model (§5).
4. **Licensing to bundle weights** → bundle only Apache-2.0/MIT (Qwen3 ✓ verified, Granite ✓, Qwen2.5-7B ✓, llama.cpp ✓). Avoid Gemma default (Google reserves remote-restriction) and Llama default (attribution/naming conditions). File the Qwen3-4B Apache-2.0 license snapshot with the release.
5. **Multi-GB download + updates** → visible, resumable, never block the app; reuse `model_download.rs`. Plan model updates the same way.
6. **Integrity/security of model file** → verify checksum/signature on download (a GGUF is data, but treat supply chain seriously).
7. **Speed/heat/battery** → sustained generation runs the CPU hard; avoid continuous hammering; consider a "plugged-in recommended" hint for heavy use.
8. **Memory headroom** → ensure model + indexer don't both spike (history of OOM on low RAM). 16GB bar makes co-residence safe; 8GB → smallest model or cloud fallback.
9. **Privacy trust must be airtight + visible** → model download, update checks, crash reports, telemetry all explicit + controllable; the embedded engine must honor local-only mode perfectly (zero surprise network calls) and the egress indicator.
10. **Field moves fast** → treat the model as a swappable part so we can upgrade the default in a release without re-architecting.

---

## 8. Implementation plan (robustness-first, sequenced)

Core-app rule: **no shortcuts, robust over minimal, TDD, real verification, no autonomous production deploy.** Smallest safe increments first; each independently testable; ends at a real-Windows bench.

| # | Step | Risk | Gate |
|---|---|---|---|
| 1 | **Confirm model + license** (Qwen3-4B Apache-2.0 ✓ verified 2026-06-25; pick Qwen default + Granite alt ✓) | none | DONE |
| 2 | **Fix the `num_ctx` truncation bug** in the existing Ollama path (set context window to cover retrieved tokens; test that context isn't silently dropped) | low | `npm run gate` green + unit test |
| 3 | **Real-world bench** Qwen3-4B vs Llama 3.2 3B on the Legion (Windows) against the demo advisor file set — measure speed, RAM, answer/citation quality | low (read-only eval) | Bench numbers recorded in this doc |
| 4 | **Codex spike → embedded llama.cpp design** (sidecar vs `llama-cpp-2` crate; download+integrity; Provider wiring; cross-platform CPU build; CI matrix) | design only | Design appended here |
| 5 | **Build embedded llama.cpp provider** behind the existing `Provider` interface, model auto-download (reuse `model_download.rs`), correct `n_ctx`, streaming, structuredOutput, local-only guard honored | high (core) | TDD + `npm run gate` + Win/Mac build |
| 6 | **Spreadsheet path:** deterministic extraction/compute → feed computed facts to the model | medium | Tests + bench on demo spreadsheets |
| 7 | **Reconcile public story:** update `website/local-model-setup` + onboarding copy to one model story | low | Site deploy |
| 8 | **Real-Windows + Mac verification**, then **PAUSE for Jameson's explicit go** before any signed/customer build | gate | Jameson go |

Tracking: add a pointer in `BACKLOG.md`; update this doc's §6/§8 as the Codex spike and bench land.

---

## Appendix A — methodology & honesty

- **Web study:** 6 angles, 24 sources, 103 claims, top 25 adversarially re-verified by independent voters (23 confirmed, 2 killed). Primary sources include the Vectara hallucination leaderboard, FaithBench/RAGTruth (arXiv 2505.04847), HalluGuard (arXiv 2510.00880), MiMoTable (arXiv 2412.11711 / 2506.17330), and the official Meta/Google/Qwen/IBM license pages.
- **Codex cross-check (gpt-5.5):** independently picked Qwen3-4B as default, verified Q4_K_M file sizes from the repos, recommended embedding llama.cpp. Differed on Phi-4-mini (overruled, §4).
- **Two claims deliberately discarded for honesty:** (1) "small models *beat* GPT-4o/Claude on faithfulness" — refuted 1-2 as cherry-picked; safe assumption remains "small is meaningfully worse." (2) "RAG drove a local model's hallucinations to literal 0%" — refuted 1-2; RAG helps but never eliminates.
- **Biggest evidence gap:** most faithfulness numbers measure close cousins (faithful summarization, or hallucination *detection*), not the exact "generate inline-cited answers over advisor files" task. Rankings are a reliable guide; step 3 (real bench) converts them to facts for our specific use before the big build.

## Appendix B — key sources
- Vectara Hallucination Leaderboard — https://github.com/vectara/hallucination-leaderboard
- FaithBench/RAGTruth — https://arxiv.org/abs/2505.04847
- HalluGuard (Qwen3-4B faithfulness detector) — https://arxiv.org/pdf/2510.00880
- MiMoTable spreadsheet benchmark — https://arxiv.org/abs/2412.11711 · https://arxiv.org/pdf/2506.17330
- Qwen3-4B-Instruct-2507 (Apache-2.0, 262K ctx) — https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507
- IBM Granite RAG (Apache-2.0) — https://huggingface.co/ibm-granite/granite-rag-3.0-8b-lora
- Llama 3.3 Community License — https://www.llama.com/llama3_3/license/
- Gemma Terms — https://ai.google.dev/gemma/terms
- Qwen2.5 (license/sizes; 3B is non-commercial) — https://qwenlm.github.io/blog/qwen2.5/
- llama.cpp (MIT) — https://github.com/ggml-org/llama.cpp

*Plain-language version for Jameson published at jameworld.com/claudereports (2026-06-25).*
