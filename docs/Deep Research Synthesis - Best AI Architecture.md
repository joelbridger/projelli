Deep Research Synthesis - Best AI Architecture

## Bottom line

Do **not** transition directly from your current hierarchy into the full LangGraph + A2A + vector-database architecture described in the longer report. That would replace one coordination problem with a large infrastructure project.

The reports’ strongest shared conclusions are:

1. Eliminate the meta-coordinator hierarchy.
2. Establish one unambiguous owner.
3. Prevent workers from recursively delegating.
4. Communicate through structured task artifacts rather than conversations.
5. Give every coding worker an isolated Git worktree.
6. Require executable verification before accepting work.
7. Automate deterministic mechanics only after the manual workflow is stable.

The shorter report presents the correct **immediate operating model**. The longer report describes a reasonable **eventual automation model**, but overstates the immediate need for LangGraph, A2A, MCP, and vector memory.  

# The exact target architecture

## Stage 1: Use this immediately

```text
You
└── Opus 4.8 Extra High Lead
    ├── Codex Terra Worker A — isolated worktree
    ├── Codex Terra Worker B — isolated worktree
    ├── Codex Terra Worker C — isolated worktree
    ├── Opus 4.8 High Architecture Specialist — invoked when needed
    └── Opus 4.8 High Verification Specialist — fresh-context review
```

There is only **one coordinator**: the Opus Extra High lead.

The two other Opus sessions should no longer be coordinators. Repurpose them as bounded specialists:

| Current role                | New role                                             |
| --------------------------- | ---------------------------------------------------- |
| Opus Extra High coordinator | Lead architect-executor and sole task owner          |
| Opus High coordinator 1     | Architecture/database/API specialist                 |
| Opus High coordinator 2     | Reviewer, security analyst, and test-plan specialist |
| Codex Terra High fleets     | Direct workers assigned bounded tasks                |
| Tmux                        | Process visibility and persistence only              |
| Coordinator conversations   | Structured task and result files                     |
| Shared working directory    | One Git worktree per implementation task             |

The Opus specialists should not manage Codex workers. They receive one question, produce one artifact, and stop.

Workers should not talk to each other and should never spawn additional workers.

## Stage 2: Automate the control plane later

Once the flat workflow succeeds consistently, introduce a small deterministic controller:

```text
You
└── Deterministic controller
    ├── Opus Lead — creates plans and resolves ambiguity
    ├── Opus Specialist — architecture consultation
    ├── Codex Workers — implementation in worktrees
    ├── Deterministic gates — build, tests, lint, typecheck
    └── Opus Reviewer — invoked on risk or failure
```

The controller should manage:

* Task statuses and dependencies
* Worktree creation
* Tmux session creation
* Prompt delivery
* Test execution
* Retry limits
* Commit collection
* Merge eligibility
* Cleanup

The controller should **not** independently decide architecture. The Opus lead still does that. Code handles control flow; models handle judgment.

A Python script plus SQLite or YAML files is sufficient initially. LangGraph is appropriate only after your workflow contains meaningful branching, resumability requirements, or dozens of concurrent tasks.

# Migration procedure

## 1. Stop new delegation through the current coordinators

Allow currently active workers to reach a safe checkpoint, but do not send any new work through the two middle coordinators.

Have every active coordinator and worker produce a final handoff containing:

```yaml
task_id:
status: completed | in_progress | blocked
objective:
branch:
worktree:
latest_commit:
changed_files:
tests_run:
tests_passing:
decisions_made:
remaining_work:
blockers:
risks:
```

Do not ask the top coordinator to summarize other summaries. Preserve each handoff separately.

## 2. Make the Extra High Opus session the sole lead

Its responsibilities should be limited to:

* Interpret your product goal
* Maintain the current implementation plan
* Decompose work into bounded tasks
* Identify dependencies
* Assign tasks directly
* Decide which findings become architectural decisions
* Review evidence
* Approve merges
* Update durable project state

It should not:

* Relay messages between coordinators
* Personally perform every implementation
* Hold raw terminal logs in context
* Let workers create new work
* Accept completion based on prose
* keep an indefinitely growing conversation

Use a fresh lead session for each major feature or coherent project phase. Durable project state should survive outside the conversation.

## 3. Convert the two Opus coordinators into specialists

### Architecture specialist

Use this agent for:

* Schema changes
* Cross-domain architecture
* Complex state management
* API integration plans
* Data migration review
* Privacy and authorization boundaries
* Evaluating competing implementation approaches

It should usually be read-only. Its output should be an ADR, implementation specification, or risk assessment—not another set of delegated tasks.

### Verification specialist

Use this agent in a fresh context after implementation for:

* Diff review
* Missing requirements
* Security and privacy risks
* Regression analysis
* Test quality
* Cross-module effects
* Whether acceptance criteria are actually satisfied

