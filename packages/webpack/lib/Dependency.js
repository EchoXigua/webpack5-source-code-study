/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const RawModule = require("./RawModule");
const memoize = require("./util/memoize");

const TRANSITIVE = Symbol("transitive");

const getIgnoredModule = memoize(
  () => new RawModule("/* (ignored) */", "ignored", "(ignored)")
);

/**
 * 这个类是 Webpack 用来表示模块依赖关系的基类，定义了依赖的基本属性和方法
 *
 * 其他具体类型的依赖类（比如 ModuleDependency 或 EntryDependency）会继承它，并根据特定的依赖类型扩展功能
 */
class Dependency {
  constructor() {
    /**
     * 表示该依赖所属的模块，类型是 Module，默认为 undefined
     * 用于在依赖和模块之间建立引用关系，以便在依赖被使用时能追踪到具体的模块来源
     */
    this._parentModule = undefined;
    /**
     * 表示该依赖所属的依赖块
     * 依赖块在 Webpack 中是一种组织依赖的结构，
     * 允许将多个依赖封装在一个逻辑块中，这对于模块的加载顺序和依赖解析有帮助
     */
    this._parentDependenciesBlock = undefined;
    /**
     * 表示依赖在其依赖块中的位置索引,初始值为 -1
     * 在依赖块中，多个依赖可能按顺序排列，这个属性用于标识该依赖的位置
     */
    this._parentDependenciesBlockIndex = -1;
    // TODO check if this can be moved into ModuleDependency
    /**
     * 表示该依赖是否为 “弱” 依赖
     * 弱依赖意味着依赖的存在不会影响模块的加载。
     * 此属性在子类 ModuleDependency 中可能会有更多特定的实现
     *
     */
    this.weak = false;
    // TODO check if this can be moved into ModuleDependency
    /**
     * 表示该依赖是否是可选的,默认false
     * 如果依赖是可选的，则即使该依赖无法解析，模块仍然可以被正常加载
     */
    this.optional = false;

    /** 开始行（Start Line） */
    this._locSL = 0;
    /** 开始列（Start Column） */
    this._locSC = 0;
    /** 结束行（End Line） */
    this._locEL = 0;
    /** 结束列（End Column） */
    this._locEC = 0;

    /**
     * 表示位置的索引
     * 在一些依赖类型中，可能需要用到额外的索引信息，以区分相同位置的不同依赖
     */
    this._locI = undefined;
    /**
     * 表示位置的名称
     * 有些依赖会带有特定的名称，比如导入的变量名，这个属性可以记录该名称信息。
     */
    this._locN = undefined;
    /**
     * 用于存储依赖的完整位置信息的对象
     */
    this._loc = undefined;
  }

  /**
   * 返回依赖的类型名称，默认是 "unknown"，需要在子类中重写
   * @returns {string}
   */
  get type() {
    return "unknown";
  }

  /**
   * 返回依赖的类别，通常是 "commonjs"、"amd"、"esm" 等
   * @returns {string}
   */
  get category() {
    return "unknown";
  }

  /**
   * 用于获取或设置依赖的位置信息
   * 位置信息包含开始和结束的行号、列号以及其他可能的描述性信息
   * @returns {DependencyLocation} location
   */
  get loc() {
    if (this._loc !== undefined) return this._loc;
    /** @type {SyntheticDependencyLocation & RealDependencyLocation} */
    const loc = {};
    if (this._locSL > 0) {
      loc.start = { line: this._locSL, column: this._locSC };
    }
    if (this._locEL > 0) {
      loc.end = { line: this._locEL, column: this._locEC };
    }
    if (this._locN !== undefined) {
      loc.name = this._locN;
    }
    if (this._locI !== undefined) {
      loc.index = this._locI;
    }
    return (this._loc = loc);
  }

  /**
   * 设置位置信息
   */
  set loc(loc) {
    if ("start" in loc && typeof loc.start === "object") {
      this._locSL = loc.start.line || 0;
      this._locSC = loc.start.column || 0;
    } else {
      this._locSL = 0;
      this._locSC = 0;
    }
    if ("end" in loc && typeof loc.end === "object") {
      this._locEL = loc.end.line || 0;
      this._locEC = loc.end.column || 0;
    } else {
      this._locEL = 0;
      this._locEC = 0;
    }
    this._locI = "index" in loc ? loc.index : undefined;
    this._locN = "name" in loc ? loc.name : undefined;
    this._loc = loc;
  }

