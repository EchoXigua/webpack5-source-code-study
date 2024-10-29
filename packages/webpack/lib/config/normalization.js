"use strict";

const util = require("util");

/**
 * 用来处理 optimization.noEmitOnErrors 配置项的废弃和兼容性
 */
const handledDeprecatedNoEmitOnErrors = util.deprecate(
  /**
   * @param {boolean} noEmitOnErrors 旧配置项，用于指定在有错误时是否不生成资源
   * @param {boolean | undefined} emitOnErrors 新配置项，决定在有错误时是否生成资源
   * @returns {boolean} emit on errors
   */
  (noEmitOnErrors, emitOnErrors) => {
    if (emitOnErrors !== undefined && !noEmitOnErrors === !emitOnErrors) {
      throw new Error(
        "Conflicting use of 'optimization.noEmitOnErrors' and 'optimization.emitOnErrors'. Remove deprecated 'optimization.noEmitOnErrors' from config."
      );
    }
    return !noEmitOnErrors;
  },
  "optimization.noEmitOnErrors is deprecated in favor of optimization.emitOnErrors",
  "DEP_WEBPACK_CONFIGURATION_OPTIMIZATION_NO_EMIT_ON_ERRORS"
);

/** 用于处理配置项 value 是否为空的情况 */
const nestedConfig = (value, fn) => (value === undefined ? fn({}) : fn(value));

/** 浅拷贝对象 */
const cloneObject = (value) => ({ ...value });

/** 用于在 value 不为 undefined 时执行传入的 fn */
const optionalNestedConfig = (value, fn) =>
  value === undefined ? undefined : fn(value);

/** 在处理 value 是数组，如果为数组直接传入 fn，否则将空数组传入 fn */
const nestedArray = (value, fn) => (Array.isArray(value) ? fn(value) : fn([]));

/** 检查 value 是否为数组，如果是则执行 fn，否则返回 undefined */
const optionalNestedArray = (value, fn) =>
  Array.isArray(value) ? fn(value) : undefined;

/**
 * 用于处理嵌套配置对象，支持自定义键和默认值的深层处理
 */
const keyedNestedConfig = (value, fn, customKeys) => {
  const result =
    value === undefined
      ? {}
      : Object.keys(value).reduce(
          // 检查 customKeys 是否存在并且当前键是否在 customKeys 中
          (obj, key) => (
            (obj[key] = (
              customKeys && key in customKeys ? customKeys[key] : fn
            )(value[key])),
            /**
             * 这里使用逗号，将 obj 返回
             * 逗号运算符 , 用来对一组表达式求值，执行顺序是从左到右
             * 整个表达式的结果是最后一个子表达式的值，而中间的表达式只执行但不返回值
             */
            obj
          ),
          {}
        );

  // 处理 customKeys 中的缺失键
  if (customKeys) {
    for (const key of Object.keys(customKeys)) {
      // 确保 customKeys 中的所有键都存在于最终结果中
      if (!(key in result)) {
        result[key] = customKeys[key]({});
      }
    }
  }
  return result;
};

/**
 * 接受一个 Webpack 配置对象，然后返回一个标准化后的 Webpack 配置对象
 *
 * @param {*} config
 * @returns
 */
