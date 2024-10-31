/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const OptionsApply = require("./OptionsApply");

class WebpackOptionsApply extends OptionsApply {
  constructor() {
    super();
  }

  process(options, compiler) {}
}

module.exports = WebpackOptionsApply;
