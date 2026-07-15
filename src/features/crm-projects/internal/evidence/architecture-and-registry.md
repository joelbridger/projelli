# Architecture and registry evidence

- No type moved between `src/platform/` and `src/features/`; the architecture
  DAG guard is not required for this lane.
- Existing CRM Home registry validation is machine-enforced in
  `src/features/crm-home/registry.test.ts`: it checks duplicate routes and
  shortcuts, parent routes, and every locale-backed descriptor label.
- The documented registry mount procedure is
  `docs/skills/add-crm-destination/SKILL.md`.
- Focused registry validation passed after adding the feature-owned
  `internal-projects` descriptor. It uses the unique route `internal-projects`
  and the supported `flagId: 'internal-projects'` field.
