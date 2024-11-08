const util = require("util");
const makeSerializable = require("./util/makeSerializable");
class Module {}

makeSerializable(Module, "webpack/lib/Module");

// TODO remove in webpack 6
// eslint-disable-next-line no-warning-comments
// @ts-ignore https://github.com/microsoft/TypeScript/issues/42919
Object.defineProperty(Module.prototype, "hasEqualsChunks", {
  /**
   * 属性 hasEqualsChunks 被标记为已弃用，并抛出错误，提示开发者该属性已被重命名为 hasEqualChunks
   */
  get() {
    throw new Error(
      "Module.hasEqualsChunks was renamed (use hasEqualChunks instead)"
    );
  },
});

// TODO remove in webpack 6
// eslint-disable-next-line no-warning-comments
// @ts-ignore https://github.com/microsoft/TypeScript/issues/42919
Object.defineProperty(Module.prototype, "isUsed", {
  /**
   * isUsed 属性也被弃用，并且提示开发者改用其他方法
   * getUsedName、isExportUsed、isModuleUsed
   */
  get() {
    throw new Error(
      "Module.isUsed was renamed (use getUsedName, isExportUsed or isModuleUsed instead)"
    );
  },
});

// TODO remove in webpack 6
Object.defineProperty(Module.prototype, "errors", {
  get: util.deprecate(
    /**
     * errors 属性进行弃用处理。
     * errors 存储模块的错误信息，但现在推荐使用 getErrors 方法来代替它
     */
    function () {
      if (this._errors === undefined) {
        this._errors = [];
      }
      return this._errors;
    },
    "Module.errors was removed (use getErrors instead)",
    "DEP_WEBPACK_MODULE_ERRORS"
  ),
});

// TODO remove in webpack 6
Object.defineProperty(Module.prototype, "warnings", {
  /**
   * warnings 属性被弃用
   * warnings 存储模块的警告信息，推荐使用 getWarnings 方法来替代
   */
  get: util.deprecate(
    /**
     * @this {Module}
     * @returns {WebpackError[]} array
     */
    function () {
      if (this._warnings === undefined) {
        this._warnings = [];
      }
      return this._warnings;
    },
    "Module.warnings was removed (use getWarnings instead)",
    "DEP_WEBPACK_MODULE_WARNINGS"
  ),
});

// TODO remove in webpack 6
// eslint-disable-next-line no-warning-comments
// @ts-ignore https://github.com/microsoft/TypeScript/issues/42919
Object.defineProperty(Module.prototype, "used", {
  /**
   * used 属性也已经重构，不再直接作为 Module 的一部分
   * 访问该属性时，会抛出错误并提示开发者使用
   * ModuleGraph.getUsedExports 或 ModuleGraph.setUsedExports 来替代
   */
  get() {
    throw new Error(
      "Module.used was refactored (use ModuleGraph.getUsedExports instead)"
    );
  },
  set(value) {
    throw new Error(
      "Module.used was refactored (use ModuleGraph.setUsedExports instead)"
    );
  },
});

module.exports = Module;
