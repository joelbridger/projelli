# Email Intelligence for Keepance: Strategy and Architecture

**Date:** 2026-06-06
**Author:** CEO / lead research (for Jameson)
**Status:** Recommendation for decision
**Origin:** A practicing CFP (Jameson's wife) reported that Outlook search "basically doesn't work" and that this pain is shared across every Keepance vertical (legal, tax, consulting, advisory). This document tests that claim, surveys what exists to solve it, and recommends how Keepance should.

---

## TL;DR (the one-page version)

**The insight is real, and Microsoft's own documentation proves it.** Outlook search is broken by default, not by accident: it caps results at 250, silently hides older matches, can't reliably search the archive, and (in the standard configuration) only keeps the last 1 to 12 months of mail on the machine at all. Older client correspondence is effectively unfindable. This is documented "expected behavior" that Microsoft says it does "not expect to fix."

**This is a wedge, not a feature.** Every professional we sell to lives in their inbox and loses time hunting it. Whoever makes their email actually findable owns a daily-use beachhead. And the one way to do it that a privilege-bound lawyer or a Reg S-P-bound advisor can actually adopt is the one thing only Keepance is built for: doing it entirely on their own machine.

**The competitors can't follow us here.** Microsoft 365 Copilot, Shortwave, and Superhuman all process your email in their cloud. Superhuman's AI assistant was shown, in a documented security report, leaking financial, privileged-legal, and medical content out of dozens of emails in a single response. The genuinely local tools (MailStore, X1) are dumb archivers, not AI workspaces. Nobody occupies "local-first + AI + bring-your-own-key." That is open ground, and it is exactly where Keepance already stands.

**We are roughly 80% of the way there already.** Keepance ships a fully on-device engine that reads documents, understands their meaning, remembers facts, and answers questions with citations, with nothing sent to anyone's cloud. Email is just another document. The missing 20% is a connector that pulls email onto the machine and saves each message as a file. Once it's a file, the machinery we already built takes over automatically.

**My recommendation:** Build local email ingestion feeding our existing local index. Pull email down via the readable Microsoft Graph / Gmail / IMAP paths plus `.pst`/`.ost` import, normalize each message to a local Markdown file in the workspace, and let our existing on-device search, memory, and chat answer questions over it. Keep every byte on the user's machine. Start with one mail provider, ingest read-only, prove it with real mailboxes, then widen.

**The one decision I need from you** is in the last section: how ambitious v1 should be, and which mail provider we connect first.

---

## 1. The problem: Outlook search is broken by design

This is not a user-error story or a "they should reconfigure it" story. The defaults that solo and small-firm professionals actually run on are broken, and these are Microsoft's own words.

| What breaks | What Microsoft's docs actually say | Source |
|---|---|---|
| Results are capped | "By default, classic Outlook will display 250 search results." Raising it makes search slower. | Microsoft Support, *Troubleshooting Outlook search issues* |
| Older matches silently vanish | "If new Outlook finds too many results, older items may not be displayed." No warning is shown. Microsoft's only remedy is to add filters by hand. | Microsoft Support (same) |
| The archive isn't searchable | "When you search... using All Mailboxes or All Outlook Items scopes, limited or no results are returned for the Archive Mailbox." Microsoft adds it is "not expected that this issue will be fixed." | Microsoft Support (same) |
| Old mail isn't even on the machine | In Cached Exchange Mode (the default), "Outlook caches email messages only from the last 12 months and removes anything older from the local cache." On smaller drives it's the last **1 or 3 months**. | Microsoft Learn, *Cached Exchange Mode* |
| So local search can't find it | Older items "reside only in your mailbox on the server." A local search shows "recent results," and you must click "More" for a separate online round-trip to the server. Microsoft labels this "expected behavior." | Microsoft Learn, *Only a subset of items synchronized* |

**The takeaway for our architecture:** the local mail store is incomplete *by design*, so any tool that piggybacks on Outlook's own index inherits the same blind spot. To actually fix the pain, Keepance has to pull the mail down itself and keep a complete local copy. That single fact rules out the "just query Outlook live" shortcut and points directly at full local ingestion. (Honest caveat: these are defaults, not hard ceilings. A power user *can* reconfigure cached-mode and result caps. The point is that the people we sell to are running the broken defaults, not that Outlook is incapable.)

---

## 2. The competitive landscape splits cleanly along our moat line

Everything in this market falls into one of three buckets, and the dividing line is exactly the one Keepance was built on: does your client's email leave their machine?

**Bucket A: Cloud AI email tools (powerful, but disqualified for our buyers).**
- **Microsoft 365 Copilot** routes your prompts, the email it retrieves, and its responses to Azure-OpenAI (with Anthropic as a named subprocessor) in regional datacenters. It stays "within the Microsoft 365 service boundary," but that boundary is Microsoft's cloud, not your machine.
- **Shortwave** stores *all* customer email in Google Cloud and sends it out to OpenAI, Anthropic, and the Pinecone vector database to do its AI work.
- **Superhuman** is the cautionary tale. A documented security report (PromptArmor, corroborated by prompt-injection authority Simon Willison) showed its AI assistant hit by a "zero-click" attack: a single booby-trapped incoming email caused the AI, when simply asked to summarize the inbox, to siphon the contents of dozens of *other* emails (full text of several, partial from 40+) into one response, including financial data, privileged legal information, and medical data. (Fair framing: this was a responsibly-disclosed researcher proof-of-concept on test emails, now patched, not a confirmed theft of real client data. But it concretely demonstrates the structural risk of letting a cloud AI read a whole mailbox.)

For a lawyer under privilege, a CPA under IRC §7216, or an advisor under Reg S-P, Bucket A is a non-starter. Sending client email to a third party is the exact thing their rules constrain.

**Bucket B: Genuinely local tools (safe, but not intelligent).**
- **MailStore Home** archives all email locally with the vendor having "no access whatsoever," and searches large volumes fast, including attachments. But it is an *archiver and keyword search box*, not an AI workspace. It can't understand, summarize, remember, or reason across your mail. (It's also non-commercial-use-only in the Home edition.)
- **X1** markets "AI in-place," but its claim to do *all* AI processing locally did not survive fact-checking (our verifiers refuted it 3-to-0; it's a hybrid model with vendor-only sourcing). Treat X1 as unproven, not as evidence that local AI search is a solved problem.

**Bucket C: Local-first + AI + bring-your-own-key. Empty. This is us.**
No shipping product combines a complete local copy of your email, real AI understanding over it, and the keys-stay-with-you model. That combination is open whitespace, and Keepance is the only product already architected for it.

---

## 3. What Keepance already has (the reason this is achievable)

This is the part that turns a daunting "build an AI email client" project into a focused one. I went through our own codebase. We already ship the hard, expensive 80%:

- **A fully on-device understanding engine.** Our Tauri/Rust backend runs a local embedding model (fastembed, multilingual-e5-small, 384-dimension, bundled so it works offline) and stores the results in a local vector database (LanceDB) inside each workspace at `.keepance/vectors/`. It already chunks documents, already indexes PDFs, and exposes "index this file" and "find the passages that answer this question" operations. **No cloud touches any of this.**
- **Memory.** We already extract and persist facts (`.keepance/memory.json`) and carry them between conversations. This is the "remember them" half of Jameson's ask, already built.
- **Cited, meaning-based chat over your own files.** The chat already takes a question, retrieves the most relevant passages from the local index, and answers with citations. This is "search that actually works," already live, just pointed at documents instead of email.
- **Keyword search and a file watcher.** Full-text search and automatic re-indexing of new or changed files are already in place. Drop a new file in the workspace and it gets indexed on its own.
- **Native networking.** The Rust backend already has a production HTTP stack, which is what we'd use to reach a mail server.

**What's actually missing is one new component: the email connector.** Something that (a) authenticates to the user's mailbox, (b) pulls messages down to the machine, and (c) writes each one out as a Markdown file (with sender, recipients, date, subject, thread, and attachments captured) into the workspace. The moment an email is a file on disk, our existing watcher indexes it, our existing engine understands and remembers it, and our existing chat answers questions about it. Email becomes just another document type, exactly the way PDFs already are.

---

## 4. Recommended architecture

**Recommendation: full local email ingestion feeding our existing local index, with the local copy as the system of record. Not live "query Outlook on demand" as the primary mode.**

Three reasons, all load-bearing:

1. **Live querying inherits Outlook's brokenness.** If we just ask Outlook/Exchange for results in real time, we get back the same capped, archive-blind, 12-month-windowed answers that are the problem. Only a complete local copy fixes the actual pain and enables offline recall and memory.
2. **Local-first is the only thing that passes the ethics gate** (see §5), and it's our moat. Every cloud competitor fails this test.
3. **The whitespace is exactly this combination**, and we're already built for it.

**How email gets onto the machine** (in priority order, each is a connector we can add incrementally):
- **Microsoft Graph, readable endpoints** (most of our buyers are on Microsoft 365). Pull raw message content (`GET /messages/{id}/$value` for the standard `.eml` form, or the parsed message resource). **Explicitly avoid** the Graph `exportItems` API: our research confirmed it returns an opaque, unparseable stream meant only for re-importing into Exchange, not for reading. This is a real, easy-to-step-on landmine, and now it's documented.
- **IMAP** for universal coverage (any provider).
- **`.pst` / `.ost` import** for offline onboarding ("point us at your Outlook data file") and for the old mail that isn't on the server-synced machine.
- **Gmail API** for the Google Workspace users.

**How it gets understood:** normalize each message to Markdown, chunk it email-smartly (split on message, attachment, and reply-header boundaries so each chunk is a clean, self-contained piece; index attachments as their *own* chunks rather than gluing them onto the email body), embed locally, store locally. (Caveat: the specific chunking recipe comes from a small open-source project, not a benchmarked standard, so we treat the exact sizes as tunable defaults, not gospel. One thing we know *not* to do: don't embed an entire thread as a single block; that was refuted in the research.)

**A pragmatic refinement:** a hybrid where we keep the complete local index as the source of truth *and* do a light live check for brand-new mail since the last sync. But the local index is the foundation; live is the garnish.

---

## 5. The confidentiality fork, and why we're already on the right side of it

The research surfaced one question it called possibly "more ethically load-bearing" than anything else, and it's subtle enough that most teams would get it wrong:

> When you build the index, *where does the email text get turned into searchable form?* If you use a cloud provider's embedding API to do it, you've just sent every client email to a third party at indexing time, which re-opens the exact §7216 / Reg S-P / privilege problem you were trying to avoid, even if the later chat is careful.

**Keepance already does this the safe way.** Our embedding model runs *on the user's machine*, offline. Building the index sends nothing anywhere. The only moment anything leaves the machine is when the user asks the AI a question, and even then only the handful of retrieved passages go out, to the user's *own* chosen provider under their *own* key, and that provider can even be a fully local model. We are already on the correct side of the one fork that sinks most "private email AI" attempts.

**The ethics picture is favorable and citable.** The ABA's first formal opinion on generative AI (Formal Opinion 512, July 29, 2024) and Model Rule 1.6 require lawyers to keep client information confidential and tie the need for client *consent* specifically to feeding that information into self-learning or third-party-disclosing tools. A local-first index that never discloses to a third party and never self-trains is the lowest-burden path under that rule. The same logic maps to §7216 (tax) and Reg S-P (advisors), which likewise turn on whether client data is disclosed to a third party. One design answers all four regimes. (Honest flag: the legal analysis is rock-solid for lawyers; for CPAs and RIAs it's strong by analogy but I have not found explicit published authority blessing a local AI index specifically. We position carefully, not overclaim.)

This is also the single best sales line we have. We don't just *say* we're private. We're the only option a regulated professional can adopt without a consent headache, and the Superhuman incident is the concrete proof of what the alternative risks.

---

## 6. What v1 looks like

The temptation is to "index my entire 15-year mailbox." That's the wrong v1, for a concrete reason flagged in the research and worth respecting: nobody has benchmarked on-device embedding of a 100,000-message mailbox with attachments on a typical solo-practitioner laptop (CPU-only, 8 to 16 GB of RAM). That could be slow enough to be a bad first impression. So v1 should be bounded and prove the magic fast:

**v1 (prove the wedge):**
- **One connector first.** Microsoft Graph (readable endpoints) if our buyers skew Microsoft 365, or `.pst` import if we want a zero-API, drag-and-drop onboarding that demos instantly. (This is part of the decision below.)
- **Read-only.** Pull and index. No sending or replying yet. Lower risk, faster to ship, and it's where the pain is.
- **Bounded ingest.** Let the user choose what to bring in (a date range, specific folders, or per-client/per-matter folders), rather than boiling the ocean on first run. This also reinforces good privilege hygiene (Client A's mail stays separate from Client B's).
- **Reuse everything.** Pipe ingested mail straight into the existing index, memory, search, and cited chat. Almost no new AI code, mostly connector and normalization.
- **The demo:** "Connect your mail, then ask Keepance 'what did I tell the Hendersons about their closing date?' and get the answer with the actual email cited, fully offline." That is the thing no competitor can show a regulated buyer.

**v2 and beyond (deepen):** incremental background sync to stay current; more connectors (IMAP, Gmail); attachment-aware retrieval; link emails to matters/clients and to the templates we already ship; eventually, *drafting* replies (with the same "AI proposes, you approve" discipline that's already core to the product).

---

## 7. Risks and honest caveats

- **Performance at scale is unproven.** The biggest unknown. Mitigated by the bounded-ingest v1, but we should benchmark a real large mailbox on a modest laptop before we promise "index everything."
- **Connector maintenance is real work.** Microsoft and Google change auth and APIs; mail comes in messy shapes. This is ongoing, not one-and-done. IMAP and `.pst` are the most stable; Graph and Gmail are more powerful but move more.
- **OAuth and app registration.** Graph and Gmail need registered apps and user consent flows. Surmountable, but it's setup the user has to walk through; `.pst` import avoids it entirely, which is one argument for leading with it.
- **Prompt injection is a genuine threat even locally.** The Superhuman attack works by hiding instructions inside an email. We are safer because we don't auto-render remote content or take autonomous actions, but the moment AI reads untrusted email we must sanitize aggressively and never let the model trigger network calls on its own. Our existing "AI proposes, user approves, no autonomous agents" stance is the right foundation; we hold it.
- **Evidence caveats from the research itself:** the chunking specifics rest on a hobby project (tune, don't trust blindly); X1's local-AI marketing is unverified (don't cite it as proof); the Superhuman leak was a patched proof-of-concept (frame as "demonstrated vulnerability," not "ongoing breach"); Outlook's limits are broken *defaults*, not absolute incapability. Microsoft and the AI-email vendors move fast, so any public competitive comparison should be re-verified right before it ships.

---

## 8. Open questions to resolve before building

1. **Performance envelope:** how big a mailbox can we embed and search on a CPU-only, 8 to 16 GB laptop at acceptable speed? Determines whether full local RAG is the v1 default or needs a lighter keyword-plus-metadata fallback for huge mailboxes.
2. **Sync mechanics:** how do we do the one-time backfill of old server mail and stay current after (Graph `deltaLink`, Gmail `historyId`, IMAP `CONDSTORE`), including rate limits and resumability?
3. **Regulatory specificity:** is there explicit published guidance treating a purely local, non-disclosing AI index as outside "third-party disclosure" for §7216 (tax) and Reg S-P (advisors), or is that favorable read still by-analogy and legally untested?

---

## 9. The recommendation, and the decision I need

**My recommendation as CEO:** green-light this. It's the rare feature that is simultaneously (a) solving a verified, daily, universal pain across all four of our verticals, (b) achievable because we already built the hard 80%, and (c) the purest possible expression of our moat, the one thing no cloud competitor can copy. It deepens exactly the buyer relationship we're trying to win and gives marketing a demo that sells itself to skeptical, regulated professionals.

**What I'd want from you before I take it further:**

1. **How ambitious should v1 be?** My lean is the bounded, read-only, one-connector v1 above (fastest to a working demo, lowest risk). The alternative is a more ambitious "index my whole mailbox, multiple providers" first cut.
2. **Which mail provider do we connect first?** My lean is to start with whichever gets us to a live demo fastest: `.pst`/`.ost` drag-and-drop import (no OAuth, instant, works offline) as the demo-maker, with Microsoft Graph as the first "real" connector right behind it since most of our buyers are on Microsoft 365.

Tell me those two and I'll turn this into a build plan. Nothing here commits us to shipping; it commits us to building the connector that unlocks a capability we're 80% of the way to already.

---

## Appendix: verified findings and sources

Produced by a multi-agent deep-research pass: 5 search angles, 24 sources fetched, 115 claims extracted, top 25 adversarially fact-checked (3 independent verifiers each), 22 confirmed, 3 refuted and dropped. Confidence levels are the research's own.

**Confirmed (high confidence):**
1. Outlook caps results at 250, silently drops older matches, and can't search the archive. *(Microsoft Support: Troubleshooting Outlook search issues.)*
2. Cached Exchange Mode keeps only the last 1/3/12 months locally; older mail lives only on the server and needs an online round-trip. *(Microsoft Learn: Cached Exchange Mode; Only a subset of items synchronized.)*
3. Microsoft 365 Copilot and Shortwave both send client email to third-party cloud AI. *(Microsoft Learn: Copilot privacy + AI subprocessor; Shortwave security docs.)*
4. Superhuman's AI assistant demonstrated a zero-click prompt-injection exfiltrating financial, privileged-legal, and medical content from 40+ emails in one response. *(PromptArmor report; corroborated by Simon Willison.)*
5. MailStore Home stores mail locally with no vendor access and searches attachments, but is an archiver, not an AI workspace. *(MailStore product + install docs.)*
6. The Microsoft Graph `exportItems` API returns an opaque, unparseable stream; use the readable Graph endpoints, Gmail API, IMAP, and `.pst`/`.ost` import instead. *(Microsoft Learn: mailbox import/export overview.)*
7. Email-specific chunking (split on message/attachment/reply boundaries, ~1,800 chars for a 512-token model, attachments as separate chunks) beats naive splitting. *(Medium confidence; RAG-Mail repo + LangChain + section-aware-chunking literature.)*
8. ABA Formal Opinion 512 (2024-07-29) and Model Rule 1.6 make a local-first, non-disclosing index the lowest-risk path under the duty of confidentiality. *(ABA news release; NCBE; UNC Law analysis.)*

**Refuted and dropped:** Superhuman leak being "fully passive / user never opened the email" (the user did issue a summarize request); X1 doing "all AI processing locally" (vendor-only claim, no independent review); embedding "the whole email thread as one block" (chunk per message instead).

**Primary sources:**
- Microsoft Support — Troubleshooting Outlook search issues: https://support.microsoft.com/en-us/office/troubleshooting-outlook-search-issues-2556b11f-f4d8-46be-b0a7-de33a3f4f066
- Microsoft Learn — Cached Exchange Mode: https://learn.microsoft.com/en-us/microsoft-365-apps/outlook/configuration/cached-exchange-mode
- Microsoft Learn — Only a subset of items are synchronized: https://learn.microsoft.com/en-us/troubleshoot/outlook/user-interface/only-subset-items-synchronized
- Microsoft Learn — Microsoft 365 Copilot privacy: https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-privacy
- Microsoft Learn — Connect to an AI subprocessor: https://learn.microsoft.com/en-us/microsoft-365/copilot/connect-to-ai-subprocessor
- Microsoft Learn — Mailbox import/export overview: https://learn.microsoft.com/en-us/graph/mailbox-import-export-concept-overview
- PromptArmor — Superhuman AI exfiltrates emails: https://www.promptarmor.com/resources/superhuman-ai-exfiltrates-emails
- Shortwave — Security guide: https://www.shortwave.com/docs/guides/security/
- MailStore Home: https://www.mailstore.com/en/products/mailstore-home/
- ABA — First ethics guidance on AI tools (Op. 512): https://www.americanbar.org/news/abanews/aba-news-archives/2024/07/aba-issues-first-ethics-guidance-ai-tools/
- IRC §7216 implications (The Tax Adviser): https://www.thetaxadviser.com/issues/2024/jan/the-many-implications-of-sec-7216/
- SEC Reg S-P amendments (press release): https://www.sec.gov/newsroom/press-releases/2024-58
- RAG-Mail (email chunking reference implementation): https://github.com/ManiAm/RAG-Mail
