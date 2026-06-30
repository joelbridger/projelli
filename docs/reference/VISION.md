# Advisor Prep Hero — Vision Document

> **⚠️ Audience update (2026-06-23 / 2026-06-29).** This doc was written when the ICP
> was "attorneys, CPAs, and consultants" (locked 2026-05-27). Since then Advisor Prep Hero
> **re-aimed to financial advisors** as the lead audience (solo/small RIA practices),
> with law, tax, and consulting kept as **secondary** verticals; the 2026-06-29 board
> decision set the direction to compete head-on as the leading advisor-AI — a simple
> AI-first app (connect files → ask cited questions → living Client Map), not a
> note-taker. The confidentiality thesis below still holds; it just maps to advisors'
> obligations (Reg S-P, Reg BI; the unit is a client/household) as cleanly as it did to
> privilege / IRC §7216. For current positioning read `docs/strategy/2026-06-23-reaim-to-financial-advisors.md`
> and `docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md`. Read the rest of
> this doc with "advisors first, the named professions second" in mind.
>
> **It is also a HISTORICAL snapshot on the specifics — don't trust its details.** The
> named tech stack (CodeMirror/SQLite, FlexSearch, Mermaid) and the "out of scope" list
> below are outdated: the editor is now Word-native (OOXML `.docx` + TipTap), storage is
> SQLCipher + LanceDB + minisearch (no FlexSearch), and several things it calls out-of-scope
> have since shipped (voice input, paid subscriptions, and end-to-end-encrypted firm cloud
> sync). For the current feature set read `docs/reference/FEATURES.md`; for the current
> stack read the repo-root `CLAUDE.md` (§ Technology Stack) + `ARCHITECTURE.md`. Treat the
> rest of this file as vision narrative, not a current spec.

## Executive Summary

Advisor Prep Hero is a local-first, artifact-driven workspace application designed specifically for attorneys, CPAs, and consultants who cannot use cloud AI due to confidentiality obligations. Unlike typical chat-based AI interfaces, Advisor Prep Hero treats AI as a collaborative tool that produces, manages, and refines tangible work artifacts — documents, research, analyses, and strategic outputs — while keeping the professional firmly in control of all decisions.

The application addresses a critical gap in the professional services toolkit: while AI chatbots can answer questions and generate text, they pipe confidential client data to vendor servers, creating real exposure under attorney-client privilege (ABA Formal Opinion 512), IRC §7216, and professional NDA obligations. Advisor Prep Hero provides a complete workspace where professionals can organize client work, maintain research with proper citations, run repeatable AI-powered workflows, and build a traceable record of their work — without any client data ever leaving their machine.

Built on a modern stack (React, TypeScript, Tauri, CodeMirror 6, SQLite), Advisor Prep Hero prioritizes offline capability, data sovereignty, and reproducibility. Every AI interaction is logged, every output is versioned, and every destructive action requires explicit approval with a diff preview. This is not a toy — it's a professional-grade tool for attorneys, CPAs, and consultants who take their confidentiality obligations seriously.

## Vision Statement

**Give attorneys, CPAs, and consultants a local-first AI workspace where every conversation produces persistent, editable files on their own machine — and no client data ever touches a vendor's cloud.**

## Target Audience

**Attorneys, CPAs, and consultants** who are:
- Solo practitioners or small-firm professionals
- Bound by confidentiality obligations (privilege, §7216, NDA) that bar uploading client files to cloud AI services
- Using or interested in AI tools for drafting, research, and workflow automation
- Value data ownership and the ability to work offline
- Need a structured, auditable approach to client document management

## ICP (locked 2026-05-27)

| Segment | Lead obligation | Channel |
|---|---|---|
| Solo + small-firm attorneys (general + patent) | ABA Formal Opinion 512, U.S. v. Heppner (SDNY Feb 2026) | ABA TECHSHOW, Lawyerist, Above the Law, IPWatchdog, r/LawFirm |
| Tax preparers / CPAs / EAs | IRC §7216 | AICPA, NAEA, r/taxpros |
| Independent strategy consultants + boutique agencies | Client NDA obligations | Umbrex, Lenny's Newsletter |

## Jobs-to-be-Done

1. **Draft client-facing documents without cloud exposure**: Professionals need to produce memos, briefs, letters, reports, and engagement documents using AI without uploading client data to OpenAI, Anthropic, or Google servers.

2. **Research and organize confidential information**: Gathering, organizing, and citing research from multiple sources to build evidence-based strategies — all stored locally.

3. **Manage client work artifacts**: Organizing, versioning, and connecting documents in a knowledge base with wiki-style linking, across multiple client workspaces.

4. **Run repeatable profession-specific workflows**: Executing structured processes (like "Matter Intake", "Tax Engagement Kickoff", "Consulting SOW Draft") that can be re-run with updated inputs and produce a full audit trail.

5. **Demonstrate AI governance to clients**: Producing an append-only log of every AI action that can be shown to a client or regulator as evidence of responsible AI use.

## Primary Goals

1. **Artifact-Driven Workflow**: Replace ephemeral chat with persistent, versioned client work documents that form the foundation of professional service delivery.

