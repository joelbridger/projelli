'use strict';

const noSilentFailure = require('./rules/no-silent-failure');

module.exports = {
  rules: {
    'no-silent-failure': noSilentFailure,
  },
};
