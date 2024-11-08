/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const {
  JAVASCRIPT_MODULE_TYPE_AUTO,
  JAVASCRIPT_MODULE_TYPE_DYNAMIC,
  JAVASCRIPT_MODULE_TYPE_ESM,
} = require("./ModuleTypeConstants");
const ConstDependency = require("./dependencies/ConstDependency");
const ProvidedDependency = require("./dependencies/ProvidedDependency");
const { approve } = require("./javascript/JavascriptParserHelpers");

const PLUGIN_NAME = "ProvidePlugin";

/**
 * 这个插件用于在模块中自动提供一些全局变量，而不需要显式导入
 * 这个插件通常用于一些库（如 jQuery、lodash 等），你希望在每个模块中自动注入这些库，使得你无需每次都导入它们
 */
class ProvidePlugin {
  /**
   * @param {Record<string, string | string[]>} definitions
   * 定义了哪些全局标识符（如 jQuery 或 _）应该自动提供以及它们对应的模块或路径
   * 对象的键是变量名（例如 jQuery 或 _），值是一个字符串或字符串数组，表示模块路径或要提供的依赖项
   */
  constructor(definitions) {
    this.definitions = definitions;
  }

  /**
   * @param {Compiler} compiler
   * @returns {void}
   */
  apply(compiler) {
    const definitions = this.definitions;

    // compilation 钩子 为每个模块类型（自动模块、动态模块、ESM 模块）添加了相应的处理函数
    compiler.hooks.compilation.tap(
      PLUGIN_NAME,
      (compilation, { normalModuleFactory }) => {
        /**
         * ConstDependency 和 ProvidedDependency 是自定义的依赖类型。
         * 通过这些模板，Webpack 知道如何处理这类依赖
         */
        compilation.dependencyTemplates.set(
          ConstDependency,
          new ConstDependency.Template()
        );
        compilation.dependencyFactories.set(
          ProvidedDependency,
          normalModuleFactory
        );
        compilation.dependencyTemplates.set(
          ProvidedDependency,
          new ProvidedDependency.Template()
        );
        /**
         * 用于解析 JavaScript 模块中的全局变量名称的函数
         * 在 Webpack 编译过程中，它会被多次调用，用来处理代码中的 ProvidePlugin 所定义的全局变量
         * @param {JavascriptParser} parser the parser
         * @param {JavascriptParserOptions} parserOptions options
         * @returns {void}
         */
        const handler = (parser, parserOptions) => {
          // 遍历了插件配置中的每个名称，并为这些名称生成依赖处理逻辑
          for (const name of Object.keys(definitions)) {
            // 浅拷贝一份
            const request = [].concat(definitions[name]);

            // 传入的 name（比如 jQuery.fn）拆分为多个部分
            const splittedName = name.split(".");
            if (splittedName.length > 0) {
              for (const [i, _] of splittedName.slice(1).entries()) {
                const name = splittedName.slice(0, i + 1).join(".");
                // canRename 钩子是检查一个名称是否可以重命名
                // approve 是一个用于批准重命名的回调
                parser.hooks.canRename.for(name).tap(PLUGIN_NAME, approve);
              }
            }

            // 处理代码中的每个表达式
            parser.hooks.expression.for(name).tap(PLUGIN_NAME, (expr) => {
              // 如果 name 包含点（.），则替换为 _dot_
              const nameIdentifier = name.includes(".")
                ? `__webpack_provided_${name.replace(/\./g, "_dot_")}`
                : name;

              // 将该表达式转化为一个依赖项
              const dep = new ProvidedDependency(
                request[0],
                nameIdentifier,
                request.slice(1),
                expr.range
              );
              dep.loc = expr.loc;
              // 将这个新创建的依赖项添加到当前模块的依赖树中
              parser.state.module.addDependency(dep);
              return true;
            });

            // 处理对全局变量的调用（如 jQuery() 或 _(...)）
            parser.hooks.call.for(name).tap(PLUGIN_NAME, (expr) => {
              // 当解析器遇到对某个全局变量的调用时，插件会为这个调用创建一个依赖项
              const nameIdentifier = name.includes(".")
                ? `__webpack_provided_${name.replace(/\./g, "_dot_")}`
                : name;
              const dep = new ProvidedDependency(
                request[0],
                nameIdentifier,
                request.slice(1),
                expr.callee.range
              );
              dep.loc = expr.callee.loc;
              parser.state.module.addDependency(dep);
              // 递归地处理所有参数，确保每个函数调用都能正确处理依赖
              parser.walkExpressions(expr.arguments);
              return true;
            });
          }
        };

        /**
         * Webpack 支持多种模块类型（例如自动、动态、ESM 等）
         * 这段代码确保 handler 函数在解析不同模块类型时都被调用，
         * 确保 ProvidePlugin 对所有模块类型都生效
         */
        normalModuleFactory.hooks.parser
          .for(JAVASCRIPT_MODULE_TYPE_AUTO)
          .tap(PLUGIN_NAME, handler);
        normalModuleFactory.hooks.parser
          .for(JAVASCRIPT_MODULE_TYPE_DYNAMIC)
          .tap(PLUGIN_NAME, handler);
        normalModuleFactory.hooks.parser
          .for(JAVASCRIPT_MODULE_TYPE_ESM)
          .tap(PLUGIN_NAME, handler);
      }
    );
  }
}

module.exports = ProvidePlugin;
