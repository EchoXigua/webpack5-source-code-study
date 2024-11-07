/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

/**
 * 用于让依赖支持序列化。通过序列化，依赖可以在不同的 Webpack 进程间传输，例如在多进程构建中
 */
const makeSerializable = require("../util/makeSerializable");

/**
 * Webpack 中处理模块依赖的基类，封装了与模块相关的通用依赖逻辑
 */
const ModuleDependency = require("./ModuleDependency");

class EntryDependency extends ModuleDependency {
  /**
   * @param {string} request 入口文件 (main.js) 的相对路径
   */
  constructor(request) {
    super(request);
  }

  /**
   * 这是一个入口依赖
   */
  get type() {
    return "entry";
  }

  /**
   * 此依赖的类别是 ESM
   */
  get category() {
    return "esm";
  }
}

/**
 * 将 EntryDependency 类标记为可序列化
 * 这样 Webpack 在多进程场景中可以将 EntryDependency 序列化并跨进程传递，以支持更高效的分布式构建
 */
makeSerializable(EntryDependency, "webpack/lib/dependencies/EntryDependency");

module.exports = EntryDependency;
