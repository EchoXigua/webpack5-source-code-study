/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Florent Cailhol @ooflorent
*/

"use strict";

const Dependency = require("../Dependency");
const InitFragment = require("../InitFragment");
const makeSerializable = require("../util/makeSerializable");
const ModuleDependency = require("./ModuleDependency");

/**
 * 用于将路径数组 path 转换为字符串形式
 * 将每个元素其包裹在 [ ] 中
 * @param {string[]|null} path
 * @returns {string}
 */
const pathToString = (path) =>
  path !== null && path.length > 0
    ? path.map((part) => `[${JSON.stringify(part)}]`).join("")
    : "";

class ProvidedDependency extends ModuleDependency {
  /**
   * @param {string} request 依赖的请求路径，用于确定依赖模块的标识
   * @param {string} identifier 依赖的唯一标识符
   * @param {string[]} ids 表示导入的 id 列表，通常用于 ESM 模块中的导出信息
   * @param {Range} range 依赖在源代码中的位置范围，用于后续替换源代码
   */
  constructor(request, identifier, ids, range) {
    super(request);
    this.identifier = identifier;
    this.ids = ids;
    this.range = range;
    // 缓存计算出的哈希值
    this._hashUpdate = undefined;
  }

  /** 依赖的类型 */
  get type() {
    return "provided";
  }

  /** 依赖的类别为 esm */
  get category() {
    return "esm";
  }

  /**
   * 获取依赖引用的导出
   * @returns {(string[] | ReferencedExport)[]} referenced exports
   */
  getReferencedExports(moduleGraph, runtime) {
    const ids = this.ids;
    // 表示整个模块的导出对象被引用
    if (ids.length === 0) return Dependency.EXPORTS_OBJECT_REFERENCED;

    // 表明具体引用了模块中的某些导出
    return [ids];
  }

  /**
   * 更新依赖的哈希值
   * @param {Hash} hash hash to be updated
   * @param {UpdateHashContext} context context
   * @returns {void}
   */
  updateHash(hash, context) {
    if (this._hashUpdate === undefined) {
      this._hashUpdate = this.identifier + (this.ids ? this.ids.join(",") : "");
    }
    hash.update(this._hashUpdate);
  }

  /**
   * @param {ObjectSerializerContext} context context
   */
  serialize(context) {
    const { write } = context;
    write(this.identifier);
    write(this.ids);
    super.serialize(context);
  }

  /**
   * @param {ObjectDeserializerContext} context context
   */
  deserialize(context) {
    const { read } = context;
    this.identifier = read();
    this.ids = read();
    super.deserialize(context);
  }
}

makeSerializable(
  ProvidedDependency,
  "webpack/lib/dependencies/ProvidedDependency"
);

/**
 * 在代码中插入特定的依赖初始化代码，以便在模块内访问提供的依赖
 */
class ProvidedDependencyTemplate extends ModuleDependency.Template {
  /**
   * 用于将依赖模板应用于源代码，插入必要的代码片段来支持提供的依赖项
   * @param {Dependency} dependency 当前的 ProvidedDependency 实例
   * @param {ReplaceSource} source 可以在其中进行代码替换和插入操作
   * @param {DependencyTemplateContext} templateContext the context object
   * @returns {void}
   */
  apply(
    dependency,
    source,
    {
      runtime,
      runtimeTemplate,
      moduleGraph,
      chunkGraph,
      initFragments,
      runtimeRequirements,
    }
  ) {
    const dep = dependency;
    // 获取到当前依赖的模块连接，连接了当前模块和它的依赖模块
    const connection = moduleGraph.getConnection(dep);
    // 获取模块的导出信息，用于跟踪该模块的导出内容
    const exportsInfo = moduleGraph.getExportsInfo(connection.module);

    // 获取依赖项的使用名称
    // dep.ids 是依赖的标识符路径（如 foo.bar），getUsedName 将返回实际被使用的名称
    const usedName = exportsInfo.getUsedName(dep.ids, runtime);

    initFragments.push(
      new InitFragment(
        `/* provided dependency */ var ${
          dep.identifier
          // 获取模块的导出对象
        } = ${runtimeTemplate.moduleExports({
          module: moduleGraph.getModule(dep), // 获取当前依赖的模块对象
          chunkGraph, // 用于模块和 chunk 之间的图信息
          request: dep.request, // 依赖的请求路径
          runtimeRequirements, // 运行时环境下所需的依赖模块

          // 根据 usedName 拼接出路径字符串，用于指定依赖导出的路径
        })}${pathToString(/** @type {string[]} */ (usedName))};\n`,

        // 定义片段的初始化阶段为 PROVIDES，意味着该片段在模块提供阶段执行。
        InitFragment.STAGE_PROVIDES,
        1,
        // 作为片段的描述，表示“提供了该依赖的初始化”
        `provided ${dep.identifier}`
      )
    );

    // 将源码的指定范围替换为依赖标识符
    source.replace(dep.range[0], dep.range[1] - 1, dep.identifier);
  }
}

ProvidedDependency.Template = ProvidedDependencyTemplate;

module.exports = ProvidedDependency;
