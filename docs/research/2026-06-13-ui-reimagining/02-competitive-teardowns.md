# Stream B — Competitive & Reference UI Teardowns

**Part of:** Keepance UI Reimagining · Phase 1 (Deep UX Research) · 2026-06-13
**Question:** What interaction and IA conventions do litigation attorneys already know (from the tools they live in and the legal-AI products they're sold), so Keepance can reuse them and "the software disappears"?
**Method:** Web research (published product docs, help centers, UX writeups, reviews). Every claim cited. Items that could not be independently verified are flagged.

> This is one of five research streams feeding the capstone `UX-RESEARCH-AND-PRINCIPLES.md`. It strongly validates a **matter-centric, cited-answer-first** direction and supplies concrete, source-backed patterns.

---

## Executive takeaways (the load-bearing conventions)

1. **Matter is the organizing spine** (Clio, iManage, NetDocuments). Every object hangs off a matter. The word must be **"matter"** — never project/workspace/case.
2. **Persistent left-rail nav with Matters at the top.** All five daily tools share a left rail; in Clio/iManage, Matters is the primary item.
3. **Three-panel layout (nav / list / detail)** within a matter — Outlook/iManage/NetDocuments muscle memory.
4. **Tracked changes as the canonical redline model** (Word, Spellbook). AI edits appear as standard Word tracked changes **under the attorney's name**, per-change + bulk accept/reject. This is a correctness requirement, not a preference.
5. **Numbered inline citations with hover-glance → click-deep-view** (M365 Copilot, Perplexity, Harvey). The citation is the product's core trust mechanism; it must be always visible and point to the exact passage.
6. **Tabular results with sortable/filterable columns** for multi-document analysis (Clio, CoCounsel, Harvey review tables). Not card grids, not kanban.
7. **Named skills/actions library** (CoCounsel) — the attorney selects "Spot deposition contradictions," she does not prompt-engineer.
8. **Document profile metadata** (client/matter/author/type/date) (NetDocuments, iManage) — surfaced on results and citations.
9. **Professional density, light background** (every Group-1 tool). Compact rows, tabular data, system-weight type, narrow margins. Not airy, not consumer.
10. **Lead with structure, not a blinking chat cursor.** Clio Duo/CoCounsel/Harvey all subordinate chat to a structured catalog.

**Anti-patterns:** "project/workspace" vocabulary · AI answers without visible clickable citations · AI changes authored as "Keepance AI" · overclaiming security with no in-session evidence · dark theme default · novel nav that ignores Clio/Outlook · card grids/kanban for data-heavy lists · chatbot-as-front-door · ambiguous data handling · setup friction before first value.

---

## Group 1 — The tools she lives in

### 1. Microsoft Outlook (New Outlook / M365)
- **Nav:** Left-side navigation bar (Mail, Calendar, People, Tasks, Notes, Copilot, OneDrive); folder tree below; the defining **three-panel layout** (nav/folder list · message list · reading pane). Pin/unpin left-rail items. ([Customize the Outlook window](https://support.microsoft.com/en-us/office/customize-the-outlook-window-b3eb6e2f-727e-4fba-aaa2-1eb057cca45f); [Outlook navigation pane](https://www.ablebits.com/office-addins-blog/outlook-customize-move-navigation-pane/))
- **Object model:** No native "matter" — imposed via folders + color **category** tags + search folders; folder-first mental model; emails filed via add-ins (ndOffice, Clio). ([New Outlook ribbon](https://www.ablebits.com/office-addins-blog/new-outlook-ribbon/))
- **Search:** Always in the top header; a **contextual ribbon tab** appears in search mode exposing refiners (folder/subfolder/all, sender, date, has-attachment); matches highlighted in the list. ([Release notes](https://learn.microsoft.com/en-us/officeupdates/release-notes-outlook-new))
- **Citations (Copilot in Outlook):** Numbered superscript citations; hover → glance card; click → deep citation view. ([Copilot Chat FAQ](https://support.microsoft.com/en-us/office/frequently-asked-questions-about-microsoft-365-copilot-chat-500fc65e-9973-4e42-9cf4-bdefb0eb04ce))
- **Visual:** Dense, document-grade; Segoe UI, compact rows, minimal color (category labels, unread dots); Fluent accents.
- **Take:** Three-panel nav/list/detail is muscle memory · contextual toolbars (tools appear when relevant) · search always in header · category-tag chips as the native classification metaphor.

### 2. Microsoft Word (Review / Tracked Changes)
- **Nav:** Ribbon with named tabs (Home, Insert, References, **Review**, View…) + context tabs; the document IS the screen (no persistent left rail). ([Review tab](https://bettersolutions.com/word/ribbon/review-tab.htm))
- **Tracked changes (the load-bearing model):** Track Changes toggle; Show Markup (who/what); **Accept**/**Reject** per-change + bulk; Previous/Next; **Reviewing Pane** (vertical/horizontal) listing every change/comment with **reviewer name + timestamp**; per-reviewer colors; comment bubbles in the right gutter. ([Track changes](https://support.microsoft.com/en-us/office/track-changes-in-word-197ba630-0f5f-4a8e-9a77-3712475e806a); [Accept/reject](https://support.microsoft.com/en-us/office/accept-or-reject-tracked-changes-in-word-b2dac7d8-f497-4e94-81bd-d64e62eee0e8))
- **Take:** Map AI edits **directly** onto this model — Reviewing-Pane-style change list with attribution; per-change + bulk accept/reject; changes go out **under the attorney's name**; attorneys expect "review" tools in a named section.

### 3. Adobe Acrobat Pro (2024-25)
- **Nav:** Recently moved tools to a **left "All Tools" panel** (Edit, Protect & Redact, Organize Pages, Comment…); selecting a tool shows a secondary top toolbar; the relocation caused complaints (shows how ingrained the prior right-rail was). ([Tool buttons relocated](https://community.adobe.com/t5/acrobat-discussions/new-acrobat-pro-and-reader-tool-buttons-have-been-hidden-relocated-or-completely-removed/m-p/14691333); [NCBA: new interface](https://www.ncbar.org/2023/09/19/adobe-acrobat-has-a-new-interface/))
- **Legal workflows:** **Bates numbering** via header/footer (prefix, start, placement) ([Bates numbering](https://www.adobe.com/acrobat/hub/what-is-bates-numbering-pdf.html)); **Redaction** = mark (red box) then **apply permanently** (two-step, irreversible) ([Adobe redaction](https://www.redactable.com/blog/adobe-redaction-tool)); Organize Pages (thumbnail strip).
- **Citations:** Comments List panel (author/date/content) like Word's Reviewing Pane.
- **Take:** Two-step "mark then apply" for irreversible actions · inline annotation + sidebar summary list · page thumbnails for corpus navigation.

### 4. Clio (Manage + Manage AI / Clio Duo)
- **Nav:** Persistent **left rail** (Matters, Contacts, Calendar, Tasks, Documents, Communications, Activities, Billing, Reports); firm name at top; **Manage AI ("D") button beside the global search bar**, not in the rail. ([Navigate Clio Manage](https://help.clio.com/hc/en-us/articles/9290390462875-Navigate-Clio-Manage); [Clio Duo](https://lawyerist.com/news/clio-duo-brings-ai-to-lawyers-doorstep/))
- **Object model (canonical matter-as-spine):** Everything hangs off a matter. **Matter Dashboard** with tiles (financial summary, recent activity, details: client/matter/practice-area/number/responsible attorney/open date/status). In-matter sub-nav: Activities, Documents, Notes, Tasks, Calendar, **Communications**, Billing. **Matter Status** (Open/Pending/Closed) + **Stages** are first-class. ([Matter dashboard](https://help.clio.com/hc/en-us/articles/16681289917595-Matter-s-Dashboard); [Matters overview](https://help.clio.com/hc/en-us/articles/9285920226075-Clio-Manage-Matters-Overview); [Matter status](https://help.clio.com/hc/en-us/articles/9286056633115-Matter-Status))
- **Search:** Global search in header, type-ahead across matters/contacts/documents; **conflict check** runs across all matters/contacts; every section is a **sortable/filterable table** with configurable columns. ([Global search](https://help.clio.com/hc/en-au/articles/9290347515291-Global-Search); [Conflict checks](https://help.clio.com/hc/en-us/articles/35286010477979-Conflict-checks))
- **Citations (Manage AI):** Floating chatbot panel from the header; conversational answers with **clickable links** to matters/documents/activities; deadline extraction shows a **side-by-side AI output ↔ source document** for verification. ([Manage AI](https://www.clio.com/blog/manage-ai/))
- **Trust:** Explicit "never trains on customer data," respects permissions; privilege messaging is pre-purchase, not an in-session indicator. ([AI data privacy](https://www.clio.com/resources/ai-for-lawyers/ai-data-privacy/))
- **Visual:** Dense, professional, blue accent, white bg, compact rows; CRM-grade density, no decoration.
- **Take:** Matter-as-spine with all child objects · tabular lists with sort/filter · side-by-side AI↔source citation · AI as a header-accessible assistant, not primary nav.

### 5. NetDocuments
- **Nav:** Top blue Navigation Bar + left Navigation Pane tree (cabinets → **workspaces (=matters)** → folders); "Go to a matter" type-ahead; Recent/Favorite Workspaces. ([Overview & navigation](https://support.netdocuments.com/s/article/360008910091))
- **Object model:** **workspace = matter**; every doc has a **profile** (client/matter/subject/author/type/date); version history (check-in/out); filing via ndOffice Save-As interception + Outlook Predictive Filing. ([Search tips](https://support.netdocuments.com/s/article/NetDocuments-Search-Tips-Tricks))
- **Search:** Quick search (relevance) + Advanced metadata search (field selectors); results table (name/client/matter/author/date/type) with **filter chips**. 
- **Take:** workspace=matter with doc profiles · two-tier quick + metadata search · ndOffice "save without leaving Word."

### 6. iManage Work 10
- **Nav:** Persistent left **Side Navigation** (Documents, Emails, Folders, Clients, Matters); matter tree = Recent / My Matters / My Favorites; click → center panel; **same tree embedded in the Outlook Work Panel** (file email from Outlook). ([Tree view](https://docs.imanage.com/work-web-help/10.4.2/en-US/Tree_view.html); [Recent matters](https://docs.imanage.com/work-web-help/10.4.0/en-US/Viewing_Recent_Matters_My_Matters.html))
- **Object model:** **workspace = matter** (up to 10k subfolders); **document profile** metadata layer separate from filename; check-in/out versioning. ([Containers & documents](https://docs.imanage.com/cc-help/10.4.0/en/Containers_and_Documents.html))
- **Trust — ethical walls:** **Security Policy Manager** — need-to-know at client/matter/department/location; walled documents are **invisible in search** to unauthorized users (the professional gold standard, enforced by key/permission, not UI hiding). ([Security Policy Manager](https://imanage.com/imanage-products/security-governance/security-policy-manager/))
- **Take:** Name and implement **ethical walls** (invisible, not just restricted) · document profiles · meet attorneys in Outlook · saved searches.

---

## Group 2 — Legal-AI products she's sold against

### 7. Harvey
- **Nav:** Left sidebar with five areas — **Assistant**, **Vault** (docs), **Knowledge** (research w/ citations), **Workflow Agents**, **Ecosystem**; Vault now queryable from inside Assistant (collapses "ask" vs "search your docs"). ([Platform](https://www.harvey.ai/platform); [Vault](https://www.harvey.ai/blog/introducing-the-next-version-of-vault))
- **Object model:** project/**vault = matter** (up to 10k docs); pre-built workflows per document type extract 25+ data points; shareable threads/vaults. ([Vault](https://www.harvey.ai/platform/vault))
- **Citations (its signature investment):** **Sentence-level citations**; two-component **"Answer + Reasoning"**; **Review Table** (rows=docs, columns=data points, "Verbatim" column = exact-quote citation); export carries citations. ([Rebuilding review](https://www.harvey.ai/blog/rebuilding-harveys-review-algorithm); [The Brief Apr 2026](https://www.harvey.ai/blog/the-brief-april-2026))
- **Trust:** Heavy badges (SOC 2 II, ISO 27001/27701/42001, GDPR/CCPA), no-training, regional residency, zero-access architecture, SafeBase trust portal — but **pre-purchase marketing, not in-session UI**. ([Security](https://www.harvey.ai/security))
- **Visual:** **Dark-mode enterprise-minimalist** — the most "tech-company" of the set; an adoption risk for a solo litigator.
- **Take:** Sentence-level citations + Answer/Reasoning · configurable Review Tables · pre-built extraction templates per litigation doc type (deposition, interrogatory, expert report).

### 8. Thomson Reuters CoCounsel
- **Nav:** The **CoCounsel Library** (Skills · Prompts · Workflows) grouped into **Draft / Research / Review / Summarize**; two entry points: Chat or the structured Library menu. ([Skills/prompts/workflows](https://www.thomsonreuters.com/en-us/help/cocounsel/legal/skills/skills-prompts-workflows))
- **Object model:** Task-centric (bring docs to a skill); matter context comes from the integrated DMS (iManage/NetDocuments) + Westlaw.
- **Citations:** Embedded **Westlaw hyperlinks** + **KeyCite** flags (still-good-law); an "Identifying Citation Issues" skill; answers cite Practical Law sources. ([CoCounsel Legal](https://legal.thomsonreuters.com/en/products/cocounsel-legal))
- **Trust:** **Authority-based** — borrows credibility from Westlaw/Practical Law as known-authoritative sources.
- **Take:** A **named skills catalog** (don't make her prompt) · sortable/filterable review tables · authority-as-trust → Keepance's parallel is "this answer comes from *your* documents/emails/transcripts."

### 9. Spellbook (Word add-in)
- **Nav:** Lives entirely as a **Word taskpane** (no standalone app); Benchmarks library + firm playbooks. ([Redline contracts](https://spellbook.com/learn/redline-contracts); [Review](https://owlesq.com/tools/spellbook))
- **Flow:** Open contract → activate panel → clause-by-clause **risk flags + redline suggestions** with explanations → **Accept** generates Word tracked changes **under the attorney's name** (indistinguishable from a human redline). ([Best AI redlining tools](https://www.spellbook.legal/learn/best-ai-contract-redlining-tools))
- **Take:** **Zero context switching** (AI lives in Word) · changes **under the attorney's name** (ethics requirement) · taskpane + clause-by-clause with per-suggestion explanation.

### 10. Microsoft 365 Copilot
- **Nav:** Chat pane within Word/Outlook/etc.; standalone Copilot Chat; Notebooks for scoped references. ([Copilot in Word/Outlook](https://www.computerworld.com/article/3479705/how-to-use-microsoft-copilot-for-writing-in-microsoft-365-word-outlook-onenote.html))
- **Citations (most mature reviewed):** **Numbered superscripts** inline at claim level; **hover → glance card** (source name/excerpt); **click → deep citation view** (the exact passage that informed the answer); expanding deep-citation source coverage. ([Deep citations](https://m365admin.handsontek.net/microsoft-copilot-microsoft-365-deep-citations-copilot/))
- **Trust:** "Grounded in your tenant" — only surfaces content you're already permissioned to see (implicit inheritance).
- **Take:** **Hover-glance + click-deep-view is the gold standard** — implement exactly · numbered superscripts read like brief footnotes · "grounded in your access" = Keepance's matter-isolation trust claim.

## Group 3 — Inline citation patterns (Perplexity / Glean / taxonomy)
- **Perplexity** — citation-forward: numbered citations **always visible** (not hover-only), source preview panel above the answer, expandable "see all sources," title+favicon for quick scanning. ([Case study](https://www.aiuxplayground.com/gallery/perplexity-citations/); [Platform guide](https://www.unusual.ai/blog/perplexity-platform-guide-design-for-citation-forward-answers))
- **Glean** — RAG answers link back to source docs (enterprise).
- **ShapeOfAI taxonomy** — inline highlights (exact passage), direct quotations, multi-source refs, lightweight links; best practice: point to exact passage, flag unavailable sources, allow source filtering without regenerating. ([Citations pattern](https://www.shapeof.ai/patterns/citations))
- **Take:** Citations **always visible** (not hover-only) · point to the **exact sentence** · progressive disclosure (number → hover → click) · explicitly flag unretrievable sources.

---

## Recommended IA for Keepance (grounded in the teardowns — a hypothesis for Phase 2)

**Top-level left rail:** `[Firm name]` · Home/Dashboard · **Matters** (primary, with Recent / All / + New) · Documents (cross-matter, for conflict-check & cross-matter research) · **Trust Log** (first-class, not buried — it's the differentiator) · Settings (bottom).

**Within a matter** (header: Matter name · Client · Matter # · Status · Responsible attorney): sub-nav **Dashboard · Documents · Ask/Analysis · Drafts · Trust Map · Timeline**.
- **Documents:** three-panel (folder tree · table list with Name/Type/Date/Author/Analyzed/Privilege columns · preview); quick search + metadata filters.
- **Ask/Analysis (the unified "Ask" + the litigation associate):** *Ask* (prose answer with numbered superscripts → hover glance → click opens a right-side source panel with the highlighted passage + metadata + "open full document") and *Review* (pick a named action from the Actions Library → tabular results, rows=docs, columns=findings, a Citations column with the exact source sentence, exportable to .xlsx).
- **Drafts:** managed .docx with tracked-changes status; Keepance edits as standard Word tracked changes under the attorney's name; "Open in Word" with the Keepance taskpane.
- **Trust Map:** per-document data handling (storage location · AI processing: Local / Provider no-retention / not-yet · last accessed · access log · privilege annotation). No competitor surfaces this in-session at the matter level — Keepance's unique UI moat.

**Vocabulary:** matter (not project/workspace/case) · documents (not files) · Ask/Analysis (not chat) · citations (not sources) · attorney/first-name (not user).

*Research scope June 2026; all sources cited inline. Patterns verified via public materials where possible; unverifiable specifics flagged in the per-product sections.*