The reviewer should receive the original task contract, the diff, and test evidence. It should not receive the implementer’s entire conversation.

## 4. Reduce the default Codex fleet size

Do not deploy a “fleet” merely because workers are available.

Default fan-out:

* One worker for a normal bounded implementation
* Two workers for genuinely independent frontend/backend or implementation/testing work
* Three or four workers for clearly separated modules
* Larger batches only for repetitive, independently mergeable tasks

Parallelism should follow file and dependency independence—not feature size.

Codex Terra High is well suited to:

* Codebase exploration
* Locating relevant files
* Narrow implementations
* Test creation
* Mechanical refactors
* Documentation extraction
* Reviewing logs or large file sets

For architecture-heavy, cross-cutting implementation, either assign a much smaller task to Terra or use a stronger implementation model. Do not compensate for insufficient task clarity by creating more Terra workers.

# Establish the repository as the system of record

Create this structure:

```text
AGENTS.md
docs/
  architecture/
    SYSTEM_OVERVIEW.md
    DECISIONS.md
  product/
    CURRENT_PRIORITIES.md
.agent/
  PROJECT_STATE.md
  TASK_QUEUE.yaml
  tasks/
    TASK-0001.yaml
  results/
    TASK-0001.json
  reviews/
    TASK-0001.md
  runs/
    TASK-0001.log
```

## `AGENTS.md`

Keep this focused on durable operational facts:

```markdown
# Repository instructions

## Architecture
- Important packages and their responsibilities
- Permitted dependency directions
- Data ownership boundaries

## Commands
- Install
- Development server
- Build
- Lint
- Typecheck
- Unit tests
- Integration tests
- End-to-end tests

## Coding rules
- Language and framework conventions
- Validation requirements
- Error-handling conventions
- Testing expectations

## Security
- Never read, print, or commit secrets
- Protected paths
- Authentication and authorization requirements
- Handling of client financial information

## Git workflow
- One worktree per implementation task
- Branch naming format
- Commit format
- Merge requirements

## Completion requirements
- Acceptance criteria satisfied
- Required tests passing
- Diff reviewed
- Result artifact written
```

Add nested `AGENTS.md` files only where a package has materially different rules.

## Task contract

Every delegated task should use the same schema:

```yaml
id: TASK-0124
title: Add meeting transcript status handling
objective: >
  Add explicit processing, completed, and failed states to the meeting
  transcript workflow.

context:
  relevant_files:
    - src/meetings/transcript-service.ts
    - src/meetings/types.ts
  architecture_decisions:
    - docs/architecture/ADR-014-transcript-processing.md

scope:
  allowed_paths:
    - src/meetings/**
    - tests/meetings/**
  prohibited_paths:
    - src/auth/**
    - infra/**

dependencies: []

acceptance_criteria:
  - Processing state is stored and returned by the API.
  - Failed processing includes a safe user-facing error.
  - Existing meeting records remain compatible.
  - Tests cover all three states.

verification:
  commands:
    - npm run typecheck
    - npm test -- tests/meetings
  reviewer_required: true

delivery:
  branch: agent/TASK-0124-transcript-status
  result_file: .agent/results/TASK-0124.json
  maximum_attempts: 2
```

## Worker result

```json
{
  "task_id": "TASK-0124",
  "status": "completed",
  "summary": "Added persisted transcript processing states.",
  "changed_files": [],
  "commit": "",
  "commands_run": [],
  "verification": {
    "typecheck": "passed",
    "tests": "passed"
  },
  "assumptions": [],
  "remaining_risks": [],
  "recommended_follow_up": null
}
```

This eliminates most coordinator-to-coordinator interpretation.

# Worktree workflow

For every implementation task:

```bash
git worktree add ../worktrees/TASK-0124 \
  -b agent/TASK-0124-transcript-status main
```

Launch the worker inside that directory:

```bash
tmux new-session -s TASK-0124 \
  -c ../worktrees/TASK-0124
```

The worker:

1. Reads `AGENTS.md`.
2. Reads its task file.
3. Modifies only allowed paths.
4. Runs required verification.
5. Commits its work.
6. Writes its result file.
7. Stops.

Before merging:

1. Rebase or merge the latest integration branch into the worktree.
2. Run verification again.
3. Run fresh-context review when required.
4. Merge only after gates pass.
5. Remove the worktree.

```bash
git worktree remove ../worktrees/TASK-0124
```

Tmux remains useful, but it is no longer carrying project state.

# Completion and escalation rules

Use a minimum-control ladder:

### Level 0: Lead handles it directly

Use for tiny changes that would cost more to delegate than execute.

### Level 1: One Codex worker

Use for bounded code changes with obvious acceptance criteria.

### Level 2: Parallel workers

Use only when tasks have separate file ownership and no unresolved dependency.

### Level 3: Independent Opus review

Trigger when a task affects:

