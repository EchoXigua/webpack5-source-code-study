/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const Dependency = require("../Dependency");
const DependencyTemplate = require("../DependencyTemplate");
const RawModule = require("../RawModule");

/**
 * 模块依赖的基础类
 */
class ModuleDependency extends Dependency {
  /**
   * @param {string} request 要解析的模块路径
   */
  constructor(request) {
    super();
    this.request = request; // 存储请求的模块路径
    // 用户请求的模块路径，通常与 request 相同，但在某些场景下可能会被自定义处理
    this.userRequest = request;
    // 标识模块依赖的代码位置范围，用于代码分析时精确定位依赖的范围
    this.range = undefined;
    /** @type {ImportAttributes | undefined} */
    /**
     * 用于存储模块依赖的断言（例如 import 语句中的 assert 条件）
     * 这项属性在某些依赖子类中使用并序列化
     */
    this.assertions = undefined;
    // 模块上下文路径，用于在特定目录下解析依赖
    this._context = undefined;
  }

  /**
   * 返回 _context 上下文路径
   * @returns {string | undefined}
   */
  getContext() {
    return this._context;
  }

  /**
   * 生成一个唯一标识符，用于表示依赖资源的身份，用于缓存或合并重复依赖请求，优化模块构建流程
   * @returns {string | null}
   */
  getResourceIdentifier() {
    let str = `context${this._context || ""}|module${this.request}`;
    if (this.assertions !== undefined) {
      str += JSON.stringify(this.assertions);
    }
    return str;
  }

  /**
   * 用于判断当前依赖的变化是否会影响引用它的模块
   * 返回 true 表示依赖的任何改变都会影响引用模块。
   * Webpack 用这个标志来决定是否需要重新编译引用模块。
   * @returns {boolean | TRANSITIVE} true, when changes to the referenced module could affect the referencing module; TRANSITIVE, when changes to the referenced module could affect referencing modules of the referencing module
   */
  couldAffectReferencingModule() {
    return true;
  }

  /**
   * 生成一个被忽略的模块实例，这个方法在某些情况下用来创建空模块（RawModule）以跳过依赖的实际解析和加载
   * @param {string} context context directory
   * @returns {Module | null} a module
   */
  createIgnoredModule(context) {
    return new RawModule(
      "/* (ignored) */", // 表示模块被忽略
      `ignored|${context}|${this.request}`,
      `${this.request} (ignored)`
    );
  }

  /**
   * 将依赖对象序列化
   * @param {ObjectSerializerContext} context context
   */
  serialize(context) {
    const { write } = context;
    write(this.request);
    write(this.userRequest);
    write(this._context);
    write(this.range);
    // 确保基类 Dependency 的序列化逻辑也被执行
    super.serialize(context);
  }

  /**
   * 从序列化上下文中读取数据并还原 ModuleDependency 实例
   * @param {ObjectDeserializerContext} context context
   */
  deserialize(context) {
    const { read } = context;
    this.request = read();
    this.userRequest = read();
    this._context = read();
    this.range = read();
    // 确保基类 Dependency 的反序列化逻辑被执行
    super.deserialize(context);
  }
}

ModuleDependency.Template = DependencyTemplate;

module.exports = ModuleDependency;
