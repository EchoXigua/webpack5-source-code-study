/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const Dependency = require("../Dependency");
const DependencyTemplate = require("../DependencyTemplate");

/**
 * 这个类通常用于表示一种空的或无效的依赖关系
 * 在 Webpack 中，依赖项的表示通常需要一个 Dependency 类的实例，
 * 但某些情况下可能并不需要实际的依赖关系。在这种情况下，NullDependency 提供了一个占位符的实现。
 */
class NullDependency extends Dependency {
  /**
   * 返回 null 表明 NullDependency 并没有实际的依赖功能，它只是一个占位符
   */
  get type() {
    return "null";
  }

  /**
   * 该依赖不会影响引用它的模块
   * @returns {boolean | TRANSITIVE}
   */
  couldAffectReferencingModule() {
    return false;
  }
}

/**
 * 在 Webpack 中，依赖项的模板类负责如何将依赖项的内容插入到源代码中
 */
NullDependency.Template = class NullDependencyTemplate extends (
  DependencyTemplate
) {
  /**
   * 因为 NullDependency 本身是一个空依赖，它不需要做任何替换或修改源代码。
   * 也就是说，NullDependency 不会对源代码做任何插入、替换或修改，只是作为一种标记存在。
   */
  apply(dependency, source, templateContext) {}
};

module.exports = NullDependency;
