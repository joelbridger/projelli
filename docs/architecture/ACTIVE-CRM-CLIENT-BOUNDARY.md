# Active CRM/client boundary

New client capability work belongs under `src/features/crm-clients/` and mounts through its client registries. The live shell’s one named client mount is `ClientsSurface` in `AppSurfaceRouter`.

`MattersHome` and `MatterHub` are legacy compatibility surfaces. Do not add new client capability, imports, or mounts there. The small Client Map adapters listed in `scripts/active-crm-legacy-guard.config.mjs` are the only allowed bridges while the old screen is retained.

Run `npm run crm:active-boundary` when changing a client extension, client registry, or the shell mount. The check is deliberately narrow: shared platform code and legacy code stay outside its scope.
