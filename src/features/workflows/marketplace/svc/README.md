# MarketplaceService

Foundation skeleton for v2.0 Stream C (templates marketplace + plugins marketplace).

## Status

- `refresh()` working with cache fallback. Tested.
- `list()`, `getById()` working. Tested.
- `install()`, `uninstall()` throw with "not implemented in foundations" messages. Stream C completes.
- `listInstalled()`, `checkForUpdates()` return empty arrays. Stream C completes.

## Two intended runtime instances

```typescript
const templatesMarket = new MarketplaceService({
  repoUrl: 'https://raw.githubusercontent.com/lantern-app/community-templates/main',
  catalogPath: 'catalog.json',
  cachePath: '.lantern/cache/marketplace-templates.json',
  installRoot: '.lantern/templates',
  fs: workspaceService.fs,
});

const pluginsMarket = new MarketplaceService({
  repoUrl: 'https://raw.githubusercontent.com/lantern-app/community-plugins/main',
  catalogPath: 'catalog.json',
  cachePath: '.lantern/cache/marketplace-plugins.json',
  installRoot: '.lantern/plugins',
  fs: workspaceService.fs,
});
```

## Stream C completes

- `install(id)`: download tarball, verify SHA-256 against entry's `checksum`, extract to `installRoot/<id>/`.
- `uninstall(id)`: delete `installRoot/<id>/`.
- `listInstalled()`: scan `installRoot/`, read each manifest, return InstalledEntry array.
- `checkForUpdates()`: compare `listInstalled()` versions against `list()` versions.