const getNormalizedWebpackOptions = (config) => ({
  amd: config.amd, // 是否启用 AMD 模块定义机制
  // 设置 bail: true 会在第一个错误出现时终止构建，主要用于确保在出错时立即停止，以避免进一步处理导致的无效构建
  bail: config.bail,
  cache: optionalNestedConfig(config.cache, (cache) => {
    // 禁用缓存
    if (cache === false) return false;

    // 启用内存缓存
    if (cache === true) {
      return {
        type: "memory",
        maxGenerations: undefined, // 用于控制缓存清理的配置参数
      };
    }
    // cache 为对象，根据类型做不同配置
    switch (cache.type) {
      // 启用文件系统缓存
      case "filesystem":
        return {
          type: "filesystem",
          allowCollectingMemory: cache.allowCollectingMemory, // 允许在缓存存储过程中使用内存
          maxMemoryGenerations: cache.maxMemoryGenerations, // 控制内存缓存的最大代数
          maxAge: cache.maxAge, // 缓存文件的最大存储时间
          profile: cache.profile, // 用于指定缓存文件的分析模式
          buildDependencies: cloneObject(cache.buildDependencies), // 依赖项缓存 浅拷贝一份
          cacheDirectory: cache.cacheDirectory, // 缓存的具体文件目录
          cacheLocation: cache.cacheLocation, // 指定缓存存储的具体路径位置
          hashAlgorithm: cache.hashAlgorithm, // 用于生成缓存文件的哈希算法
          compression: cache.compression, // 缓存文件的压缩选项
          idleTimeout: cache.idleTimeout, // 缓存文件的空闲时间配置
          idleTimeoutForInitialStore: cache.idleTimeoutForInitialStore, // 初始缓存的空闲超时时间
          idleTimeoutAfterLargeChanges: cache.idleTimeoutAfterLargeChanges, // 在进行较大代码变更后设置的缓存空闲超时时间
          name: cache.name, // 缓存的名称,多个项目或构建配置可通过 name 属性隔离缓存空间，避免因项目差异导致的缓存冲突或缓存污染
          store: cache.store, // 缓存存储机制
          version: cache.version, // 缓存版本号
          readonly: cache.readonly, // 是否启用只读模式
        };

      // 若缓存类型为 memory 或未指定缓存类型
      case undefined:
      case "memory":
        return {
          type: "memory",
          maxGenerations: cache.maxGenerations,
        };
      default:
        // 若 cache.type 是未实现的类型，抛出错误说明“未实现的缓存类型”。
        throw new Error(`Not implemented cache.type ${cache.type}`);
    }
  }),
  // context 通常是 Webpack 的基础目录，它影响相对路径的解析，指定了项目的根路径
  context: config.context,
  // 控制构建依赖项，并告知 Webpack 所依赖的模块信息
  dependencies: config.dependencies,
  devServer: optionalNestedConfig(config.devServer, (devServer) => {
    // false 即禁用开发服务器
    if (devServer === false) return false;
    // 浅拷贝 开发服务器配置选项
    return { ...devServer };
  }),
  // 配置 Source Maps 的生成方式，：Webpack 支持多种 Source Map 格式，
  // 如 source-map、inline-source-map、cheap-module-source-map 等
  devtool: config.devtool,

  // 定义应用程序的入口点
  entry:
    // 没有指定生成一个空的
    config.entry === undefined
      ? { main: {} }
      : typeof config.entry === "function"
        ? (
            (fn) => () =>
              Promise.resolve().then(fn).then(getNormalizedEntryStatic)
          )(config.entry)
        : getNormalizedEntryStatic(config.entry),

  // 配置 Webpack 实验性功能
  experiments: nestedConfig(config.experiments, (experiments) => ({
    ...experiments,
    // 如果配置了 HTTP 构建，支持指定允许的 URI 列表
    buildHttp: optionalNestedConfig(experiments.buildHttp, (options) =>
      Array.isArray(options) ? { allowedUris: options } : options
    ),

    // 懒编译选项，在 options 为 true 时设置为默认值
    lazyCompilation: optionalNestedConfig(
      experiments.lazyCompilation,
      (options) => (options === true ? {} : options)
    ),
  })),

  // 配置外部依赖项，可以指定哪些模块不打包，通常用于避免重复打包第三方库（如 jQuery 或 React），从而减少打包体积
  externals: /** @type {NonNullable<Externals>} */ (config.externals),
  externalsPresets: cloneObject(config.externalsPresets),
  externalsType: config.externalsType,

  // 忽略特定的警告信息
  ignoreWarnings: config.ignoreWarnings
    ? config.ignoreWarnings.map((ignore) => {
        if (typeof ignore === "function") return ignore;
        const i = ignore instanceof RegExp ? { message: ignore } : ignore;
        return (warning, { requestShortener }) => {
          if (!i.message && !i.module && !i.file) return false;
          if (i.message && !i.message.test(warning.message)) {
            return false;
          }
          if (
            i.module &&
            (!warning.module ||
              !i.module.test(
                warning.module.readableIdentifier(requestShortener)
              ))
          ) {
            return false;
          }
          if (i.file && (!warning.file || !i.file.test(warning.file))) {
            return false;
          }
          return true;
        };
      })
    : undefined,

  // 配置基础设施日志
  infrastructureLogging: cloneObject(config.infrastructureLogging),

  loader: cloneObject(config.loader), // 配置 loader

  // 设置 Webpack 的工作模式，提供 development、production 和 none 三种模式
  mode: config.mode,

  // 配置模块解析及其行为
  module:
    /** @type {ModuleOptionsNormalized} */
    (
      nestedConfig(config.module, (module) => ({
        // 配置哪些模块不需要被解析。这通常用于排除大型库（如 jQuery 或 Lodash），以减少解析时间
        noParse: module.noParse,
        // 指示 Webpack 是否可以在同一模块的多次请求中共享解析结果，以提高性能
        unsafeCache: module.unsafeCache,
        // 配置 JavaScript 文件的解析选项
        parser: keyedNestedConfig(module.parser, cloneObject, {
          javascript: (parserOptions) => ({
            unknownContextRequest: module.unknownContextRequest,
            unknownContextRegExp: module.unknownContextRegExp,
            unknownContextRecursive: module.unknownContextRecursive,
            unknownContextCritical: module.unknownContextCritical,
            exprContextRequest: module.exprContextRequest,
            exprContextRegExp: module.exprContextRegExp,
            exprContextRecursive: module.exprContextRecursive,
            exprContextCritical: module.exprContextCritical,
            wrappedContextRegExp: module.wrappedContextRegExp,
            wrappedContextRecursive: module.wrappedContextRecursive,
            wrappedContextCritical: module.wrappedContextCritical,
            // TODO webpack 6 remove
            strictExportPresence: module.strictExportPresence,
            strictThisContextOnImports: module.strictThisContextOnImports,
            ...parserOptions,
          }),
        }),
        // 代码生成器，处理如何生成最终输出的代码
        generator: cloneObject(module.generator),
        // 默认规则，用于处理所有模块的常见解析策略
        defaultRules: optionalNestedArray(module.defaultRules, (r) => [...r]),
        // 配置自定义规则，允许开发者定义特定的模块解析行为
        rules: nestedArray(module.rules, (r) => [...r]),
      }))
    ),

  // Webpack 构建的名称
  name: config.name,
  // 配置 Node.js 环境中的行为，例如是否需要在浏览器中模拟 Node.js 的某些特性（如 __dirname、__filename）
  node: nestedConfig(
    config.node,
    (node) =>
      // 存在的话 浅拷贝一份
      node && {
        ...node,
      }
  ),

  // 构建优化选项
  optimization: nestedConfig(config.optimization, (optimization) => ({
    ...optimization,

    // 控制如何处理运行时代码的分离
    runtimeChunk: getNormalizedOptimizationRuntimeChunk(
      optimization.runtimeChunk
    ),
    // 配置代码分割选项，将不同模块的代码分割为独立文件以优化加载
    splitChunks: nestedConfig(
      optimization.splitChunks,
      (splitChunks) =>
        splitChunks && {
          // 浅拷贝一份
          ...splitChunks,
          // 设置默认的大小类型，如果没有指定，则默认为 ["..."]
          defaultSizeTypes: splitChunks.defaultSizeTypes
            ? [...splitChunks.defaultSizeTypes]
            : ["..."],
          // 配置缓存组
          cacheGroups: cloneObject(splitChunks.cacheGroups),
        }
    ),

    // 控制在发生错误时是否继续发出输出
    emitOnErrors:
      // 如果 noEmitOnErrors 未定义，则使用 emitOnErrors 的原始值
      optimization.noEmitOnErrors !== undefined
        ? handledDeprecatedNoEmitOnErrors(
            optimization.noEmitOnErrors,
            optimization.emitOnErrors
          )
        : // 否则使用用户提供的
          optimization.emitOnErrors,
  })),

  // 处理 Webpack 的 output 配置项，定义了如何生成输出文件及其名称、路径、格式等信息
  output: nestedConfig(config.output, (output) => {
    // 提取 library 配置，用于配置导出模块的名称和类型
    const { library } = output;
    const libraryAsName = library;
    const libraryBase =
      typeof library === "object" &&
      library &&
      // 如果 library 是一个对象且包含 type 属性，则直接使用该对象
      !Array.isArray(library) &&
      "type" in library
        ? library
        : // 如果 library 是字符串或存在 libraryTarget，则创建一个新对象 { name: libraryAsName }
          libraryAsName || output.libraryTarget
          ? {
              name: libraryAsName,
            }
          : undefined;

    // 创建一个新的输出配置对象，包含多个输出相关的配置
    const result = {
      assetModuleFilename: output.assetModuleFilename, // 指定资产模块的文件名格式
      asyncChunks: output.asyncChunks, // 配置是否支持异步代码分割的输出
      charset: output.charset, // 文件字符集，通常是 'utf-8'
      chunkFilename: output.chunkFilename, // 生成的 chunk 文件的名称模板
      chunkFormat: output.chunkFormat, // chunk 的格式，可能的值包括 'arraybuffer' 和 'module'
      chunkLoading: output.chunkLoading, // 指定如何加载 chunk，可能的值有 'import' 或 'require'
      chunkLoadingGlobal: output.chunkLoadingGlobal, // 全局变量名，用于加载 chunk
      chunkLoadTimeout: output.chunkLoadTimeout, // 加载 chunk 的超时时间
      cssFilename: output.cssFilename, // 生成的 CSS 文件的名称模板
      cssChunkFilename: output.cssChunkFilename, // 生成的 CSS chunk 的名称模板
      cssHeadDataCompression: output.cssHeadDataCompression, // 是否对 CSS 头部数据进行压缩
      clean: output.clean, // 在构建之前是否清理输出目录
      compareBeforeEmit: output.compareBeforeEmit, // 在发出之前是否进行比较
      crossOriginLoading: output.crossOriginLoading, // 配置跨域加载的方式
      // devtool 的回退模块文件名模板
      devtoolFallbackModuleFilenameTemplate:
        output.devtoolFallbackModuleFilenameTemplate,

      // devtool 模块文件名模板
      devtoolModuleFilenameTemplate: output.devtoolModuleFilenameTemplate,
      devtoolNamespace: output.devtoolNamespace, // devtool 的命名空间
      environment: cloneObject(output.environment), // 浅拷贝环境配置

      // 支持的 chunk 加载类型
      enabledChunkLoadingTypes: output.enabledChunkLoadingTypes
        ? [...output.enabledChunkLoadingTypes]
        : ["..."],

      // 支持的库加载类型
      enabledLibraryTypes: output.enabledLibraryTypes
        ? [...output.enabledLibraryTypes]
        : ["..."],

      // 支持的 WebAssembly 加载类型
      enabledWasmLoadingTypes: output.enabledWasmLoadingTypes
        ? [...output.enabledWasmLoadingTypes]
        : ["..."],

      filename: output.filename, // 输出文件的名称模板
      globalObject: output.globalObject, // 全局对象的引用，通常为 'self' 或 'this'
      hashDigest: output.hashDigest, // 哈希值的摘要算法
      hashDigestLength: output.hashDigestLength, // 哈希摘要的长度
      hashFunction: output.hashFunction, // 哈希函数的名称
      hashSalt: output.hashSalt, // 哈希盐值
      hotUpdateChunkFilename: output.hotUpdateChunkFilename, // 热更新 chunk 文件名模板
      hotUpdateGlobal: output.hotUpdateGlobal, // 热更新全局变量名
      hotUpdateMainFilename: output.hotUpdateMainFilename, // 热更新主文件名模板
      ignoreBrowserWarnings: output.ignoreBrowserWarnings, // 是否忽略浏览器的警告
      iife: output.iife, // 是否将输出文件包装在立即调用的函数表达式中
      importFunctionName: output.importFunctionName, // 动态导入函数的名称
      importMetaName: output.importMetaName, // import.meta 的名称
      scriptType: output.scriptType, // 脚本的类型
      library: libraryBase && {
        type:
          output.libraryTarget !== undefined
            ? output.libraryTarget
            : libraryBase.type,
        auxiliaryComment:
          output.auxiliaryComment !== undefined
            ? output.auxiliaryComment
            : libraryBase.auxiliaryComment,
        amdContainer:
          output.amdContainer !== undefined
            ? output.amdContainer
            : libraryBase.amdContainer,
        export:
          output.libraryExport !== undefined
            ? output.libraryExport
            : libraryBase.export,
        name: libraryBase.name,
        umdNamedDefine:
          output.umdNamedDefine !== undefined
            ? output.umdNamedDefine
            : libraryBase.umdNamedDefine,
      },
      module: output.module, // 是否启用模块化支持
      path: output.path, // 输出目录
      pathinfo: output.pathinfo, // 是否在输出中包含路径信息
      publicPath: output.publicPath, // 配置公共路径，决定了资源加载的路径
      sourceMapFilename: output.sourceMapFilename, // 生成的 SourceMap 文件名模板
      sourcePrefix: output.sourcePrefix, // 生成文件的源代码前缀
      strictModuleErrorHandling: output.strictModuleErrorHandling, // 是否启用严格的模块错误处理
      strictModuleExceptionHandling: output.strictModuleExceptionHandling, // 是否启用严格的模块异常处理

      trustedTypes: optionalNestedConfig(
        output.trustedTypes,
        (trustedTypes) => {
          if (trustedTypes === true) return {};
          if (typeof trustedTypes === "string")
            return { policyName: trustedTypes };
          return { ...trustedTypes };
        }
      ),

      uniqueName: output.uniqueName, // 输出的唯一名称
      wasmLoading: output.wasmLoading, // 是否启用 WebAssembly 加载
      webassemblyModuleFilename: output.webassemblyModuleFilename, // WebAssembly 模块文件名模板
      workerPublicPath: output.workerPublicPath, // Worker 的公共路径
      workerChunkLoading: output.workerChunkLoading, // Worker 的 chunk 加载方式
      workerWasmLoading: output.workerWasmLoading, // Worker 的 WebAssembly 加载方式
    };
    return result;
  }),

  // 设置并行处理的最大数量， 在 Webpack 构建中，某些任务（如模块解析和代码生成）可以并行执行，从而加快构建速度
  parallelism: config.parallelism,

  // 控制性能提示
  performance: optionalNestedConfig(config.performance, (performance) => {
    // 设置为 false，则表示禁用性能提示
    if (performance === false) return false;

    // 返回设置的 性能配置
    return {
      ...performance,
    };
  }),

  // 配置 Webpack 插件，插件是 Webpack 的重要组成部分，可以用来扩展 Webpack 的功能，比如代码压缩、生成 HTML 文件等
  plugins: /** @type {Plugins} */ (nestedArray(config.plugins, (p) => [...p])),
  // 配置性能分析，如果启用，Webpack 会在构建过程中记录每个构建步骤的时间，可以用于性能调优和分析
  profile: config.profile,

  // 指定输入记录文件的路径，用于保存构建中使用的模块和输出的关系
  recordsInputPath:
    config.recordsInputPath !== undefined
      ? config.recordsInputPath
      : config.recordsPath,
  // 指定输出记录文件的路径，用于保存输出模块的记录，以加快后续构建
  recordsOutputPath:
    config.recordsOutputPath !== undefined
      ? config.recordsOutputPath
      : config.recordsPath,

  // 配置模块解析的选项，用于控制如何解析模块的路径和文件
  resolve: nestedConfig(config.resolve, (resolve) => ({
    ...resolve,
    byDependency: keyedNestedConfig(resolve.byDependency, cloneObject),
  })),
  // 配置加载器的解析选项，用于设置 Webpack 如何解析加载器模块的路径，确保加载器的可用性
  resolveLoader: cloneObject(config.resolveLoader),

  // 配置快照记录和恢复，用于快照保存构建信息，如构建依赖和解析状态，以加速后续构建
  snapshot: nestedConfig(config.snapshot, (snapshot) => ({
    // 配置解析构建依赖项的快照
    resolveBuildDependencies: optionalNestedConfig(
      snapshot.resolveBuildDependencies,
      (resolveBuildDependencies) => ({
        timestamp: resolveBuildDependencies.timestamp,
        hash: resolveBuildDependencies.hash,
      })
    ),

    // 配置构建过程中的依赖项的快照
    buildDependencies: optionalNestedConfig(
      snapshot.buildDependencies,
      (buildDependencies) => ({
        timestamp: buildDependencies.timestamp,
        hash: buildDependencies.hash,
      })
    ),

    // 配置模块解析的快照
    resolve: optionalNestedConfig(snapshot.resolve, (resolve) => ({
      timestamp: resolve.timestamp,
      hash: resolve.hash,
    })),
    // 配置模块的快照
    module: optionalNestedConfig(snapshot.module, (module) => ({
      timestamp: module.timestamp,
      hash: module.hash,
    })),
    // 配置不可变路径的快照
    immutablePaths: optionalNestedArray(snapshot.immutablePaths, (p) => [...p]),
    // 配置受管理路径的快照
    managedPaths: optionalNestedArray(snapshot.managedPaths, (p) => [...p]),
    // 配置非受管理路径的快照
    unmanagedPaths: optionalNestedArray(snapshot.unmanagedPaths, (p) => [...p]),
  })),

  // 配置输出的构建状态信息
  stats: nestedConfig(config.stats, (stats) => {
    if (stats === false) {
      // 输出为空（不输出任何状态信息）
      return {
        preset: "none",
      };
    }
    if (stats === true) {
      // 使用默认的正常输出
      return {
        preset: "normal",
      };
    }
    // 使用对应的预设名称输出
    if (typeof stats === "string") {
      return {
        preset: stats,
      };
    }

    // 返回自定义的状态配置对象
    return {
      ...stats,
    };
  }),

  // 配置构建目标环境，如 web、node 等，以便 Webpack 生成与目标环境兼容的代码
  target: config.target,
  // 是否启用监视模式
  watch: config.watch,
  // 配置监视模式的选项，允许开发者自定义监视模式的行为，例如监视间隔、忽略的文件等
  watchOptions: cloneObject(config.watchOptions),
});