2. **Profession-Specific Workflow Packs**: Deliver guided, AI-assisted interviews that generate complete document sets for attorney, CPA, and consultant workflows, with full run records for reproducibility.

3. **Research with Citations**: Enable professionals to capture, organize, and cite sources (SourceCards) so that every claim in their documents can be traced back to evidence.

4. **Multi-Model Comparison**: Allow professionals to run the same prompt across Claude, OpenAI, and Gemini, compare outputs side-by-side, detect contradictions, and synthesize reconciled insights.

5. **Local-First with Full Audit**: Ensure all data stays on the professional's machine, all AI actions are logged in an append-only audit trail, and all destructive operations require explicit approval with diff previews.

## Secondary Goals

1. **Custom Workflow Creation**: Enable power users to define their own AI-powered workflows from templates, extending beyond the built-in profession packs.

2. **Extensible Search Architecture**: Design the search layer (starting with FlexSearch) to support future semantic/embedding-based search without API changes.

3. **Export-Ready Outputs**: Generate diagrams (Mermaid), charts, and exportable artifacts (SVG, PNG) that can be directly used in client deliverables.

## Success Criteria (MVP)

- [ ] **Workspace functional**: User can create a workspace, create/rename/delete folders and files, and navigate via file tree and tabs
- [ ] **Editor complete**: CodeMirror 6 Markdown editor with split panes, outline navigation, and wiki-style links working
- [ ] **Profession-specific workflow operational**: Interview flow generates client-ready documents with run record stored
- [ ] **Multi-model support**: At least Claude and OpenAI adapters functional with API key storage in OS keychain
- [ ] **History and safety**: Undo/redo, soft delete with trash, diff preview for all destructive operations
- [ ] **Audit trail**: All AI actions logged in append-only audit log with model, inputs, outputs, and timestamps
- [ ] **Research citations**: SourceCards can be created, attached to claims, and filtered by topic
- [ ] **Security validated**: Path traversal and symlink escape attacks blocked, tested and verified
- [ ] **Cross-analysis functional**: DocSummary generation, multi-model comparison, and contradiction detection working
- [ ] **Desktop packaging**: Tauri build produces working Windows executable

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **API key security compromise** | Medium | High | Use OS keychain as primary storage; encrypted fallback; never persist in plaintext; audit all API key access |
| **Path traversal vulnerability** | Medium | High | Implement strict workspace root allowlist; block all `../` patterns; deny symlinks escaping root; comprehensive security tests |
| **CodeMirror 6 integration complexity** | Medium | Medium | Start with basic editor; add features incrementally; use proven patterns from Obsidian community |
| **Multi-model API differences** | High | Medium | Design Provider interface abstractly; implement adapters incrementally; comprehensive error handling for each provider |
| **SQLite + file hybrid complexity** | Medium | Medium | Clear separation of concerns; files are source of truth; SQLite is index/metadata only; rebuild index if corrupted |
| **Tauri + web dual-target maintenance** | Medium | Medium | Abstract filesystem operations behind interface; test both backends in CI; prioritize web for rapid iteration |
| **Profession-specific legal accuracy** | High | High | All Legal Practice pack content reviewed by a bar-active attorney before ship; Tax Practice pack reviewed by CPA/EA; citations verified before use in marketing copy |
| **Prompt injection from external content** | Medium | High | Sanitize all external content before including in prompts; validate structured outputs against schemas; isolate tool execution |

## Out of Scope

The following are explicitly **NOT** included in this project:

- **Cloud sync**: All data remains local. No server-side storage, no sync between devices.
- **Collaboration**: Single-user application only. No sharing, no real-time co-editing, no team features (Practice tier allows up to 5 seats with separate local workspaces).
- **Payments/monetization**: No billing, subscriptions, usage limits, or payment processing.
- **Mobile support**: Desktop (via Tauri) and browser only. No iOS or Android builds.
- **Autonomous agents**: AI proposes, human decides. No auto-executing chains, no unsupervised multi-step operations.
- **Web scraping/crawling**: Research sources are manually pasted URLs. No automated web research or content extraction.
- **Voice/audio input**: Text-based interaction only.
- **Real-time external data**: No live market data feeds, stock prices, or API integrations beyond AI model calls.
- **Custom AI fine-tuning**: Uses standard API models only. No training, fine-tuning, or custom model hosting.
- **Plugin/extension system**: Built-in features only for MVP. No third-party plugin architecture.

## Principles

1. **Local-First**: Everything works offline (except AI calls). Client data never leaves the machine.
2. **Professional-in-Control**: AI proposes, professional decides; all destructive ops require confirmation.
3. **Artifact-Driven**: Every interaction produces persistent, versioned documents.
4. **Reproducible**: Every workflow run is replayable (inputs, prompts, tool results saved).
5. **Auditable**: Append-only log of all AI actions — demonstrable to clients and regulators.
6. **BYOK Forever**: Advisor Prep Hero never holds AI keys, never sees user data, never charges for inference.

---

*This document defines the north star for Advisor Prep Hero. All implementation decisions should be validated against this vision. When in doubt, choose the path that keeps the professional in control and produces auditable, persistent artifacts.*