  /**
   * 设置依赖对象在源码中的位置信息
   * 这个方法主要用来存储位置的具体坐标，便于后续的错误追踪和调试
   * @param {number} startLine start line
   * @param {number} startColumn start column
   * @param {number} endLine end line
   * @param {number} endColumn end column
   */
  setLoc(startLine, startColumn, endLine, endColumn) {
    this._locSL = startLine;
    this._locSC = startColumn;
    this._locEL = endLine;
    this._locEC = endColumn;

    // 清空这些信息，表示之前的位置信息已经失效
    this._locI = undefined;
    this._locN = undefined;
    this._loc = undefined;
  }

  /**
   * 返回依赖的请求上下文。这是一个占位方法，通常在特定依赖类型中会被重写，
   * 用于返回该依赖的上下文信息。此处返回 undefined 表示该依赖没有特定的上下文
   * @returns {string | undefined}
   */
  getContext() {
    return undefined;
  }

  /**
   * 提供一个唯一标识符，用于标识具有相同请求的依赖
   * 这在模块合并时非常有用，可以用于判断两个依赖是否指向相同的资源。
   * 此处默认返回 null，可能表示未实现标识符，由子类重写
   * @returns {string | null}
   */
  getResourceIdentifier() {
    return null;
  }

  /**
   * 指示当前依赖是否会影响引用它的模块
   * TRANSITIVE 表示当依赖的模块发生变化时，引用该模块的其它模块也会受到影响
   * 这个方法帮助 Webpack 判断依赖之间的级联影响，用于模块更新和编译优化
   * @returns {boolean | TRANSITIVE}
   */
  couldAffectReferencingModule() {
    return TRANSITIVE;
  }

  /**
   * 用于存储模块和依赖之间的关系
   * 这个方法会抛出错误，提示开发者使用新的方法 getReferencedExports
   * @deprecated
   * @param {ModuleGraph} moduleGraph module graph
   * @returns {never} throws error
   */
  getReference(moduleGraph) {
    throw new Error(
      "Dependency.getReference was removed in favor of Dependency.getReferencedExports, ModuleGraph.getModule and ModuleGraph.getConnection().active"
    );
  }

  /**
   * 获取当前依赖引用的模块的导出项列表。该方法被用来分析依赖项中导出的内容，支持模块打包时的依赖树优化
   *
   * @param {ModuleGraph} moduleGraph 模块图对象
   * @param {RuntimeSpec} runtime 当前运行时，用于分析依赖关系
   * @returns {(string[] | ReferencedExport)[]} referenced exports
   */
  getReferencedExports(moduleGraph, runtime) {
    return Dependency.EXPORTS_OBJECT_REFERENCED;
  }

  /**
   * 获取当前依赖是否活跃的条件函数，用于动态判断依赖连接是否生效
   * 在 Webpack 的模块加载和优化中，部分依赖可能在特定条件下才会生效
   * @param {ModuleGraph} moduleGraph module graph
   * @returns {null | false | GetConditionFn} function to determine if the connection is active
   */
  getCondition(moduleGraph) {
    return null;
  }

  /**
   * 返回当前依赖项导出的内容
   * 此方法通常被子类重写，以提供导出的实际内容。
   * @param {ModuleGraph} moduleGraph module graph
   * @returns {ExportsSpec | undefined} export names
   */
  getExports(moduleGraph) {
    return undefined;
  }

  /**
   * 返回当前依赖项的警告信息
   * 如果依赖项包含某些警告条件，该方法可以将警告信息以 WebpackError 数组的形式返回
   * @param {ModuleGraph} moduleGraph module graph
   * @returns {WebpackError[] | null | undefined} warnings
   */
  getWarnings(moduleGraph) {
    return null;
  }

  /**
   * 返回依赖项的错误信息
   * 在依赖关系解析过程中，若发现错误，getErrors 可以返回对应的错误信息数组
   * @param {ModuleGraph} moduleGraph module graph
   * @returns {WebpackError[] | null | undefined} errors
   */
  getErrors(moduleGraph) {
    return null;
  }

