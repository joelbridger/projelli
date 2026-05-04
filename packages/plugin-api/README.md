# @projelli/plugin-api

TypeScript type definitions for authoring [Projelli](https://projelli.com) plugins.

This package is types-only. It contains no runtime code. Install it as a dev dependency and import the types in your plugin source for full IntelliSense and type checking against the host runtime.

## Install

```bash
npm install --save-dev @projelli/plugin-api
```

## Usage

```ts
import type { PluginModule, PluginAPI } from '@projelli/plugin-api';

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
npx create-projelli-plugin my-plugin
```

That command sets up TypeScript, Vite, a working `index.ts`, a `manifest.json`, and the `@projelli/plugin-api` dependency for you.

## Documentation

- Full plugin guide: [projelli.com/docs/plugins](https://projelli.com/docs/plugins)
- Manifest reference: [projelli.com/docs/plugins/manifest-reference](https://projelli.com/docs/plugins/manifest-reference)
- Permissions reference: [projelli.com/docs/plugins/permissions](https://projelli.com/docs/plugins/permissions)
- API reference: [projelli.com/docs/plugins/api-reference](https://projelli.com/docs/plugins/api-reference)

## Versioning

This package follows semver against the v2.0 plugin API contract. Breaking API changes ship as a major bump; additive changes ship as minors.

## License

MIT