* Authentication or authorization
* Financial or personally identifiable data
* Database migrations
* Meeting recording or transcript retention
* External integrations
* More than one architectural domain
* A large or difficult-to-understand diff
* Repeated test failures

### Level 4: Human decision

Escalate when:

* Product requirements conflict
* A migration may destroy data
* Security assumptions are unclear
* The implementation requires credentials or production access
* Two attempts have failed
* The architecture specialist and reviewer disagree materially

Set a hard retry limit—normally two implementation attempts. After that, do not allow an agent to continue improvising in the same context.

# What not to build yet

## Do not require A2A

A2A is useful when independently deployed agents from different systems communicate over a network. Your agents are local CLI processes controlled by you. A YAML task contract and JSON result contract provide most of the value with much less infrastructure.

## Do not introduce a vector database for project state

Repository facts, decisions, task statuses, and verification results are structured data. Store them in Git, YAML, JSON, or SQLite.

A vector store may eventually help retrieve historical investigations, but it should not become the authoritative source for task state or architectural decisions.

## Do not adopt LangGraph simply to launch tmux sessions

Start with a narrow Python controller. Add a graph framework when you have stable nodes, meaningful conditional routing, checkpoint recovery, and evidence that a simple state machine is becoming difficult to maintain.

## Do not allow specialists to become coordinators again

“Architecture specialist” must not slowly turn into “architecture coordinator with its own workers.” That recreates the current problem under a new title.

# Recommended transition order

1. Capture handoffs from every current agent.
2. Stop the middle coordinators from delegating.
3. Make Extra High Opus the sole lead.
4. Reinitialize the other Opus sessions as bounded specialists.
5. Introduce standardized task and result files.
6. Move every writable worker into its own worktree.
7. Enforce deterministic tests and fresh-context review.
8. Pilot the system on one medium-sized feature.
9. Refine the contracts based on actual failures.
10. Build a small Python/SQLite controller for repeated mechanics.
11. Consider LangGraph or a similar system only after the workflow itself is proven.

# Paste this into your current top coordinator

We are transitioning from a three-level coordinator hierarchy to a flat, artifact-driven engineering system.

You are now the sole Lead Architect-Executor. You are the only agent authorized to decompose project goals, create tasks, determine dependencies, assign workers, accept results, and approve integration.

The two existing Opus coordinators must no longer coordinate workers. Repurpose them as short-lived specialists:

1. Architecture Specialist: provides bounded architecture, schema, API, security, and implementation-plan analysis. It does not delegate.
2. Verification Specialist: reviews completed work in a fresh context against the original task contract, diff, and test evidence. It does not delegate.

All Codex workers report directly through structured task and result artifacts. Workers may not spawn other agents or communicate with one another. They receive one bounded task with explicit scope, prohibited paths, acceptance criteria, verification commands, retry limits, and delivery requirements.

Before changing the structure:

1. Request a structured handoff from every active coordinator and worker.
2. Record each active task, branch, worktree, commit, modified files, completed work, remaining work, decisions, tests, blockers, and risks.
3. Preserve these handoffs individually; do not replace them with a lossy combined summary.
4. Identify overlapping tasks or file ownership conflicts.
5. Pause new delegation until the state has been reconciled.

Create and maintain:

* `AGENTS.md`
* `docs/architecture/SYSTEM_OVERVIEW.md`
* `docs/architecture/DECISIONS.md`
* `.agent/PROJECT_STATE.md`
* `.agent/TASK_QUEUE.yaml`
* `.agent/tasks/`
* `.agent/results/`
* `.agent/reviews/`

Every writable worker must operate in a dedicated Git worktree and feature branch. Tmux is only an execution surface; it is not the project state or communication channel.

Default to one implementation worker. Use multiple workers only when tasks are genuinely independent, have separate file ownership, and can be verified separately. Do not parallelize dependency-heavy work.

Do not accept a worker’s statement that work is complete. Completion requires:

* Acceptance criteria explicitly checked
* Required tests run
* Build, typecheck, and lint run where applicable
* Changed files and commit identified
* Risks and assumptions reported
* Independent review when the task is security-sensitive, data-sensitive, cross-domain, or architecturally significant

Use no more than two implementation retries. After two failures, stop and produce a diagnosis rather than continuing the same loop.

Your immediate assignment is to design and execute this migration without beginning new product work. Produce:

1. A current-state inventory
2. A proposed flat role map
3. The initial repository artifact structure
4. Standard task and result schemas
5. A worktree and tmux operating procedure
6. A migration sequence that preserves all in-progress work
7. A list of decisions or conflicts requiring human resolution

Do not create another coordinator layer. Do not allow specialists or workers to delegate. Replace conversational coordination with durable, inspectable artifacts.

The key move is not “better communication between the three management layers.” It is removing those communication layers entirely and making tasks, evidence, and state explicit.
