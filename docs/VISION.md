# Business OS - Vision Document

## Executive Summary

Business OS is a local-first, artifact-driven workspace application designed specifically for solo founders who are starting and building businesses with AI assistance. Unlike typical chat-based AI interfaces, Business OS treats AI as a collaborative tool that produces, manages, and refines tangible business-building artifacts—documents, research, analyses, and strategic outputs—while keeping the human founder firmly in control of all decisions.

The application addresses a critical gap in the founder toolkit: while AI chatbots can answer questions and generate text, they lack the structure, persistence, and auditability that serious business planning requires. Business OS provides a complete workspace where founders can organize their thinking, maintain research with proper citations, run repeatable AI-powered workflows, compare outputs across multiple AI models, and build a traceable record of their strategic evolution.

Built on a modern stack (React, TypeScript, Tauri, CodeMirror 6, SQLite), Business OS prioritizes offline capability, data sovereignty, and reproducibility. Every AI interaction is logged, every output is versioned, and every destructive action requires explicit approval with a diff preview. This is not a toy—it's a professional-grade tool for founders who take their business seriously.

## Vision Statement

**Empower solo founders to build businesses confidently by providing an intelligent, auditable workspace where AI assists but humans decide.**

## Target Audience

**Solo Founders** who are:
- Starting or validating new business ideas
- Building products independently or with small teams
- Using AI tools for research, strategy, and content generation
- Value data ownership and offline capability
- Need structured approach to business planning

## Jobs-to-be-Done

1. **Research and Organize Information**: Founders need to gather, organize, and cite research from multiple sources to build evidence-based strategies.

2. **Generate Strategy Documents**: Creating foundational documents (Vision, PRD, Lean Canvas) that capture and communicate business strategy.

3. **Manage Artifacts**: Organizing, versioning, and connecting documents in a knowledge base with wiki-style linking.

4. **Compare AI Outputs**: Running the same query across multiple AI models to get diverse perspectives and identify contradictions.

5. **Run Repeatable Workflows**: Executing structured processes (like "New Business Kickoff") that can be re-run with updated inputs.

## Primary Goals

1. **Artifact-Driven Workflow**: Replace ephemeral chat with persistent, versioned business documents (Vision, PRD, Lean Canvas, competitor matrices, pricing hypotheses) that form the foundation of strategic decision-making.

2. **"New Business Kickoff" Workflow**: Deliver a guided, AI-assisted interview that generates a complete initial document set for a new business idea, with full run records for reproducibility.

3. **Research with Citations**: Enable founders to capture, organize, and cite sources (SourceCards) so that every claim in their documents can be traced back to evidence, distinguishing fact from assumption.

4. **Multi-Model Comparison**: Allow founders to run the same prompt across Claude, OpenAI, and Gemini, compare outputs side-by-side, detect contradictions, and synthesize reconciled insights.

5. **Local-First with Full Audit**: Ensure all data stays on the founder's machine, all AI actions are logged in an append-only audit trail, and all destructive operations require explicit approval with diff previews.

## Secondary Goals

1. **Custom Workflow Creation**: Enable power users to define their own AI-powered workflows from templates, extending beyond the built-in workflows.

2. **Extensible Search Architecture**: Design the search layer (starting with FlexSearch) to support future semantic/embedding-based search without API changes.

3. **Export-Ready Outputs**: Generate diagrams (Mermaid), charts, and exportable artifacts (SVG, PNG) that can be directly used in pitch decks and presentations.

## Success Criteria (MVP)

- [ ] **Workspace functional**: User can create a workspace, create/rename/delete folders and files, and navigate via file tree and tabs
- [ ] **Editor complete**: CodeMirror 6 Markdown editor with split panes, outline navigation, and wiki-style links working
- [ ] **New Business Kickoff workflow operational**: Interview flow generates VISION.md, PRD.md, and Lean Canvas with run record stored
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
| **Scope creep toward chat UI** | Medium | High | Strict adherence to artifact-driven philosophy; reject features that don't produce persistent outputs; regular vision alignment reviews |
| **Prompt injection from external content** | Medium | High | Sanitize all external content before including in prompts; validate structured outputs against schemas; isolate tool execution |

## Out of Scope

The following are explicitly **NOT** included in this project:

- **Cloud sync**: All data remains local. No server-side storage, no sync between devices.
- **Collaboration**: Single-user application only. No sharing, no real-time co-editing, no team features.
- **Payments/monetization**: No billing, subscriptions, usage limits, or payment processing.
- **Mobile support**: Desktop (via Tauri) and browser only. No iOS or Android builds.
- **Autonomous agents**: AI proposes, human decides. No auto-executing chains, no unsupervised multi-step operations.
- **Web scraping/crawling**: Research sources are manually pasted URLs. No automated web research or content extraction.
- **Voice/audio input**: Text-based interaction only.
- **Real-time external data**: No live market data feeds, stock prices, or API integrations beyond AI model calls.
- **Custom AI fine-tuning**: Uses standard API models only. No training, fine-tuning, or custom model hosting.
- **Plugin/extension system**: Built-in features only for MVP. No third-party plugin architecture.

## Principles

1. **Local-First**: Everything works offline (except optional web research)
2. **User-in-Control**: AI proposes, user decides; all destructive ops require confirmation
3. **Artifact-Driven**: Every interaction produces persistent, versioned documents
4. **Reproducible**: Every workflow run is replayable (inputs, prompts, tool results saved)
5. **Auditable**: Append-only log of all AI actions

---

*This document defines the north star for Business OS. All implementation decisions should be validated against this vision. When in doubt, choose the path that keeps the founder in control and produces auditable, persistent artifacts.*
