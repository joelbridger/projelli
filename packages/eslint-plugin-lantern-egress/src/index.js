'use strict';

const noDirectProviderSend = require('./rules/no-direct-provider-send');

module.exports = {
  rules: {
    'no-direct-provider-send': noDirectProviderSend,
  },
};
