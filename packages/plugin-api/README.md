# @keepance/plugin-api

TypeScript type definitions for authoring [Keepance](https://keepance.com) plugins.

This package is types-only. It contains no runtime code. Install it as a dev dependency and import the types in your plugin source for full IntelliSense and type checking against the host runtime.

## Install

```bash
npm install --save-dev @keepance/plugin-api
```

## Usage

```ts
import type { PluginModule, PluginAPI } from '@keepance/plugin-api';

const plugin: PluginModule = {
  activate(api: PluginAPI) {
    api.commands.register('hello.greet', () => {
      api.notify.info('Hello from your plugin!');
    });
  },
};

export default plugin;
```

## Scaffold a new plugin

The fastest way to start is the official scaffolder:

```bash
npx create-keepance-plugin my-plugin
```

That command sets up TypeScript, Vite, a working `index.ts`, a `manifest.json`, and the `@keepance/plugin-api` dependency for you.

## Documentation

- Full plugin guide: [keepance.com/docs/plugins](https://keepance.com/docs/plugins)
- Manifest reference: [keepance.com/docs/plugins/manifest-reference](https://keepance.com/docs/plugins/manifest-reference)
- Permissions reference: [keepance.com/docs/plugins/permissions](https://keepance.com/docs/plugins/permissions)
- API reference: [keepance.com/docs/plugins/api-reference](https://keepance.com/docs/plugins/api-reference)

## Versioning

This package follows semver against the v2.0 plugin API contract. Breaking API changes ship as a major bump; additive changes ship as minors.

## License

MIT
