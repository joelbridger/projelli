# Restart durability drive

Drive: `src/features/crm-projects/internal/internalProjects.test.tsx` —
`persists milestone progress and the selected project through a restart`.

1. Seeded an internal-only project named **New associate onboarding** with
   status `on_track`, two milestones, and collaborators David Kim and Jordan
   Lee through the feature-owned repository.
2. Rendered the Projects surface, completed the first milestone, then unmounted
   it to simulate closing the surface.
3. Rendered a fresh surface with the same durable repository.
4. Verified the selected detail panel reopened in the saved order with the
   project name, `1 / 2` milestone progress, and collaborators intact.
5. Verified the stored project has no `matterId` property. It has no client
   relationship.

Result: PASS. The browser-profile persistence adapter stores one validated,
feature-owned snapshot under `lantern:crm:internal-projects:v1`; corrupt data
starts honestly empty instead of inventing a project.
