LANTERN PRODUCT RE-DESIGN PROMPT


```text
Launch two independent, dedicated product-design sessions in separate TMUX sessions:

1. One Fable 5 session at high effort.
2. One OpenAI 5.6 Sole session at high effort.

Give both sessions the exact same design assignment included below, verbatim. Each session must independently investigate the product, develop three foundational interface concepts, create prototypes, evaluate its concepts, and recommend a final design foundation.

The two sessions must work independently during exploration. Do not allow one session to see, inherit, or anchor on the other session’s conclusions. We want two genuinely independent expert perspectives—not one perspective echoed by two models.

Each session must have:

- Its own clearly named TMUX session
- Its own isolated output directory
- Permission to inspect the full application, documentation, feature map, and current interface
- No permission to implement or refactor the production application
- No permission to overwrite the other session’s artifacts

Suggested output locations:

- `design-exploration/fable-5/`
- `design-exploration/openai-5-6-sole/`

This assignment is strictly for product-design exploration and the recommended design foundation. Neither session should begin production implementation.

Give the following exact prompt to both sessions:

---

# Foundational Product Redesign Assignment

You are the dedicated lead product designer for a foundational redesign of this application.

Operate as a senior product designer with more than 20 years of experience in:

- Product design
- User-interface design
- Interaction design
- Information architecture
- Enterprise CRM products
- Financial-advisor workflows
- AI-native interfaces
- Meeting-intelligence software
- Complex desktop productivity applications

You have been given significant latitude. You may challenge existing assumptions, propose a radical redesign, reorganize major workflows, replace the current navigation model, and rethink how the product’s capabilities fit together.

Your responsibility is not to make the current interface incrementally better. Your responsibility is to determine what the interface should be for the product we have now.

## Background

The recent development push added a tremendous amount of capability, including a full CRM, meeting recording, AI search, and numerous connected advisor workflows.

This development push was successful in expanding the product’s capabilities, but it left the user interface scattered, unintuitive, inconsistent, and confusing. Features were added faster than the overall product experience could be reorganized around them.

That is acceptable for the previous phase. It is not acceptable for the next phase.

We now need to step back, reconsider the application from first principles, and create a coherent product-design foundation capable of supporting everything the application has become.

## Your Mission

Begin with the recently updated feature map. Verify it against the actual application, current interface, relevant documentation, and implemented functionality.

Then develop three genuinely distinct foundational design concepts for the desktop application.

Each concept must demonstrate how all of the product’s capabilities can be organized into a simple, intuitive, cohesive system based on:

- User purpose
- Workflow
- Frequency
- Urgency
- Context
- Relationships between information
- Progressive disclosure
- The user’s mental model

Do not organize the interface according to:

- The codebase
- The database structure
- The order in which features were developed
- Existing navigation simply because it already exists
- A flat list of everything the product can do

The product combines conventional CRM capabilities with meeting preparation, recording, transcription, AI search, client intelligence, communications, documents, and workflow management. These must feel like parts of one harmonious system—not separate products joined by navigation.

## North Star

The finished experience must feel:

- Simple
- Intuitive
- Clean
- Minimal
- Calm
- Cohesive
- Focused
- Purposeful
- Powerful without appearing complicated

The product should make a large and sophisticated capability set feel surprisingly understandable.

Minimalism and “less is more” are foundational principles, not decorative preferences. However, minimalism must not be achieved by eliminating valuable functionality. It must be achieved through:

- Clear hierarchy
- Intelligent defaults
- Contextual actions
- Progressive disclosure
- Strong information architecture
- Reduced decision load
- Thoughtful use of space
- Consistent interaction patterns
- Showing users what matters at the moment they need it

The standard is not merely “cleaner than the current UI.” The standard is complete conceptual harmony.

The final organization should feel inevitable: once seen, users should wonder why the product would be structured any other way.

## Product Context

This is not a typical CRM. It includes or is intended to include:

- Full CRM capabilities
- AI search and question answering
- Chat-based interaction with product and client information
- Client and household intelligence
- Meeting preparation
- Meeting recording
- Transcription
- Meeting summaries and follow-up
- Tasks and workflow management
- Files and documents
- Emails, notes, and communications
- Opportunities and relationship management
- Other capabilities documented in the latest feature map

Treat the updated feature map as the source of truth for capabilities, but not as a proposed navigation structure.

Existing CRMs should be studied for proven patterns, but copying an existing CRM is not acceptable. The product should feel familiar enough to understand quickly while being specifically designed around its unusual combination of CRM, meetings, context, and AI.

## Platform Scope

Design for a desktop experience only.

Do not dilute the concepts by attempting to solve mobile or tablet layouts during this assignment. Optimize for a professional user working for extended periods on a desktop or laptop.

You may propose a radical redesign with major workflow changes. The current layout, navigation, page structure, terminology, feature grouping, and interaction patterns are all open to reconsideration.

Preserve existing patterns only when they are demonstrably the best answer—not merely because they already exist.

## Known Interface Preferences and Requirements

The following should inform the concepts without becoming a substitute for thoughtful information architecture.

### AI Search

AI search should offer a ChatGPT-like conversational experience.

It should include:

- A primary conversational workspace
- Conversation history accessible through left-side vertical navigation
- Clear creation of a new conversation
- Easy movement between previous conversations
- Strong readability for longer AI responses
- Support for citations and source inspection
- Clear representation of which client, household, workspace, or dataset is in context
- Natural transitions between global AI search and client-specific AI work
- Contextual actions that allow the user to act on AI results

Do not treat AI as a generic chat panel bolted onto the CRM. Determine how conversational AI should relate to clients, meetings, tasks, documents, emails, records, and workflows throughout the product.

### Tabs

Horizontal tabs and especially vertical tabs are preferred interaction patterns.

Nested tabs may be used to make complex information feel simpler and more manageable. Explore how layered horizontal and vertical tab systems could establish hierarchy within large workspaces such as:

- Client or household records
- AI conversations
- Meetings
- Documents
- Communications
- Tasks
- CRM entities
- Settings or administrative areas

Use tabs intentionally. They should clarify scope and hierarchy, not produce ambiguous navigation, excessive nesting, hidden content, or confusion about the user’s current location.

At every level, the user should understand:

- Where they are
- What object or workspace they are viewing
- What the available sections represent
- How to move back or laterally
- Whether an action affects the current section, current client, or entire application

These preferences are important, but you may challenge their application in specific places if you identify a clearly superior solution. Explain any such decision.

## Primary Questions

Each design concept must answer:

- What is the application’s primary organizing principle?
- What should users see when they first open it?
- What deserves permanent placement in global navigation?
- What should remain contextual or progressively disclosed?
- How should global navigation work?
- What is the relationship between global work and client-specific work?
- What belongs at the workspace level?
- What belongs at the client or household level?
- How should AI search relate to the CRM?
- Where should AI conversations live?
- How does the user move between global AI search and client-specific conversations?
- How should meetings connect to clients, tasks, notes, documents, and follow-up?
- How should users prepare for, conduct, record, and follow up on meetings?
- How should the product support both fast daily actions and deeper client work?
- How should advanced capabilities remain discoverable without becoming constantly visible?
- Which entities deserve dedicated destinations, and which should appear inside contextual workflows?
- How should tabs and nested navigation work without creating confusion?
- How can the interface remain calm when the underlying product is complex?

## Required Process

### Phase 1: Understand the Product

Locate and thoroughly study:

- The latest feature map
- Product documentation
- The existing application
- The current interface
- Major implemented workflows
- Relevant code or route structure where it helps verify actual functionality

Identify:

- Primary user types
- Core user jobs
- High-frequency actions
- High-importance but lower-frequency actions
- Major end-to-end workflows
- Major product objects and entities
- Relationships between those objects
- Existing inconsistencies
- Duplicate or overlapping capabilities
- Gaps between the feature map and the implemented product
- Assumptions requiring validation

Do not assume the current interface accurately expresses the product.

Create a concise product model that inventories the application’s:

- Objects
- Actions
- Destinations
- Workflows
- Relationships
- System-level functions
- Contextual functions

Clearly distinguish verified facts from your assumptions.

### Phase 2: Establish the Information Architecture

Organize the product’s capabilities according to the user’s mental model.

Determine:

- Global versus contextual capabilities
- Workspace-level versus client-level functionality
- Primary versus secondary destinations
- Persistent versus contextual tools
- High-frequency versus occasional actions
- Core objects versus supporting objects
- Items requiring dedicated pages versus embedded views
- Appropriate progressive-disclosure levels

Define the relationships among concepts such as:

- Clients
- Households
- Contacts
- Prospects
- Opportunities
- Meetings
- Tasks
- Workflows
- Communications
- Emails
- Notes
- Documents
- Recordings
- Transcripts
- AI conversations
- AI-generated outputs

The information architecture must express these relationships clearly without exposing the full underlying complexity at once.

### Phase 3: Study Relevant Product Patterns

Study relevant patterns from:

- Modern CRMs
- Financial-advisor software
- Meeting-intelligence tools
- AI workspaces
- Knowledge-management products
- Email and communication tools
- Desktop productivity applications

Extract applicable principles and interaction patterns.

For each major borrowed pattern, explain:

- What problem it solves
- Why it applies here
- How it must be adapted for this product
- What should not be copied

Do not produce a collage of competitor ideas. Use research to create a coherent product-specific system.

### Phase 4: Develop Three Foundational Concepts

Create three genuinely different interface concepts.

They must not be:

- Three visual styles
- Three color or typography treatments
- Minor variations of the same navigation
- The same layout with different labels
- Arbitrary combinations of existing features

Each concept must offer a meaningfully different answer to the application’s fundamental organizational problem.

For each concept, provide:

1. Concept name

2. Concise design thesis

3. Primary organizing principle

4. User mental model

5. Global navigation model

6. Home or command-center structure

7. Client or household workspace structure

8. AI-search and conversation model

9. CRM model

10. Meeting lifecycle model

11. Task and workflow model

12. Document and communication model

13. Use of horizontal, vertical, and nested tabs

14. Progressive-disclosure strategy

15. Major interaction patterns

16. Representative end-to-end user journeys

17. Detailed written wireframes

18. An interactive HTML prototype

19. Major strengths

20. Major risks and tradeoffs

21. Why the concept is fundamentally different from the other two

## Written-Wireframe Requirements

Produce detailed written wireframes for each concept’s most important screens.

At minimum, cover:

- Global application shell
- Home or command center
- AI search
- AI conversation history
- Client or household list
- Client or household workspace
- Meeting preparation
- Active or recorded meeting
- Meeting summary and follow-up
- Tasks or workflows
- Documents and communications

For each screen, describe:

- Overall layout
- Global navigation
- Local navigation
- Primary content region
- Secondary panels
- Tabs and hierarchy
- Primary actions
- Contextual actions
- Empty states
- Relevant status indicators
- Progressive-disclosure behavior
- Important transitions to other screens
- What remains intentionally hidden until needed

The written wireframes should be detailed enough that another designer could create high-fidelity screens without having to reinterpret the underlying structure.

## Interactive HTML Prototype Requirements

Create a separate interactive HTML prototype for each of the three concepts.

The prototypes are structural product-design prototypes, not production implementations. Their purpose is to make the proposed information architecture and interaction model tangible.

Each prototype should:

- Be optimized for desktop
- Be easy to launch locally
- Use realistic representative data
- Demonstrate the global application shell
- Include working navigation
- Demonstrate vertical and horizontal tab behavior
- Demonstrate any proposed nested-tab system
- Include a functional representation of AI conversation history
- Include a ChatGPT-like AI conversation view
- Show movement between global AI and client-specific AI contexts
- Include a client or household workspace
- Demonstrate the meeting lifecycle
- Show contextual actions and progressive disclosure
- Include enough screens to evaluate the concept as a coherent system
- Clearly indicate which elements are interactive
- Prioritize information architecture and interaction clarity over visual polish

The three prototypes should remain separate so that each concept can be evaluated on its own terms.

Do not connect these prototypes to production services or modify the production application.

## Phase 5: Evaluate the Concepts

Evaluate all three concepts against a consistent decision framework.

At minimum, compare:

- Immediate comprehensibility
- Navigation clarity
- Information scent
- Workflow efficiency
- Cognitive load
- Learnability
- Suitability for frequent daily use
- Ability to support complex client work
- CRM completeness
- Integration of meetings
- Integration of AI
- Global-to-client context switching
- Scalability as features expand
- Progressive disclosure
- Consistency
- Usefulness of the tab model
- Visual and conceptual simplicity
- Implementation risk
- Risk of user disorientation

Use an explicit comparison matrix. Scores may support the analysis, but they must not replace reasoned judgment.

Identify:

- The strongest concept
- The weakest parts of each concept
- Any assumptions that could change the recommendation
- Which design decisions require user testing
- Which decisions can be made confidently now

## Phase 6: Recommend the Design Foundation

Select the strongest direction.

If a deliberate hybrid is genuinely stronger, identify exactly which parts should be combined and why. Do not create a compromise merely to preserve elements from every concept.

For the recommended direction, deliver:

- Final design thesis
- Final information architecture
- Global navigation model
- Page and workspace hierarchy
- Core screen inventory
- Client and household workspace model
- AI-search and conversation model
- Meeting lifecycle
- CRM interaction model
- Task and workflow model
- Document and communication model
- Horizontal- and vertical-tab strategy
- Rules governing nested tabs
- Progressive-disclosure strategy
- Primary interaction patterns
- Representative end-to-end workflows
- Detailed written wireframes
- A refined interactive HTML prototype
- Design principles future work must follow
- Known risks and unresolved questions
- Suggested user-testing priorities
- A phased redesign and implementation plan

The implementation plan should describe sequencing and dependencies only. Do not begin implementing the redesign in the production application.

## Required Deliverables

Organize your output directory so it is easy to inspect.

At minimum, produce:

1. `01-product-understanding.md`
2. `02-information-architecture.md`
3. `03-relevant-patterns.md`
4. `04-concept-one.md`
5. `05-concept-two.md`
6. `06-concept-three.md`
7. `07-concept-comparison.md`
8. `08-recommended-foundation.md`
9. `09-implementation-roadmap.md`
10. `prototypes/concept-one/`
11. `prototypes/concept-two/`
12. `prototypes/concept-three/`
13. `prototypes/recommended-direction/`
14. `README.md` explaining how to review and launch the prototypes

You may adjust filenames if necessary, but preserve this overall separation and clarity.

## Quality Standard

Be rigorous, opinionated, and willing to challenge the product’s existing assumptions.

Regularly test whether the design is becoming genuinely simpler or merely visually cleaner.

Avoid:

- Dashboards filled with low-value widgets
- Navigation organized around the database
- Large numbers of equally weighted menu items
- Exposing every feature at all times
- Treating every feature as a top-level destination
- AI implemented as an unrelated side panel
- Hiding poor information architecture behind search
- Copying CRM conventions without evaluating their fit
- Using nested tabs without a clear hierarchy
- Breadcrumbs, tabs, sidebars, and headers that communicate conflicting locations
- Visual polish before the structure is sound
- Removing important functionality to create superficial simplicity
- Concepts that differ only cosmetically
- Premature production implementation

Favor:

- Clear hierarchy
- Stable mental models
- Contextual actions
- Strong information scent
- Intelligent defaults
- Progressive disclosure
- Calm screen composition
- Coherent global and local navigation
- Consistent object relationships
- Fast access to high-frequency actions
- Deep capability when users intentionally seek it
- AI interactions grounded in the user’s current context
- Familiar patterns used with purpose
- Radical changes when they produce a substantially better experience

## Working Expectations

- Work autonomously and deeply.
- Inspect the actual product rather than relying only on this prompt.
- Keep an explicit list of assumptions and unresolved questions.
- Do not silently invent product requirements.
- Make reasonable provisional assumptions when necessary and label them.
- Do not stop at abstract recommendations.
- Make every concept concrete through written wireframes and interactive prototypes.
- Do not settle on the first plausible structure.
- Do not allow the current UI to anchor the exploration.
- Do not implement the redesign in the production application.
- Complete the full exploration, comparison, recommendation, and design-foundation package.

Your responsibility is to create a coherent foundational design system capable of making an unusually powerful product feel simple.

Nothing less than a genuinely intuitive, elegant, minimal, and harmonious interface is sufficient.

---

After launching both sessions, monitor them for completion and technical blockers, but do not steer either toward the other’s ideas.

When both have completed, report:

- The TMUX session names
- The output location for each session
- Whether every required deliverable was completed
- How to launch each interactive prototype
- Any unresolved questions or blockers raised by either session

Do not merge their recommendations, select a winner, or begin implementation unless explicitly instructed to do so afterward.
```