/**
 * 将不同类型的 entry 参数转换成规范化的 EntryStaticNormalized 格式，
 * 以便 Webpack 可以一致地处理各种入口配置格式
 *
 * @param {*} entry
 * @returns
 *
 * @example
 * { main: { import: ["./src/index.js", "./src/other.js"] } }
 */
const getNormalizedEntryStatic = (entry) => {
  if (typeof entry === "string") {
    return {
      main: {
        import: [entry],
      },
    };
  }

  if (Array.isArray(entry)) {
    return {
      main: {
        import: entry,
      },
    };
  }

  /** @type {EntryStaticNormalized} */

  // 对象形式的 entry
  const result = {};
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (typeof value === "string") {
      result[key] = {
        import: [value],
      };
    } else if (Array.isArray(value)) {
      result[key] = {
        import: value,
      };
    } else {
      // 如果是更复杂的对象（包含如 filename 等属性），则规范化为包含多个属性的对象格式
      // 将 import 转换为数组，并设置其他属性值（如 filename, layer, runtime 等）
      result[key] = {
        import:
          /** @type {EntryDescriptionNormalized["import"]} */
          (
            value.import &&
              (Array.isArray(value.import) ? value.import : [value.import])
          ),
        filename: value.filename,
        layer: value.layer,
        runtime: value.runtime,
        baseUri: value.baseUri,
        publicPath: value.publicPath,
        chunkLoading: value.chunkLoading,
        asyncChunks: value.asyncChunks,
        wasmLoading: value.wasmLoading,
        dependOn:
          /** @type {EntryDescriptionNormalized["dependOn"]} */
          (
            value.dependOn &&
              (Array.isArray(value.dependOn)
                ? value.dependOn
                : [value.dependOn])
          ),
        library: value.library,
      };
    }
  }
  return result;
};

/**
 * 用于规范化 runtimeChunk 配置，允许用户以多种方式定义 runtimeChunk 的名称生成策略
 *
 * @param {*} runtimeChunk
 * @returns
 */
const getNormalizedOptimizationRuntimeChunk = (runtimeChunk) => {
  if (runtimeChunk === undefined) return;
  if (runtimeChunk === false) return false;

  // single 表示所有入口共用一个名为 "runtime" 的 runtime chunk
  if (runtimeChunk === "single") {
    return {
      name: () => "runtime",
    };
  }

  if (runtimeChunk === true || runtimeChunk === "multiple") {
    // 为每个入口生成一个独立的 runtime chunk
    return {
      /**
       * @param {Entrypoint} entrypoint entrypoint
       * @returns {string} runtime chunk name
       */
      name: (entrypoint) => `runtime~${entrypoint.name}`,
    };
  }

  // runtimeChunk 为自定义对象：提取name属性
  const { name } = runtimeChunk;
  return {
    name: typeof name === "function" ? name : () => name,
  };
};

module.exports.getNormalizedWebpackOptions = getNormalizedWebpackOptions;
