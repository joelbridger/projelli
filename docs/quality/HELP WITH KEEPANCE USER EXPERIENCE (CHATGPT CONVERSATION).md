HELP WITH KEEPANCE USER EXPERIENCE (CHATGPT CONVERSATION)

---

Jameson:

Here's my situation: I'm using Claude Code to develop a software product called Keepance (www.keepance.com) - And it does a lot of things really well, like spawns sub-agents to do excellent back-end work, but when it comes to the front-end and high-level user experience thinking in terms of invisible design and making this product so easy to use that it will be a no-brainer for our target audience financial advisors - When it comes to that level of analysis and improvement, it does miss things and it doesn't seem to be able to fully look at the user experience at a high level To identify confusing elements or visually unpleasing elements or just at a high level for the user flow to be able to make this a super simple and intuitive experience for real humans.I drafted the prompt below to try to get it to help me on this front, but I'm not sure it will be successful, so I wanted to get your help first. Can you do some deep online research to figure out what others are doing to get CloudCode to improve high level user experience, both visually and cognitively? then give me an improved prompt that will actually work.

ORIGINAL PROMPT:
Okay, it looks like fantastic progress is being made - But I have one huge concern: Up until this point, Claude Code has been decent at improving the user experience when I ask it to. But usually I have to do a lot of manual work going through and creating a pleasant, streamlined, and intuitive user experience. I'm not sure if I'm not writing the right prompts, but it will often miss UX/UI issues and overall user experience issues. Instead of me testing it manually when you are done with all of the fixes, do you have any suggestions about how you could Spawn one or more new Claude instances that will effectively act as senior UX/product designers To evaluate at a high level the ease of use of this product. Because this is a complex product, it is absolutely essential and mission critical that the onboarding and general use be easy and intuitive. At the core, this product is helping financial advisors search their files successfully, whether it be from their desktop, from their email, or from Wealthbox. In addition, financial advisors already do not know much about AI, and so anything around a local AI model has to be so easy that it simply just works. That's exactly what we're trying to get with this product, is that it simply just works. That things just work for the user that they don't have to do manually, and that there isn't anything to confuse them. Please Document and remember that these users are not AI savvy or generally technically savvy at all. So they need a product that is so easy to use that it becomes invisible in their workflow. That is our goal here, invisibility in the workflow. And so I need you to accomplish this. This is absolutely the number one objective. So it doesn't matter if we need to reevaluate the way we're testing this product or the fundamental design structure, etc. Before you spawn other instances, please interview me thoroughly about this so that we can align on this.
@Web search 

---

ChatGPT:

## What the research points to

Your original prompt has the right **strategic concern**, but it is still too soft operationally. It asks Claude Code to “act like a senior UX/product designer,” but it does not force a repeatable UX evaluation loop, real browser inspection, screenshots, task-based walkthroughs, or objective judgment criteria.

The strongest pattern I found is: **do not ask Claude Code to generally “improve UX.” Make it run a UX audit pipeline.** Anthropic’s own Claude Code best practices emphasize exploring first, planning before implementation, using screenshots/images and files as rich context, letting Claude interview you for large features, and requiring verification evidence rather than accepting claims of success. ([Claude Code][1])

For frontend/UX work specifically, the best setup is to give Claude Code “eyes” and a structured review harness. Playwright MCP lets Claude Code interact with your app through the browser, inspect the accessibility tree, click through flows, fill forms, and take screenshots; the official setup command is `claude mcp add playwright npx @playwright/mcp@latest`. ([Playwright][2]) Shipyard’s practical writeup says the same pattern is useful for Claude Code because it lets the agent visit the app, interact with it live, and capture screenshots for validation. ([Shipyard][3])

