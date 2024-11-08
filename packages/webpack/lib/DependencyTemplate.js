/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

/**
 * 这个类主要定义了一个抽象模板，用于依赖项 (Dependency) 在生成代码时的模板应用
 */
class DependencyTemplate {
  /**
   * apply 方法被声明为抽象方法（尽管 JavaScript 没有原生的抽象方法支持，但通过抛出错误的方式实现了类似效果）
   * @abstract
   * @param {Dependency} dependency 要应用模板的依赖项对象
   * @param {ReplaceSource} source 用于存储和管理需要替换的代码内容
   * @param {DependencyTemplateContext} templateContext 上下文对象，包含应用模板的必要信息，比如编译、模块图等生成时的信息
   * @returns {void}
   */
  apply(dependency, source, templateContext) {
    const AbstractMethodError = require("./AbstractMethodError");
    throw new AbstractMethodError();
  }
}

module.exports = DependencyTemplate;
