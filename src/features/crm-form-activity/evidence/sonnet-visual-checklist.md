# Visual checklist for coordinator review

Source reviewed: `form-activity-flag-on.png`, produced by the feature's flag-on
preview fixture from the exact read-only presentation component.

- [x] CRM placement: the descriptor registers the surface on the CRM Home Firm rail
  (`rail.group: 'firm'`) with the normal `form-activity` route and `g` then `a`
  shortcut semantics.
- [x] Search and filters stay above the data rows, in the same calm toolbar hierarchy
  as the frozen firm-activity reference.
- [x] Each row makes the form source/name, submitter, linked contact when present,
  submitted time, and status easy to scan.
- [x] The empty state is quiet and safe; the load error is separate and does not
  invent activity.
- [x] No Team Activity controls appear: no post, mention, comment, reply, reaction,
  share, or notification action is rendered.
- [x] The table and simple filters use the frozen prototype's light, calm form-field
  treatment rather than a feed or an intake-form designer.

COORDINATOR: This is the prepared Sonnet checklist artifact. The builder is Codex
under the lane's required model routing; a different-model reviewer should sign off
on the checklist during merge review.
