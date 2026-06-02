---
title: "Background agents work better when you give them files. Here's why that matters for attorneys, CPAs, and consultants — not just coders."
description: "Cursor, Codex, and Claude Code all shipped background agent capabilities in early 2026. The pattern that's emerging looks a lot like the files-not-chats argument that applies just as strongly to confidential professional work."
date: 2026-05-08
author: Jameson Daines
tags: [AI Tooling, Agents, Professional Work]
category: opinion
---

In April, [Cursor 3 launched](https://cursor.com/changelog/0-50) with background agents. [Claude Code](https://www.anthropic.com/claude-code) had already shipped its long-running terminal agent powered by Opus 4.7, leading [SWE-bench Pro at 64.3%](https://medium.com/@dave-patten/the-state-of-ai-coding-agents-2026-from-pair-programming-to-autonomous-ai-teams-b11f2b39232a). [Codex](https://developers.openai.com/codex/pricing) is doing cloud-based multi-agent workflows with desktop computer use. The pattern is clear and it's been building for months.

A background agent is, in plain terms, an AI process that runs on its own clock. You hand it a task. You walk away. You come back to a result. The agent's run might take 30 seconds (a small refactor) or 30 minutes (a multi-file feature) or 3 hours (a multi-step task with branches and decision points). [Anthropic published a strong piece on harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) that's worth reading if you want the technical version.

I've been thinking about this for [Keepance](https://keepance.com), which is built for attorneys, CPAs, and independent consultants doing confidential client work — not a coding tool. I want to talk about what background agents are doing right and why the pattern matters for professional knowledge work too.

## What "background" actually means

The interesting thing about a background agent is not that it runs while you do something else. The interesting thing is what's required for it to run usefully while you do something else.

You can't supervise it. So it has to know what you'd want, in advance, when it hits a decision.

You can't paste new context into the chat. So it has to start with all the context it needs.

You can't iterate quickly on the prompt. So the prompt has to be specified well enough that the result is in the right neighborhood on the first try.

You can't approve every step. So it has to know which steps need explicit human approval and which it can decide on its own.

If you tease those four out, what you're describing is **a job that runs against a documented brief, with files of source material, with explicit guardrails on the consequential moves, against a known target.** This is the opposite of how chat-based AI works.

In a chat, you steer turn-by-turn. You give a vague prompt, you see the response, you adjust, you push back on the wrong direction. The agent's whole job is to be a quick partner in real time.

A background agent, run the same way, fails.

## Why files matter for background work

The thing that makes a background agent succeed is that the working state lives in files, not in a chat thread.

A code background agent works because the code is files. The agent reads the files, makes changes to the files, runs tests against the files, and produces a diff that humans can review. The state of the world after the agent runs is **inspectable as files.** Bad changes can be reverted. Good changes can be merged. The history is a series of commits.

This is structurally different from a chat-based AI workflow. In a chat, the state of the world after the AI runs is a long thread of messages. The thread is hard to inspect, harder to revert, and impossible to merge with someone else's parallel thread. Chat is fundamentally a turn-by-turn medium.

When [Anthropic writes about effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), the entire framework is files. Files for context, files for output, files for memory between agent runs. The chat interface is a thin layer on top of the file substrate.

## The professional work case

Here's where this matters for attorneys, CPAs, and consultants — and for anyone building tools for that work.

I built [Keepance](https://keepance.com) on a thesis that professional knowledge work is better served by files than by chats. Not as an aesthetic preference. As a structural one. Because the same dynamics that make background agents work in coding also work in drafting, analysis, research, and client matter management. And for professionals with confidentiality obligations, the files-vs-chats question has a dimension that doesn't exist for software engineers.

If you're drafting a client memo, the memo is best stored as a file. Edits are changes to that file. You can review what changed, restore a prior version, share it with a colleague for review, or file it as a client record. None of this works if the memo lives in a chat thread, because the chat thread doesn't expose its state as a reviewable, versionable document.

If you're doing matter research, the artifacts — issue summaries, citation lists, authority analyses — are best stored as files. You can search them, reference them in other matters, and retain them as work product. A research conversation that happens in a chat thread evaporates. A research process that produces files persists, and produces something you can put in a client file.

The additional layer for legal and tax professionals: a client deliverable that lives in a chat thread also lives in a vendor's cloud. When an attorney drafts privileged analysis through a chat-first AI tool, that analysis exists in the tool vendor's database. [ABA Formal Opinion 512 (2024)](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/aba-formal-op-512.pdf) requires attorneys to understand and account for where client information goes when they use AI. The February 2026 decision in *United States v. Heppner* (S.D.N.Y.) found that routing privileged communications through a third-party AI intermediary can constitute a disclosure that waives privilege. A file on your own machine has none of those exposures. A chat thread in a vendor's database has all of them.

The mistake the chat-first AI workspaces make is treating the chat as the primary surface and the file as a side effect. For professional work, that's backwards.

## What background agents teach us about the files-first move

A few specific lessons from watching the coding tool market that generalize directly to professional work.

**Long-running tasks need persistent context that isn't a chat history.** The chat is too noisy and too volatile. The agent needs durable, named, file-shaped context. In coding, this is the codebase plus a `CLAUDE.md` plus issue tickets. In legal or tax work, it's the matter file plus a brief plus reference materials. Same pattern. For professional work, those reference materials often include confidential client information — which is another reason they belong in local files, not in a chat system's memory.

**The user needs to inspect the working state mid-run, not just the final output.** A background agent that produces a 90-minute task without intermediate visibility is too risky to use. The way coding tools handle this is the agent edits real files in real time, and the user can read them. The way Keepance handles it is the AI works with documents the user can open and read at any moment. Files give you that. Chats don't. For an attorney reviewing AI-assisted work product before it goes to a client, that inspectability is a professional requirement, not a nice-to-have.

**Reversibility is the load-bearing feature.** Every successful background agent workflow has a clear reversion mechanism. Coding has git. Professional document work has saved drafts and version history. The reason files work for background agents is that file-based history is genuinely revertible. Chat-based "history" is not, in any practical sense.

**The brief is the bottleneck.** The thing that determines whether a 30-minute background agent run produces something useful or something you can't use is the brief. The brief is a file. It is written by the human, before the agent starts. It contains the goal, the constraints, the context, the success criteria, and the explicit boundaries on what the agent is allowed to change. If the brief is good, the run is good. If the brief is thin, the run is thin.

For professional work, the brief is also a record. An attorney who can produce the brief they gave an AI, alongside the output the AI produced, is in a much better position than one whose AI work exists only as a chat thread that can't be reconstructed or reviewed. The brief is a file. Keep it.

## What I think is genuinely changing

For the first 18 months of broad AI tool adoption (mid-2023 through late 2024), the dominant interaction pattern was chat. The user typed, the model responded, the user typed back. Conversational. Synchronous. Quick.

For the last six months, that's been shifting. The dominant interaction pattern is moving toward **briefed work.** The user writes a brief, sometimes assembles source files, fires off a task, walks away, comes back. Asynchronous. Document-shaped. Slower per cycle, but bigger per cycle.

This shift is most visible in coding because coding tools are the early adopter market. But the shift is becoming visible in professional knowledge work too. Attorneys using AI to draft long-form analysis. CPAs using it to work through complex tax positions. Consultants using it to produce engagement deliverables. The pattern is the same. The professional provides files, writes a brief, lets the model work, and reviews the output as a document — not as a chat reply.

The tools that win the next 18 months in professional AI workspaces are the ones that take this seriously. The ones that build the workflow around files, not around chat. The ones that keep client data out of vendor infrastructure. The ones that make the brief easy to write, the source material easy to attach, and the output easy to review, version, and retain as a client record.

This is what [Keepance is built around](https://keepance.com). The product is files. The chat is a tool inside the file. The agent runs against the file. The output goes back into the file. There is no chat thread that lives outside the document and outside your machine. This is a deliberate decision and it's the one that makes Keepance defensible under [ABA Op 512](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/aba-formal-op-512.pdf), [IRC §7216](https://www.irs.gov/irm/part20/irm_20-001-001r.htm), and standard NDA confidentiality obligations.

## Concrete advice if you're evaluating AI tools right now

**For professional client work, look at the file behavior first.** Is the AI's working state stored in documents you can open, version, retain, and produce as a client record? Or is it stored in chat threads that live in a vendor's database? The former has a defensible data architecture. The latter creates exposure under confidentiality obligations that most AI tool vendors haven't thought about.

**Write briefs.** This is the boringly correct advice. The skill that matters most in 2026 AI usage is writing a clear brief. The brief is a file. Reuse them. Refine them. Treat them as a practice asset. For attorneys, a well-written AI brief is also documentation that shows how you exercised professional judgment in using the tool.

**Be skeptical of "AI memory" features that aren't files.** A lot of tools are shipping "memory" as a hidden chat sidebar that stores user preferences. This is fine for general productivity. It is not a substitute for source material in a file, and for professional work involving client confidences, you should know exactly what gets stored and where before you let any tool "remember" matter details.

**For coding work, lean into background agents.** They are real. The tools that ship them well (Cursor, Claude Code, Codex) are meaningfully better at multi-step tasks than the synchronous chat-based predecessors.

I'll keep building Keepance on this thesis. Read the [Anthropic harnesses piece](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) if you want the technical foundation for why files beat chats for long-running work. It generalizes beyond coding more than it looks at first glance — and the professional work case is, if anything, stronger than the coding case once you factor in confidentiality obligations.
