# Business OS - Definition of Done

This document defines the quality criteria that must be met before any feature, ticket, or release can be considered "done." All team members should reference this document when completing work.

---

## Code Quality Requirements

### TypeScript Standards
- [ ] All code written in TypeScript with strict mode enabled
- [ ] No `any` types except where absolutely necessary (documented with `// eslint-disable-next-line` and explanation)
- [ ] All function parameters and return types are explicitly typed
- [ ] All interfaces and types are exported from `src/types/` or module-specific type files
- [ ] No TypeScript errors (`npm run typecheck` passes)

### Component Standards
- [ ] React components use functional component pattern with hooks
- [ ] Components follow shadcn/ui patterns and conventions
- [ ] Props interfaces are defined and exported
- [ ] Components are accessible (ARIA labels, keyboard navigation where applicable)
- [ ] Components handle loading, error, and empty states appropriately

### State Management
- [ ] Zustand stores follow established patterns in `src/stores/`
- [ ] Store actions use explicit braces for void returns (ESLint compliance)
- [ ] State is normalized where appropriate (avoid deeply nested structures)
- [ ] Selectors are used to access specific state slices

### Code Style
- [ ] ESLint passes with no errors (`npm run lint`)
- [ ] Prettier formatting applied (`npm run format`)
- [ ] No console.log statements in production code (use proper logging)
- [ ] Meaningful variable and function names
- [ ] Comments explain "why," not "what" (code should be self-documenting)

---

## Testing Requirements

### Unit Tests
- [ ] All workspace operations (CRUD for files/folders) have unit tests
- [ ] Path validation logic is tested (traversal blocking)
- [ ] History/undo operations are tested
- [ ] Schema validation (DocSummary, SourceCard, RunRecord) is tested
- [ ] Search indexing and querying is tested
- [ ] Edge cases and error conditions are covered

### Integration Tests
- [ ] Workspace creation flow is tested end-to-end
- [ ] "New Business Kickoff" workflow is tested with mock models
- [ ] File tree operations (create, rename, delete, move) are tested
- [ ] Editor tab and pane management is tested

### Security Tests
- [ ] Path traversal attempts are blocked (`../../../etc/passwd`)
- [ ] Symlink escape attempts are blocked
- [ ] Prompt injection in markdown is sanitized
- [ ] API keys are never logged or exposed

### Test Execution
- [ ] All tests pass (`npm run test`)
- [ ] Test coverage meets minimum threshold (aim for 80%+ on critical modules)
- [ ] No flaky tests (tests are deterministic and repeatable)

---

## Safety and Audit Requirements

### Audit Logging
- [ ] All AI actions are logged to the audit log
- [ ] Audit entries include: action type, timestamp, model, inputs, outputs, user decision
- [ ] Audit log is append-only (entries never deleted)
- [ ] Audit log is queryable by date range, action type, and model

### Diff Preview
- [ ] All destructive operations show diff preview before execution
- [ ] File overwrites show before/after comparison
- [ ] Bulk operations show affected file list
- [ ] User can cancel any destructive operation after preview

### Confirmation Model
- [ ] Non-destructive operations (read, search, create new) are auto-approved
- [ ] Destructive operations (delete, overwrite, move) require confirmation
- [ ] Confirmation dialogs clearly explain what will change
- [ ] Undo is available for reversible operations

---

## Documentation Requirements

### Code Documentation
- [ ] Complex functions have JSDoc comments explaining purpose and parameters
- [ ] Public APIs (services, hooks, utilities) are documented
- [ ] Module `index.ts` files have brief module description comment

### User-Facing Documentation
- [ ] New features are documented in README or user guide
- [ ] Breaking changes are documented in CHANGELOG.md
- [ ] Configuration options are documented

### Developer Documentation
- [ ] CHANGELOG.md is updated with all changes
- [ ] BACKLOG.md ticket status is updated
- [ ] DECISIONS.md is updated for significant architectural changes
- [ ] CLAUDE.md is updated if new patterns or conventions are established

---

## Performance Requirements

- [ ] Initial page load < 3 seconds (on standard hardware)
- [ ] File tree renders < 1 second for workspaces with 1000+ files
- [ ] Editor is responsive for documents up to 100KB
- [ ] Search returns results < 500ms for typical queries
- [ ] No memory leaks (verify with browser dev tools during extended use)

---

## Accessibility Requirements

- [ ] All interactive elements are keyboard accessible
- [ ] Focus management is handled correctly (modals trap focus, etc.)
- [ ] Color contrast meets WCAG AA standards
- [ ] Screen reader labels are present for non-text content
- [ ] Error messages are announced to assistive technology

---

## Build and Deployment

- [ ] Production build succeeds (`npm run build`)
- [ ] Build output is optimized (tree-shaking, minification)
- [ ] No build warnings (or warnings are documented and accepted)
- [ ] Tauri build succeeds (when Rust toolchain is available)

---

## Feature-Specific Checklists

### New UI Component
- [ ] Component created with TypeScript
- [ ] Props interface defined and exported
- [ ] Uses shadcn/ui patterns
- [ ] Accessible (ARIA, keyboard)
- [ ] Responsive (works on different screen sizes)
- [ ] Has unit test
- [ ] Storybook story (if applicable)

### New Module/Service
- [ ] Service interface defined in types
- [ ] Implementation follows established patterns
- [ ] Error handling is comprehensive
- [ ] Unit tests cover happy path and error cases
- [ ] Exported from module index.ts

### New Workflow
- [ ] Workflow template defined
- [ ] RunRecord captures all metadata
- [ ] Audit log entries created
- [ ] Re-run capability works
- [ ] Diff detection for changed outputs
- [ ] Integration test with mock model

### New API Integration
- [ ] Provider interface implemented
- [ ] Error handling for network failures
- [ ] Rate limiting handled
- [ ] Cost/latency metadata available
- [ ] API key stored securely
- [ ] Audit log entries for all calls

---

## Release Checklist

Before any release:

- [ ] All tests pass
- [ ] No ESLint errors
- [ ] CHANGELOG.md updated with version and date
- [ ] Version bumped in package.json
- [ ] Production build succeeds
- [ ] Manual smoke test completed
- [ ] Critical paths tested:
  - [ ] Workspace selection
  - [ ] File creation/editing
  - [ ] Workflow execution (with mock model)
  - [ ] Search functionality
  - [ ] Settings/API key management

---

## Ticket Completion Checklist

Before marking any BACKLOG.md ticket as DONE:

1. [ ] All acceptance criteria met
2. [ ] Tests written and passing
3. [ ] Code reviewed (self-review at minimum)
4. [ ] Documentation updated
5. [ ] CHANGELOG.md entry added
6. [ ] No new ESLint errors or warnings
7. [ ] Build passes

---

*This document defines the minimum quality bar for Business OS. When in doubt, err on the side of higher quality.*
