# Internal Projects visual acceptance checklist

Capture: `internal-projects-flag-on.png`, rendered through the real CRM Home
shell with the `internal-projects` development flag enabled.

- [x] The new destination appears in the CRM rail as **Internal projects**. The base already has a separate legacy **Projects** item, so the new label avoids a misleading duplicate while the surface itself remains headed **Projects**.
- [x] The header says this is “Internal firm work that is not tied to a client.”
- [x] The list shows Project, Status, Owner, Progress, and Due columns.
- [x] Status badge, progress bar/count, and due-date cue are visible.
- [x] The selected project has its own detail panel.
- [x] The detail panel shows milestones, files/notes/events totals, and collaborators.
- [x] There are no archive or sort controls. Those remain reserved for Wave 2.

Prototype comparison: the layout follows the frozen Projects list/detail pattern
at lines 737–742. The screenshot uses a populated internal-only project to make
all required detail cues visible. The descriptor carries Work grouping metadata,
but the current shell renders registry order directly and does not consume that
metadata; grouped-rail rendering belongs to the shell owner, outside this lane.