The second strong pattern is **specialized, read-only subagents**. Claude Code subagents are useful because each one gets isolated context, can work in parallel, and can carry specialized instructions without polluting the main session. ([Claude Code][4]) A community workflow for UI review specifically recommends Playwright MCP plus a UX subagent focused on visual design, UX, and accessibility, while **not allowing that UX subagent to make changes** so it does not thrash the codebase. Treat that as anecdotal, but it matches the official subagent model well. ([Reddit][5])

The third pattern is **encode design judgment into criteria**, not taste. Nielsen Norman Group’s 2026 guidance on design in the AI era argues that teams need to define what “good” looks like through explicit evaluation criteria, then judge, evaluate, and iterate. ([Nielsen Norman Group][6]) That matters for Keepance because “easy,” “intuitive,” and “invisible” are good goals, but Claude needs them translated into checks like: Can a nontechnical advisor complete first search without understanding AI? Does every indexing/local-model state explain what is happening? Can the user recover from no-results, disconnected email, expired Wealthbox auth, or missing local model?

There is also a Claude-specific frontend issue: Anthropic notes that Opus 4.8 has a persistent default frontend aesthetic that can feel wrong for dashboards, fintech, healthcare, or enterprise apps unless you specify a concrete alternative or ask it to propose visual directions before building. ([Claude Platform][7]) For Keepance, you should explicitly tell it: **enterprise fintech, calm, precise, low-cognitive-load, no generic AI aesthetic, no purple-gradient SaaS look, no editorial cream/serif/terracotta default.**

For AI UX, NN/g’s chatbot research is very relevant even if Keepance is not “just a chatbot.” Users expect direct, scannable answers, not conversation; they type short imperfect queries; they want answers first and detail on demand. ([Nielsen Norman Group][8]) Their AI-chatbot guidelines also recommend clearly showing what the system can do, using relevant suggested prompts, progressive disclosure, and avoiding interfaces that force users to understand internal architecture. ([Nielsen Norman Group][9]) That maps directly to Keepance: advisors should not need to know what a local model, embedding, index, RAG pipeline, connector, or vector store is.

Financial-advisor context also supports your concern. eMoney’s advisor AI research surveyed 400 financial advisors and interviewed wealth-management executives; it found that 78% of advisors anticipated moderate-to-significant AI-driven changes, while also emphasizing efficiency, client relationships, and human judgment.  So Keepance should position AI as **quiet workflow support**, not as a technical system the advisor has to manage.

## Use this improved prompt

Paste this into Claude Code in **plan mode first**, ideally after installing Playwright MCP. Do not let it jump straight into implementation.

