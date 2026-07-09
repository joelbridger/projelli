# FB2 Settings Round 2 Marker

Branch: `lp/fb2-settings`
Commit: `2d723af9 fix(settings): restore startup and AI rules rows`
Pushed: yes, `origin/lp/fb2-settings`

Round 2 corrections are done:

- Restored and reworded the startup auto-reopen setting.
- Restored `Manage AI rules`, disabled only when no workspace is open.
- Audited `EV_OPEN_SETTINGS` dispatchers in the appended correction note.
- Scoped checks passed, and the push pre-push gate passed.
