# Business OS - Product Requirements Document (PRD)

## Overview

This document defines the complete set of user stories and requirements for Business OS, organized by feature area. Each user story represents a discrete unit of functionality from the user's perspective.

---

## 1. Workspace & Markdown Editing

### 1.1 Workspace Management

**US-1.1.1**: As a user, I want to create a workspace by selecting a local folder as root, so that all my business documents are stored in a location I control and can back up.

**US-1.1.2**: As a user, I want to see my recently opened workspaces, so that I can quickly return to projects I'm working on.

**US-1.1.3**: As a user, I want to create new folders and nested folders in my workspace, so that I can organize my documents hierarchically.

**US-1.1.4**: As a user, I want to rename folders, so that I can correct mistakes or improve organization.

**US-1.1.5**: As a user, I want to move folders via drag-and-drop, so that I can reorganize my workspace structure.

**US-1.1.6**: As a user, I want to delete folders, so that I can remove content I no longer need.

### 1.2 File Management

**US-1.2.1**: As a user, I want to create new Markdown files, so that I can add new documents to my workspace.

**US-1.2.2**: As a user, I want to rename Markdown files, so that I can correct mistakes or improve naming.

**US-1.2.3**: As a user, I want to move files via drag-and-drop, so that I can reorganize my workspace.

**US-1.2.4**: As a user, I want to delete files, so that I can remove content I no longer need.

**US-1.2.5**: As a user, I want drag-and-drop files to automatically organize them based on rules, so that my workspace stays tidy.

### 1.3 Editor Features

**US-1.3.1**: As a user, I want to open multiple files in tabs, so that I can work on several documents simultaneously.

**US-1.3.2**: As a user, I want to view multiple files side-by-side in split panes, so that I can reference one document while editing another.

**US-1.3.3**: As a user, I want to jump to headings via an outline view, so that I can quickly navigate long documents.

**US-1.3.4**: As a user, I want full-text search across all files (titles + content + tags), so that I can find information quickly.

**US-1.3.5**: As a user, I want to create wiki-style links between documents using `[[link]]` syntax, so that I can connect related ideas.

**US-1.3.6**: As a user, I want to see backlinks showing which documents link to the current one, so that I can understand how my ideas connect.

---

## 2. Safety, History, and Audit

### 2.1 Diff Preview

**US-2.1.1**: As a user, I want to preview diffs before accepting AI edits, so that I understand what changes will be made.

**US-2.1.2**: As a user, I want to accept or reject proposed changes after seeing the diff, so that I maintain control over my documents.

### 2.2 Undo/Redo

**US-2.2.1**: As a user, I want to undo file operations, so that I can recover from mistakes.

**US-2.2.2**: As a user, I want to redo previously undone operations, so that I can restore changes if I undo too much.

### 2.3 Trash & Recovery

**US-2.3.1**: As a user, I want deleted files to go to a trash folder instead of being permanently removed, so that I can recover them if needed.

**US-2.3.2**: As a user, I want to restore files from trash, so that I can recover accidentally deleted content.

**US-2.3.3**: As a user, I want to permanently delete files from trash, so that I can free up space when certain.

### 2.4 Audit Log

**US-2.4.1**: As a user, I want an audit log of AI actions (what, when, why, which model), so that I can track and review all AI-generated changes.

**US-2.4.2**: As a user, I want to filter the audit log by date, model, and action type, so that I can find specific entries.

**US-2.4.3**: As a user, I want to export the audit log, so that I can keep records or analyze AI usage.

### 2.5 File Locking

**US-2.5.1**: As a user, I want to lock files as read-only, so that important documents cannot be accidentally modified.

---

## 3. Workflows & Runs

### 3.1 Workflow Execution

**US-3.1.1**: As a user, I want to run the "New Business Kickoff" workflow (interview → generate docs), so that I can quickly create foundational business documents.

**US-3.1.2**: As a user, I want to re-run a workflow with updated answers, so that I can iterate on my business strategy.

**US-3.1.3**: As a user, I want to see what changed between workflow runs, so that I can track how my thinking evolves.

### 3.2 Run Records

**US-3.2.1**: As a user, I want to view RunRecords showing inputs, outputs, model used, prompts, and tool calls, so that I can understand and reproduce any workflow run.

**US-3.2.2**: As a user, I want to see the cost and duration of each run, so that I can track my AI usage.

### 3.3 Custom Workflows

**US-3.3.1**: As a user, I want to create custom workflows from templates, so that I can define my own repeatable processes.

### 3.4 Business Stage Tags