```text
I need you to run a rigorous senior-level UX/product-design audit of Keepance before doing any more implementation.

This is not a normal bug-fix pass. This is a product simplification and usability pass for real financial advisors.

<context>
Product: Keepance
Audience: Financial advisors, RIAs, advisory teams, and operations staff.
Core job: Help advisors search and use their own client information from desktop files, email, and Wealthbox, then get cited answers and useful client context without needing to understand AI.
Critical constraint: Many target users are not AI-savvy and are not deeply technical. They are busy, privacy-conscious, skeptical, compliance-sensitive, and easily frustrated by unclear setup or unexplained AI behavior.
North star: Keepance should become invisible in the advisor’s workflow. The product should feel like “my client information is finally organized and searchable,” not “I am operating an AI system.”
</context>

<highest_priority_goal>
Make Keepance dramatically easier to understand, onboard into, trust, and use. Optimize for cognitive simplicity, obvious next steps, low setup friction, clear system status, trustworthy cited answers, and minimal manual configuration.
</highest_priority_goal>

<important_instruction>
Do not start coding yet.

First interview me thoroughly. Use AskUserQuestion if available. Ask non-obvious questions about the target user, onboarding, product promise, required data sources, local AI model behavior, compliance expectations, design tone, current frustrations, and which workflows matter most. Ask in batches so I can answer clearly.

After the interview, create a written UX audit plan and wait for my approval before implementation.
</important_instruction>

<working_principles>
1. Do not evaluate the app as a developer. Evaluate it as a tired, nontechnical financial advisor trying to get work done between client meetings.
2. Treat every confusing term, every extra choice, every unnecessary setup step, every ambiguous status, and every unexplained AI concept as a UX defect.
3. Prefer default automation over user configuration.
4. Prefer progressive disclosure over exposing advanced options.
5. Prefer plain financial-advisor language over AI/engineering language.
6. Prefer task success over feature visibility.
7. Prefer fewer, clearer actions over more powerful but confusing interfaces.
8. Preserve trust. Users must always understand what data is being accessed, what is local, what is sent to an AI provider, what is cited, what failed, and what they can do next.
9. Do not do a big visual redesign unless it materially improves usability, trust, or comprehension.
10. Do not praise the current UX unless you have evidence from task walkthroughs.
</working_principles>

<visual_direction>
Keepance should feel like enterprise fintech / professional advisory software:
- calm
- precise
- trustworthy
- modern
- restrained
- clear
- low cognitive load
- high information confidence

Avoid:
- generic AI/SaaS purple gradients
- decorative “AI magic” visuals
- warm editorial cream/serif/terracotta defaults
- playful startup styling
- dense technical dashboards
- unnecessary animations
- jargon-heavy setup screens

Use the existing design system if there is one. If there is no coherent design system, identify that as a finding and propose a small, concrete design direction before building.
</visual_direction>

<primary_workflows_to_audit>
Audit these workflows end to end. If some are not implemented yet, audit the intended UX and current partial state.

1. First launch / first-run onboarding
   - Can a financial advisor understand what Keepance does in under 30 seconds?
   - Is the next step obvious?
   - Does the product avoid asking technical questions too early?

2. Connecting desktop files
   - Can the advisor safely choose folders/files?
   - Is privacy clear?
   - Is indexing status understandable?
   - Does the user know when the product is ready?

3. Connecting email
   - Is the connection flow understandable and trustworthy?
   - Are permissions explained in normal language?
   - Are errors recoverable?

4. Connecting Wealthbox
   - Is the purpose clear?
   - Is OAuth/API setup hidden as much as possible?
   - Are expired/disconnected states clear?

5. Local AI model setup
   - Does this “just work”?
   - If a model must be downloaded, selected, started, or repaired, is that handled automatically or explained simply?
   - Does the user ever need to understand model names, ports, embeddings, RAG, vector databases, or provider internals? If yes, flag it.

6. Asking a question / searching client files
   - Is it clear what the user can ask?
   - Are suggested starter questions useful?
   - Does the product handle short, messy advisor-style queries?
   - Are results direct, scannable, and cited?
   - Can the user open or verify sources easily?

7. No-results / bad-results recovery
   - Does the product explain why it could not answer?
   - Does it suggest practical next steps?
   - Does it avoid making the user feel like they did something wrong?

8. Trust, privacy, and compliance moments
   - Does the product clearly explain what data stays local and what leaves the machine?
   - Are citations and source documents easy to inspect?
   - Are limitations clear without being scary?

9. Returning user workflow
   - Can an advisor return later and immediately continue work?
   - Does the app remember context without feeling creepy or opaque?
   - Are recent clients, recent searches, and unfinished setup steps surfaced appropriately?

10. Drafting or using an answer
   - Can the advisor turn an answer into a client email, note, memo, or task without friction?
   - Is generated text clearly grounded in sources?
</primary_workflows_to_audit>

<subagent_strategy>
Spawn specialized read-only subagents for the audit. The subagents may inspect files, routes, components, tests, screenshots, and the running app, but they must not edit code.

Use these subagents or equivalents:

1. Advisor Workflow Critic
Role: A senior product designer specializing in financial-advisor workflows.
Focus: end-to-end task flow, onboarding, mental model, information architecture, setup friction, task success.

2. Cognitive Load & Microcopy Critic
Role: A UX writer and cognitive-load specialist.
Focus: labels, empty states, onboarding copy, status messages, error messages, AI explanations, jargon removal, progressive disclosure.

3. Visual Design Critic
Role: A senior fintech/enterprise visual designer.
Focus: hierarchy, spacing, density, typography, contrast, alignment, component consistency, visual polish, trust, dashboard clarity.

4. AI Trust & Privacy Critic
Role: A product designer for privacy-sensitive AI systems.
Focus: local-vs-cloud clarity, citations, source inspection, hallucination prevention cues, permission clarity, model/setup states, confidence and limitations.

5. Accessibility & Interaction Critic
Role: Accessibility-minded UX engineer.
Focus: keyboard navigation, focus states, contrast, form labels, screen-reader semantics, responsive behavior, loading states, error recovery.

6. Technical UX Feasibility Planner
Role: Senior frontend engineer with product sense.
Focus: identify the smallest safe code changes that would fix the highest-impact UX problems without destabilizing the app.
</subagent_strategy>

<browser_and_visual_inspection>
Use Playwright MCP if available. Actually run the app and walk through the flows. Take screenshots at meaningful states:
- first launch
- onboarding start
- data-source setup
- indexing/loading states
- first successful answer
- no-results state
- error states
- settings/local model state
- Wealthbox/email connection state if available

If Playwright MCP is not available, tell me exactly what you need to inspect visually and pause for screenshots rather than guessing from code.
</browser_and_visual_inspection>

<evaluation_framework>
Evaluate each workflow using these criteria:

A. Comprehension
- Does the user understand what this screen is for?
- Does the user understand what to do next?
- Are terms familiar to financial advisors?

B. Effort
- How many decisions does the user have to make?
- Which decisions could be removed, defaulted, delayed, or automated?

C. Confidence
- Does the user know the system is working?
- Does the user know what data is being used?
- Does the user know whether an answer is grounded in sources?

D. Recovery
- If something fails, does the user know what happened and what to do?
- Are error states written in human language?

E. Trust
- Does the product feel safe for confidential client work?
- Are citations, permissions, and data boundaries visible at the right moments?

F. Visual clarity
- Is the most important action visually dominant?
- Is the hierarchy obvious?
- Is the interface too dense, too sparse, too generic, or visually inconsistent?

G. Invisibility
- Can the product fade into the advisor’s existing workflow?
- Or does it force the user to operate, configure, or supervise the AI?
</evaluation_framework>

<output_required_before_coding>
Create these files before implementation:

1. docs/ux/KEEPANCE_UX_AUDIT.md
Include:
- executive summary
- target-user assumptions
- primary workflows inspected
- screenshots or screenshot paths used as evidence
- top 10 UX problems
- all findings grouped by workflow
- severity, confidence, evidence, user impact, and recommended fix for each finding
- list of jargon/terms to remove or replace
- list of moments where the app exposes technical implementation details
- list of missing empty states, loading states, and recovery states

2. docs/ux/KEEPANCE_SIMPLIFICATION_PLAN.md
Include:
- proposed simpler product model
- proposed onboarding flow
- proposed data-source setup flow
- proposed local AI/model handling flow
- proposed search/answer flow
- proposed no-results/error recovery flow
- what to hide under advanced settings
- what to remove entirely
- what to defer until later

3. docs/ux/KEEPANCE_UX_ACCEPTANCE_CRITERIA.md
Include clear pass/fail criteria such as:
- A first-time advisor can understand the product promise in under 30 seconds.
- A first-time advisor can connect a folder and ask a first question without seeing technical AI terms.
- Every answer shows sources/citations clearly.
- Every loading/indexing/model state explains what is happening and whether the user needs to act.
- Every error state gives one plain-language next step.
- The product never requires users to understand embeddings, vector search, local model ports, or RAG.
</output_required_before_coding>

<finding_format>
For each issue, use this structure:

Issue ID:
Severity: P0 / P1 / P2 / P3
Confidence: High / Medium / Low
Workflow:
Screen/route/component:
Evidence:
What a financial advisor may think:
Why this hurts adoption:
Violated principle:
Recommended fix:
Simplest implementation path:
Risk of over-fixing:
</finding_format>

<implementation_rules_after_approval>
After I approve the audit and plan:

1. Implement only P0 and P1 fixes first unless I explicitly approve more.
2. Work in small, reviewable batches.
3. Before each batch, state the exact user problem being solved.
4. After each batch, run relevant tests and use Playwright/screenshots to verify the visible result.
5. Do not claim success without evidence.
6. Update docs/ux/KEEPANCE_UX_ACCEPTANCE_CRITERIA.md if new UX rules are discovered.
7. If a proposed fix requires a larger product decision, stop and ask me.
</implementation_rules_after_approval>

<first_task_now>
Start by interviewing me. Ask the most important questions needed to define the financial-advisor user, the intended first-run experience, the must-work workflows, the local AI/model expectations, and the current areas that feel confusing or visually weak. Do not code yet.
</first_task_now>
```