  /**
   * 将依赖项的内容更新到 hash 中，用于缓存和比对
   * 在模块编译过程中，Webpack 会利用哈希值来判断依赖项是否变化，从而决定是否重新构建模块
   * 此方法为空实现，通常需要子类重写以更新实际的依赖信息
   * @param {Hash} hash hash to be updated
   * @param {UpdateHashContext} context context
   * @returns {void}
   */
  updateHash(hash, context) {}

  /**
   * 返回依赖 ID 的使用次数，通常用于控制依赖项的加载顺序
   * 默认返回 1，表示依赖项至少被引用一次，子类可以重写以返回实际的引用次数
   * @returns {number}
   */
  getNumberOfIdOccurrences() {
    return 1;
  }

  /**
   * 确定依赖项的副作用状态，即是否在评估时影响其它模块
   * 默认实现返回 true，表示依赖项的评估会产生副作用
   * @param {ModuleGraph} moduleGraph
   * @returns {ConnectionState} 指示依赖项对引用模块的连接状态
   */
  getModuleEvaluationSideEffectsState(moduleGraph) {
    return true;
  }

  /**
   * 创建一个被忽略的模块，用于在某些条件下忽略特定模块的依赖
   * 通常在特定情况下用于跳过模块的编译和加载
   * @param {string} context context directory
   * @returns {Module | null} a module
   */
  createIgnoredModule(context) {
    return getIgnoredModule();
  }

  /**
   * 将当前 Dependency 对象的相关状态序列化成可存储或传输的形式
   * @param {ObjectSerializerContext} context context
   */
  serialize({ write }) {
    write(this.weak);
    write(this.optional);
    write(this._locSL);
    write(this._locSC);
    write(this._locEL);
    write(this._locEC);
    write(this._locI);
    write(this._locN);
  }

  /**
   * 恢复 Dependency 对象的状态，将序列化数据重新填充到当前对象的属性中
   * 读取的顺序需要与 serialize 中写入的顺序一致
   * @param {ObjectDeserializerContext} context context
   */
  deserialize({ read }) {
    this.weak = read();
    this.optional = read();
    this._locSL = read();
    this._locSC = read();
    this._locEL = read();
    this._locEC = read();
    this._locI = read();
    this._locN = read();
  }
}

/**
 * 一个空数组，表示没有任何导出被引用
 * @type {string[][]}
 */
Dependency.NO_EXPORTS_REFERENCED = [];
/**
 * 一个数组的数组，表示在某些情况下依赖项的导出引用了某个对象，
 * 外部可以通过这种定义来识别 Dependency 的导出引用情况
 * @type {string[][]}
 */
Dependency.EXPORTS_OBJECT_REFERENCED = [[]];

// eslint-disable-next-line no-warning-comments
// @ts-ignore https://github.com/microsoft/TypeScript/issues/42919
Object.defineProperty(Dependency.prototype, "module", {
  /**
   *
   * module 属性已从 Dependency 中移除
   * 提示开发者使用 compilation.moduleGraph.getModule(dependency) 来代替原来的 module 属性访问方式。
   *
   * @deprecated
   * @returns {never} throws
   */
  get() {
    throw new Error(
      "module property was removed from Dependency (use compilation.moduleGraph.getModule(dependency) instead)"
    );
  },

  /**
   * 提示 module 属性已移除，
   * 并建议使用 compilation.moduleGraph.updateModule(dependency, module) 来更新模块信息
   * @deprecated
   * @returns {never} throws
   */
  set() {
    throw new Error(
      "module property was removed from Dependency (use compilation.moduleGraph.updateModule(dependency, module) instead)"
    );
  },
});

// eslint-disable-next-line no-warning-comments
// @ts-ignore https://github.com/microsoft/TypeScript/issues/42919
Object.defineProperty(Dependency.prototype, "disconnect", {
  /**
   * 调用 disconnect 的 get 方法时会抛出错误，并提示 disconnect 已从 Dependency 中移除
   * 错误信息也指出了 Dependency 不再携带图结构相关的信息。
   * 这意味着依赖项类仅专注于描述依赖项本身的属性和行为，而不再包含特定图结构的信息
   */
  get() {
    throw new Error(
      "disconnect was removed from Dependency (Dependency no longer carries graph specific information)"
    );
  },
});

Dependency.TRANSITIVE = TRANSITIVE;

module.exports = Dependency;
