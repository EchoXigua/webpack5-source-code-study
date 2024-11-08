/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

/**
 * 分别用于包含原始源代码和生成的代码
 */
const { OriginalSource, RawSource } = require("webpack-sources");

/**
 * webpack 中的 模块基类
 */
const Module = require("./Module");

/**
 * 指定模块的类型为动态 JavaScript 模块
 */
const { JAVASCRIPT_MODULE_TYPE_DYNAMIC } = require("./ModuleTypeConstants");

/**
 * 用于将 RawModule 实现为一个可序列化的类，方便在 Webpack 内部缓存和持久化使用
 */
const makeSerializable = require("./util/makeSerializable");

/**
 * 用于指示当前模块支持的类型，这里仅支持 "javascript"
 */
const TYPES = new Set(["javascript"]);

class RawModule extends Module {
  /**
   * @param {string} source 模块的源码内容
   * @param {string} identifier 模块的唯一标识符，如果未提供则使用 sourceStr
   * @param {string=} readableIdentifier 用于显示的模块标识符，如果未提供则使用 identifierStr
   * @param {ReadOnlyRuntimeRequirements=} runtimeRequirements 记录模块在运行时的依赖，默认值为 null
   */
  constructor(source, identifier, readableIdentifier, runtimeRequirements) {
    super(JAVASCRIPT_MODULE_TYPE_DYNAMIC, null);
    this.sourceStr = source;
    this.identifierStr = identifier || this.sourceStr;
    this.readableIdentifierStr = readableIdentifier || this.identifierStr;
    this.runtimeRequirements = runtimeRequirements || null;
  }

  /**
   * 表明当前模块类型是 javascript
   * @returns {SourceTypes}
   */
  getSourceTypes() {
    return TYPES;
  }

  /**
   * 返回模块的唯一标识符
   * @returns {string}
   */
  identifier() {
    return this.identifierStr;
  }

  /**
   * 返回源码字符串的大小。如果长度小于 1，则返回 1
   * @param {string=} type
   * @returns {number}
   */
  size(type) {
    return Math.max(1, this.sourceStr.length);
  }

  /**
   * 缩短模块名称，以提供易读的标识符
   * @param {RequestShortener} requestShortener the request shortener
   * @returns {string} a user readable identifier of the module
   */
  readableIdentifier(requestShortener) {
    return /** @type {string} */ (
      requestShortener.shorten(this.readableIdentifierStr)
    );
  }

  /**
   * 判断模块是否需要重新构建
   * @param {NeedBuildContext} context context info
   * @param {function((WebpackError | null)=, boolean=): void} callback callback function, returns true, if the module needs a rebuild
   * @returns {void}
   */
  needBuild(context, callback) {
    return callback(null, !this.buildMeta);
  }

  /**
   * 负责模块的构建，尤其是为模块生成基础的构建信息。
   * 它在 Webpack 编译的构建阶段调用。
   * 因为 RawModule 只是一个包装字符串的简单模块，构建逻辑非常轻量
   * @param {WebpackOptions} options webpack options
   * @param {Compilation} compilation 当前的 Compilation 实例
   * @param {ResolverWithOptions} resolver 用于解析文件路径
   * @param {InputFileSystem} fs 文件系统接口
   * @param {function(WebpackError=): void} callback 用于在构建完成后通知 Webpack 继续构建流程
   * @returns {void}
   */
  build(options, compilation, resolver, fs, callback) {
    // 重置 buildMeta 对象
    this.buildMeta = {};
    // 表示该模块是可缓存的
    // 帮助 Webpack 判断此模块的构建结果是否可以在后续构建中复用，优化构建性能
    this.buildInfo = {
      cacheable: true,
    };
    // 立即调用回调函数以结束构建
    callback();
  }

  /**
   * 用于生成模块的实际代码片段
   * Webpack 会在打包生成代码的阶段调用此方法，
   * 通过返回包含源码的 CodeGenerationResult 对象，为模块生成可执行的代码
   * @param {CodeGenerationContext} context context for code generation
   * @returns {CodeGenerationResult} result
   */
  codeGeneration(context) {
    // 存储模块的代码片段
    const sources = new Map();

    // 判断是否需要生成源码映射
    if (this.useSourceMap || this.useSimpleSourceMap) {
      sources.set(
        "javascript",
        // 将源代码字符串和模块标识符打包成 OriginalSource 实例，生成带有源映射的代码
        new OriginalSource(this.sourceStr, this.identifier())
      );
    } else {
      // 不生成源映射，直接输出代码字符串
      sources.set("javascript", new RawSource(this.sourceStr));
    }

    // 返回一个包含生成代码的 CodeGenerationResult 对象
    // runtimeRequirements 表示模块在运行时的依赖
    return { sources, runtimeRequirements: this.runtimeRequirements };
  }

  /**
   * 负责更新模块的哈希值
   * Webpack 使用哈希值来跟踪模块的变化，确保只有模块内容发生变化时才重新构建
   * @param {Hash} hash the hash used to track dependencies
   * @param {UpdateHashContext} context context
   * @returns {void}
   */
  updateHash(hash, context) {
    // 更新哈希值，将模块的 sourceStr 添加到 hash 中，确保哈希值唯一对应模块内容
    hash.update(this.sourceStr);
    // 调用父类的 updateHash 方法，以确保继承的行为（例如对父类属性的哈希更新）
    super.updateHash(hash, context);
  }

  /**
   * @param {ObjectSerializerContext} context context
   */
  serialize(context) {
    const { write } = context;

    write(this.sourceStr);
    write(this.identifierStr);
    write(this.readableIdentifierStr);
    write(this.runtimeRequirements);

    super.serialize(context);
  }

  /**
   * @param {ObjectDeserializerContext} context context
   */
  deserialize(context) {
    const { read } = context;

    this.sourceStr = read();
    this.identifierStr = read();
    this.readableIdentifierStr = read();
    this.runtimeRequirements = read();

    super.deserialize(context);
  }
}

makeSerializable(RawModule, "webpack/lib/RawModule");

module.exports = RawModule;
