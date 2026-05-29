import type { PluginAPI, PluginModule } from '@keepance/plugin-api';

// The default export must conform to PluginModule. The Keepance runtime
// imports your bundle, calls activate() once with the plugin API, and
// optionally calls deactivate() before unloading.
const plugin: PluginModule = {
  activate(api: PluginAPI) {
    api.commands.register('__PLUGIN_ID__.greet', () => {
      api.notify.info('Hello from your plugin!');
    });
  },
};

export default plugin;
