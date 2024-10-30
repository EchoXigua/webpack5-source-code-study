/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const Factory = require("enhanced-resolve").ResolverFactory;

/**
 * 1. SyncHook：同步钩子（SyncHook）会依次调用注册的回调函数，所有回调同步执行。
 * 不接收返回值，也不会中断执行链。它适用于没有返回值或不依赖上一个回调结果的场景
 *
 * 2. SyncWaterfallHook：同步“瀑布流”钩子，允许每个回调函数返回一个值，并将该返回值作为参数传递给下一个回调
 * 这使得每个回调函数的输出影响链中后续回调的输入，非常适用于需要依次处理和修改数据的场景。
 *
 * 3. HookMap：钩子映射表（HookMap）允许动态生成和管理多个钩子，以键值对的形式存储多个钩子实例
 * 通过它可以为不同的键生成特定的钩子，例如按类型、名称等分类调用不同的钩子，这对于需要多样化、动态钩子的场景非常有效
 */
const { HookMap, SyncHook, SyncWaterfallHook } = require("tapable");
const {
  cachedCleverMerge,
  removeOperations,
  resolveByProperty,
} = require("./util/cleverMerge");

// need to be hoisted on module level for caching identity
const EMPTY_RESOLVE_OPTIONS = {};

/**
 * 将带有依赖类型的解析选项转换为一个标准化的 ResolveOptions 对象
 *
 * @param {ResolveOptionsWithDependencyType} resolveOptionsWithDepType enhanced options
 * @returns {ResolveOptions} merged options
 */
const convertToResolveOptions = (resolveOptionsWithDepType) => {
  // 提取 dependencyType 和 plugins，剩余的属性放在 remaining 中
  const { dependencyType, plugins, ...remaining } = resolveOptionsWithDepType;

  /** @type {Partial<ResolveOptions>} */
  const partialOptions = {
    ...remaining,
    plugins:
      // 去除包含特殊字符串 ... 的项
      plugins &&
      /** @type {ResolvePluginInstance[]} */ (
        plugins.filter((item) => item !== "...")
      ),
  };

  // 若 fileSystem 属性不存在，会抛出错误，因为路径解析器需要文件系统支持以进行 I/O 操作
  if (!partialOptions.fileSystem) {
    throw new Error(
      "fileSystem is missing in resolveOptions, but it's required for enhanced-resolve"
    );
  }
  const options =
    /** @type {Partial<ResolveOptions> & Pick<ResolveOptions, "fileSystem">} */ (
      partialOptions
    );

  return removeOperations(
    resolveByProperty(options, "byDependency", dependencyType),
    // 保留了 unsafeCache 属性，因为它可能作为 Proxy 被后续使用
    ["unsafeCache"]
  );
};

/**
 * 负责创建和管理不同类型的模块解析器（resolver），
 * 它实现了缓存和钩子机制，确保在需要解析模块路径时，可以高效地复用或生成相应的解析器
 *
 * @typedef {object} ResolverCache
 * @property {WeakMap<object, ResolverWithOptions>} direct
 * @property {Map<string, ResolverWithOptions>} stringified
 */

module.exports = class ResolverFactory {
  constructor() {
    this.hooks = Object.freeze({
      /** 用于在创建解析器配置时调用，可以接收上一次处理过的结果，进一步修改配置 */
      resolveOptions: new HookMap(
        () => new SyncWaterfallHook(["resolveOptions"])
      ),
      /** 用于在解析器创建后执行，允许外部插件在配置后的解析器上进一步操作或监听 */
      resolver: new HookMap(
        () => new SyncHook(["resolver", "resolveOptions", "userResolveOptions"])
      ),
    });

    /**
     * 存储了每种解析器类型（如 type）的缓存信息，包括 direct 和 stringified
     * - direct：一个 WeakMap，将传入的解析选项直接映射到缓存的解析器实例
     * - stringified：一个 Map，使用解析选项的序列化字符串作为键，便于更精确、快速地查找解析器
     */
    this.cache = new Map();
  }

  /**
   * 外部获取解析器的主要方法
   * @param {string} type type of resolver
   * @param {ResolveOptionsWithDependencyType=} resolveOptions options
   * @returns {ResolverWithOptions} the resolver
   */
  get(type, resolveOptions = EMPTY_RESOLVE_OPTIONS) {
    // 首先检查 cache 中是否已经缓存了该类型的解析器
    let typedCaches = this.cache.get(type);
    if (!typedCaches) {
      typedCaches = {
        direct: new WeakMap(),
        stringified: new Map(),
      };
      this.cache.set(type, typedCaches);
    }

    const cachedResolver = typedCaches.direct.get(resolveOptions);
    if (cachedResolver) {
      return cachedResolver;
    }
    const ident = JSON.stringify(resolveOptions);
    const resolver = typedCaches.stringified.get(ident);
    if (resolver) {
      typedCaches.direct.set(resolveOptions, resolver);
      return resolver;
    }

    // 不存在 创建新的解析器
    const newResolver = this._create(type, resolveOptions);
    typedCaches.direct.set(resolveOptions, newResolver);
    typedCaches.stringified.set(ident, newResolver);
    return newResolver;
  }

  /**
   * 创建并初始化一个新的解析器实例
   * @param {string} type type of resolver
   * @param {ResolveOptionsWithDependencyType} resolveOptionsWithDepType options
   * @returns {ResolverWithOptions} the resolver
   */
  _create(type, resolveOptionsWithDepType) {
    // 保留原始传入的选项，便于在后续处理中进行对比或进一步扩展
    const originalResolveOptions = { ...resolveOptionsWithDepType };

    // 将经过钩子链修改的配置转为 ResolveOptions 标准格式
    const resolveOptions = convertToResolveOptions(
      // 来动态处理解析器配置选项
      this.hooks.resolveOptions.for(type).call(resolveOptionsWithDepType)
    );

    // 创建解析器实例，若生成失败则抛出错误
    const resolver = Factory.createResolver(resolveOptions);
    if (!resolver) {
      throw new Error("No resolver created");
    }

    /** 存储不同的选项实例，避免重复创建解析器 */
    const childCache = new WeakMap();
    /**
     * 用于创建一个具有特定新选项的解析器副本
     * @param {*} options
     * @returns
     */
    resolver.withOptions = (options) => {
      const cacheEntry = childCache.get(options);
      if (cacheEntry !== undefined) return cacheEntry;

      // 合并原始配置和新配置，确保只在必要时创建新的解析器
      const mergedOptions = cachedCleverMerge(originalResolveOptions, options);

      // 返回或创建一个符合 mergedOptions 的解析器
      const resolver = this.get(type, mergedOptions);
      // 将其存储到 childCache 中以便后续直接使用
      childCache.set(options, resolver);
      return resolver;
    };

    // 在解析器生成后调用，允许在外部对解析器进行进一步的设置或操作
    this.hooks.resolver
      .for(type)
      .call(resolver, resolveOptions, originalResolveOptions);

    // 返回最终生成的解析器
    return resolver;
  }
};
