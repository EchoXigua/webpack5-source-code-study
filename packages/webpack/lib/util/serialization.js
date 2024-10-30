/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const memoize = require("./memoize");

const getObjectMiddleware = memoize(() =>
  require("../serialization/ObjectMiddleware")
);

/** @type {Serializer} */
let buffersSerializer;

// Expose serialization API
module.exports = {
  get register() {
    return getObjectMiddleware().register;
  },
};
