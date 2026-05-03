// Crashing Plugin — deliberately throws inside `activate`.
//
// Used by the Stream C3 end-to-end integration test to verify the runner
// catches plugin failures, flips status to `crashed`, and emits the
// `plugin_crashed` audit event without taking down the host app.

export default {
  activate() {
    throw new Error('boom');
  },
};
