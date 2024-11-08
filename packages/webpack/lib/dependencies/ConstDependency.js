/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const makeSerializable = require("../util/makeSerializable");
const NullDependency = require("./NullDependency");

/**
 * 这个类主要处理常量依赖
 */
class ConstDependency extends NullDependency {
  /**
   * @param {string} expression 常量表达式 如 42 或 'hello'
   * @param {number | Range} range 源代码中的范围，指示常量表达式在源码中的位置
   * @param {(string[] | null)=} runtimeRequirements 运行时的依赖
   */
  constructor(expression, range, runtimeRequirements) {
    super();
    this.expression = expression;
    this.range = range;
    this.runtimeRequirements = runtimeRequirements
      ? new Set(runtimeRequirements)
      : null;

    // 用于缓存哈希更新的值，避免重复计算
    this._hashUpdate = undefined;
  }

  /**
   * 用于更新模块的哈希值
   * 哈希值用于缓存管理，确保每次构建时只有更改的部分才会重新构建
   * @param {Hash} hash
   * @param {UpdateHashContext} context
   * @returns {void}
   */
  updateHash(hash, context) {
    if (this._hashUpdate === undefined) {
      // hashUpdate 由 range 和 expression 构成，如果存在 runtimeRequirements，也会被加入到哈希计算中
      let hashUpdate = `${this.range}|${this.expression}`;
      if (this.runtimeRequirements) {
        for (const item of this.runtimeRequirements) {
          hashUpdate += "|";
          hashUpdate += item;
        }
      }

      // 缓存哈希
      this._hashUpdate = hashUpdate;
    }
    hash.update(this._hashUpdate);
  }

  /**
   * 回 false，表示该依赖不会引入副作用
   * 在 Webpack 中，副作用通常是指那些会改变模块外部状态的操作，比如修改全局变量等
   * 由于 ConstDependency 只是一个常量表达式，它不会引起副作用，因此返回 false
   * @param {ModuleGraph} moduleGraph
   * @returns {ConnectionState}
   */
  getModuleEvaluationSideEffectsState(moduleGraph) {
    return false;
  }

  /**
   * @param {ObjectSerializerContext} context context
   */
  serialize(context) {
    const { write } = context;
    write(this.expression);
    write(this.range);
    write(this.runtimeRequirements);
    super.serialize(context);
  }

  /**
   * @param {ObjectDeserializerContext} context context
   */
  deserialize(context) {
    const { read } = context;
    this.expression = read();
    this.range = read();
    this.runtimeRequirements = read();
    super.deserialize(context);
  }
}

makeSerializable(ConstDependency, "webpack/lib/dependencies/ConstDependency");

/**
 * 用于处理如何将依赖项注入到源代码中
 */
ConstDependency.Template = class ConstDependencyTemplate extends (
  NullDependency.Template
) {
  /**
   * @param {Dependency} dependency 需要应用模板的依赖项
   * @param {ReplaceSource} source 当前的替换源（ReplaceSource 类型）
   * @param {DependencyTemplateContext} templateContext 模板上下文，提供了与模板应用相关的附加信息
   * @returns {void}
   */
  apply(dependency, source, templateContext) {
    const dep = dependency;
    /**
     * runtimeRequirements 表示该依赖项所需要的运行时环境或资源。
     * 这里使用 Set 结构来确保没有重复的运行时需求
     */
    if (dep.runtimeRequirements) {
      for (const req of dep.runtimeRequirements) {
        templateContext.runtimeRequirements.add(req);
      }
    }

    // 如果 range 是一个数字，表示常量表达式只涉及一个单一的源代码位置
    if (typeof dep.range === "number") {
      // 在指定位置插入表达式
      source.insert(dep.range, dep.expression);
      return;
    }

    // range 是一个数组， [start, end]
    // 调用 source.replace 方法，替换源代码中从 dep.range[0] 到 dep.range[1] - 1 之间的部分
    source.replace(dep.range[0], dep.range[1] - 1, dep.expression);
  }
};

module.exports = ConstDependency;
