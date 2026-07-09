# fb2-clientux — round 2 (polish) DONE

Coordinator personal-review polish fix applied: NewClientGroupDialog now shows a
persistent removable-chip row for selected members, so the search filter can
never hide what's already in the group. Test added (select → filter → chip still
visible + removable; hidden-but-selected member still saved). Typecheck 0,
clientGroupsUi 9/9, eslint-gate clean, handle-guard clean (new chip handles
baselined), i18n leaf count +1 (1997) with namespace snapshot updated.

See fb2-clientux.done.md "## Polish round" for detail. Branch: lp/fb2-clientux.