## Add this as a recurring rule later

After the audit works once, make Claude Code turn the process into a reusable skill, not a giant prompt you paste every time. Claude Code skills are designed for reusable workflows and load only when used, while `CLAUDE.md` should stay short and reserved for persistent project rules. ([Claude API Docs][10])

Add a short rule like this to `CLAUDE.md`:

```md
# Keepance UX North Star

Keepance is for financial advisors who are busy, privacy-conscious, and not AI/technical experts. The product should feel invisible in their workflow.

Default UX rules:
- Use plain financial-advisor language, not AI/engineering language.
- Hide technical AI details unless required for troubleshooting.
- Prefer automatic defaults over configuration.
- Every answer needs clear sources/citations.
- Every loading, indexing, connector, and local-model state must explain what is happening and whether the user needs to act.
- Every error state must provide one clear next step.
- Use enterprise fintech visual restraint: calm, precise, trustworthy, not generic AI/SaaS styling.
- Before major frontend changes, run the UX audit skill and verify with screenshots.
```

The key change: you are no longer asking Claude Code, “Can you think about UX?” You are forcing it to behave like a **multi-role UX review system with evidence, screenshots, pass/fail criteria, and no implementation until alignment**. That is much more likely to catch invisible-design problems than a normal Claude Code session.

[1]: https://code.claude.com/docs/en/best-practices "Best practices for Claude Code - Claude Code Docs"
[2]: https://playwright.dev/docs/getting-started-mcp "Playwright MCP | Playwright"
[3]: https://shipyard.build/blog/playwright-mcp-screenshots/ "Shipyard | Taking screenshots of your app with the Playwright MCP server"
[4]: https://code.claude.com/docs/en/agent-sdk/subagents "Subagents in the SDK - Claude Code Docs"
[5]: https://www.reddit.com/r/ClaudeAI/comments/1nmolsb/question_what_is_the_best_way_and_your_experience/ "Question: what is the best way and your experience letting CC build a good UI? : r/ClaudeAI"
[6]: https://www.nngroup.com/articles/ai-era-critique/ "The Core Skill of Design in the AI Era: Critique - NN/G"
[7]: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8 "Prompting Claude Opus 4.8 - Claude Platform Docs"
[8]: https://www.nngroup.com/articles/less-chat-more-answer/?lm=ai-era-critique&pt=article "Less Chat, More Answer: Site AI Chatbots Need to Get to the Point - NN/G"
[9]: https://www.nngroup.com/articles/ai-chatbots-design-guidelines/?lm=ai-era-critique&pt=article "10 Guidelines for Designing Your Site’s AI Chatbots - NN/G"
[10]: https://docs.anthropic.com/en/docs/claude-code/skills "Extend Claude with skills - Claude Code Docs"
