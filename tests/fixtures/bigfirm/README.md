# Big firm scale fixture

This generator creates **Northstar Ridge**, a fully fabricated advisory firm.
It never reads, copies, or contains real client data.

It is fixed by the `northstar-ridge-fabricated-v1` seed. It creates 10 seats,
320 households, thousands of dated activity records, hundreds of workflow
instances, long notes, duplicate-looking names, missing values, Unicode and
emoji, restored records, large households, orphaned old links, and stale data.

`npm run test:scale` creates this data through the app's normal encrypted CRM
write command, then drives the desktop app. It does not write a database file
behind the app's back.
