'use strict';

const noDirectProviderSend = require('./rules/no-direct-provider-send');
const noRawNetworkCall = require('./rules/no-raw-network-call');

module.exports = {
  rules: {
    'no-direct-provider-send': noDirectProviderSend,
    'no-raw-network-call': noRawNetworkCall,
  },
};
