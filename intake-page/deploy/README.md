# Intake Page Deploy

The staging deploy rail lives in `infra/intake/`.

Useful commands:

```bash
npm run intake:deploy:staging:dry-run
npm run intake:headers:test
npm run intake:integrity:test
npm run intake:fragment-check
```

This folder is intentionally thin so Lane C can replace `intake-page/src/` with
the real client page without moving the security-sensitive deploy scripts.
