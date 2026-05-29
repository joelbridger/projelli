'use strict';

const noHardcodedString = require('./rules/no-hardcoded-string');

module.exports = {
  rules: {
    'no-hardcoded-string': noHardcodedString,
  },
};