**US-3.4.1**: As a user, I want to tag documents by business stage (idea/validation/build/launch), so that I can organize content by project phase.

---

## 4. Research & Evidence

### 4.1 Source Cards

**US-4.1.1**: As a user, I want to save a SourceCard from a URL (title/date/snippet/notes), so that I can capture research with proper attribution.

**US-4.1.2**: As a user, I want to attach source cards to claims in my documents, so that I can support statements with evidence.

**US-4.1.3**: As a user, I want to filter research by topic/competitor/market/reliability, so that I can find relevant sources quickly.

### 4.2 Competitor Analysis

**US-4.2.1**: As a user, I want to generate a competitor matrix linked to sources, so that I can visualize competitive landscape with evidence.

### 4.3 Assumption Tracking

**US-4.3.1**: As a user, I want statements to be marked as "assumption" when unsourced, so that I can distinguish fact from speculation.

---

## 5. Multi-Model Support

### 5.1 API Key Management

**US-5.1.1**: As a user, I want to configure Claude/OpenAI/Gemini via API keys, so that I can use multiple AI models.

**US-5.1.2**: As a user, I want my API keys stored securely in the OS keychain, so that my credentials are protected.

### 5.2 Model Selection

**US-5.2.1**: As a user, I want to choose which models participate in a workflow, so that I can select the best model for each task.

**US-5.2.2**: As a user, I want to see cost/latency estimates per run, so that I can make informed decisions about which model to use.

### 5.3 Model Comparison

**US-5.3.1**: As a user, I want to run the same prompt across multiple models, so that I can compare their outputs.

**US-5.3.2**: As a user, I want to see model outputs side-by-side, so that I can evaluate differences easily.

---

## 6. Cross-Analysis & Synthesis

### 6.1 Document Summaries

**US-6.1.1**: As a user, I want to generate a schema-validated DocSummary for key documents, so that I can get structured insights from my content.

### 6.2 Model Comparison

**US-6.2.1**: As a user, I want to compare model summaries side-by-side, so that I can see how different models interpret my documents.

### 6.3 Contradiction Detection

**US-6.3.1**: As a user, I want the system to auto-detect contradictions between model outputs, so that I can identify disagreements.

**US-6.3.2**: As a user, I want contradictions highlighted visually, so that I can easily spot and address them.

### 6.4 Synthesis

**US-6.4.1**: As a user, I want to generate a reconciled synthesis document with citations and uncertainty flags, so that I can combine multiple perspectives into a coherent view.

**US-6.4.2**: As a user, I want to export decision log updates from synthesis, so that I can track how decisions were made.

---

## 7. Templates & Outputs

### 7.1 Business Templates

**US-7.1.1**: As a user, I want templates for Lean Canvas, PRD, positioning doc, pricing hypotheses, and experiment plan, so that I have structured formats for common business documents.

### 7.2 Customer Research Templates

**US-7.2.1**: As a user, I want templates for customer interview scripts, screeners, outreach messages, and note templates, so that I can conduct structured customer research.

### 7.3 Marketing Templates

**US-7.3.1**: As a user, I want templates for landing page copy variants and objection-handling FAQ, so that I can create marketing content efficiently.

### 7.4 Investor Templates

**US-7.4.1**: As a user, I want templates for pitch deck outline and narrative memo, so that I can prepare for investor conversations.

---

## 8. Visuals

### 8.1 Diagram Generation

**US-8.1.1**: As a user, I want to generate Mermaid diagrams from document content, so that I can visualize concepts and processes.

**US-8.1.2**: As a user, I want to generate charts from structured inputs, so that I can visualize data.

### 8.2 Export

**US-8.2.1**: As a user, I want to export diagrams as SVG/PNG, so that I can use them in presentations and external documents.

**US-8.2.2**: As a user, I want to link exported visuals into Markdown, so that diagrams appear inline in my documents.

---

## Non-Functional Requirements

### Performance
- Initial page load < 3 seconds
- File tree renders < 1 second for 1000+ files
- Editor responsive for documents up to 100KB
- Search returns results < 500ms

### Security
- All paths validated against workspace root
- API keys stored in OS keychain (encrypted fallback)
- Audit log is append-only (no deletions)
- External content sanitized before prompt inclusion

### Accessibility
- All interactive elements keyboard accessible
- WCAG AA color contrast
- Screen reader labels for non-text content

### Offline Capability
- Full functionality without internet (except AI calls)
- Graceful degradation when offline
- No data loss on network interruption

---

*This PRD should be updated as new requirements are discovered or existing requirements are refined.*
