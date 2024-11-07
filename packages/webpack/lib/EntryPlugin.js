/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

/**
 * 处理入口的依赖关系
 */
const EntryDependency = require("./dependencies/EntryDependency");

/**
 * 用于处理入口点的插件，主要功能是将入口路径和相关配置转换成 EntryDependency，
 * 然后将其添加到 Webpack 的构建流程中
 */
class EntryPlugin {
  /**
   * @param {string} context 构建的上下文路径，一般是项目的根目录
   * @param {string} entry 入口文件的路径，指明了 Webpack 从哪里开始构建
   * @param {EntryOptions | string=} options 设置入口的名字或其他附加信息。
   * 如果只传入一个字符串，表示 name 配置项，但这种方式已被弃用
   */
  constructor(context, entry, options) {
    this.context = context;
    this.entry = entry;
    this.options = options || "";
  }

  /**
   * 应用插件
   * @param {Compiler} compiler 编译器实例
   * @returns {void}
   */
  apply(compiler) {
    // 在 Webpack 编译流程中 compilation 阶段注册钩子
    compiler.hooks.compilation.tap(
      "EntryPlugin",
      (compilation, { normalModuleFactory }) => {
        // 将 EntryDependency 与 normalModuleFactory 关联，确保在 Webpack 构建时正确解析入口依赖
        compilation.dependencyFactories.set(
          EntryDependency,
          normalModuleFactory
        );
      }
    );

    const { entry, options, context } = this;

    // 创建入口依赖实例 dep
    const dep = EntryPlugin.createDependency(entry, options);

    /**
     * 在 Webpack 的 make 阶段注册一个异步钩子
     * make 阶段是编译每个模块时的开始阶段，通常用于模块的添加和依赖的处理
     */
    compiler.hooks.make.tapAsync("EntryPlugin", (compilation, callback) => {
      // 将创建的 入口依赖的实例 添加到当前的编译中，确保 Webpack 知道入口点，并将其纳入构建流程
      compilation.addEntry(context, dep, options, (err) => {
        callback(err);
      });
    });
  }

  /**
   * 负责创建 EntryDependency 实例并设置其相关属性
   * @param {string} entry 入口路径
   * @param {EntryOptions | string} options
   * @returns {EntryDependency}
   */
  static createDependency(entry, options) {
    const dep = new EntryDependency(entry);
    // TODO webpack 6 remove string option
    // 在 Webpack 6 中 option 必须为对象,不在支持 string

    // 用于设置 loc.name，这个 name 通常表示入口文件的名称，可能会用于输出文件名或者标识不同的入口点
    dep.loc = {
      name: typeof options === "object" ? options.name : options,
    };
    return dep;
  }
}

module.exports = EntryPlugin;
