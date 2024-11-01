/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const fs = require("fs");
const path = require("path");
const {
  JAVASCRIPT_MODULE_TYPE_AUTO,
  JSON_MODULE_TYPE,
  WEBASSEMBLY_MODULE_TYPE_ASYNC,
  JAVASCRIPT_MODULE_TYPE_ESM,
  JAVASCRIPT_MODULE_TYPE_DYNAMIC,
  WEBASSEMBLY_MODULE_TYPE_SYNC,
  ASSET_MODULE_TYPE,
  CSS_MODULE_TYPE_AUTO,
  CSS_MODULE_TYPE,
  CSS_MODULE_TYPE_MODULE,
} = require("../ModuleTypeConstants");
const Template = require("../Template");
const { cleverMerge } = require("../util/cleverMerge");
const {
  getTargetsProperties,
  getTargetProperties,
  getDefaultTarget,
} = require("./target");

/**
 * @typedef {object} ResolvedOptions
 * @property {PlatformTargetProperties | false} platform - platform target properties
 */

const NODE_MODULES_REGEXP = /[\\/]node_modules[\\/]/i;
const DEFAULT_CACHE_NAME = "default";

/**
 * 用来为对象属性 prop 设置常量的默认值
 *
 * @param {T} obj 目标对象
 * @param {P} prop 目标对象中的属性名称
 * @param {T[P]} value 作为默认值的常量
 * @returns {void}
 */
const D = (obj, prop, value) => {
  if (obj[prop] === undefined) {
    obj[prop] = value;
  }
};

/**
 * 用来设置动态默认值，当对象属性 prop 的值为 undefined 时，它调用 factory 函数生成默认值并赋值给该属性
 *
 * @param {T} obj 目标对象
 * @param {P} prop 目标对象中的属性名称
 * @param {function(): T[P]} factory 当 prop 的值为 undefined 时调用的函数，用于生成该属性的默认值
 * @returns {void}
 */
const F = (obj, prop, factory) => {
  if (obj[prop] === undefined) {
    obj[prop] = factory();
  }
};

/**
 * 用于根据条件动态添加或合并对象 obj 中的属性 prop,
 * 通过指定的 factory 函数生成的默认值来初始化或扩展属性值
 * 会处理未定义值、普通值和带有特殊合并符号的数组情况，
 * 特别是当数组包含 "..." 作为占位符时，用 factory() 返回的值进行替换
 *
 * @param {*} obj 目标对象
 * @param {*} prop 要添加或修改的属性名称
 * @param {*} factory 用于生成默认值的函数
 */
const A = (obj, prop, factory) => {
  const value = obj[prop];
  if (value === undefined) {
    obj[prop] = factory();
  } else if (Array.isArray(value)) {
    let newArray;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];

      // 处理占位符,在此位置插入 factory() 生成的新数组元素
      if (item === "...") {
        if (newArray === undefined) {
          // 赋值前i项,构建新数组
          newArray = value.slice(0, i);
          // 替换之前的引用
          obj[prop] = newArray;
        }
        const items = factory();
        if (items !== undefined) {
          for (const item of items) {
            newArray.push(item);
          }
        }
      } else if (newArray !== undefined) {
        newArray.push(item);
      }
    }
  }
};

/**
 * 用来为 Webpack 配置对象 options 设置默认值的函数，保证 Webpack 在没有完整配置时依旧能够正常工作
 *
 * @param  options webpack 标准化后的配置项
 * @returns {void}
 */
const applyWebpackOptionsBaseDefaults = (options) => {
  // 设置 options.context 的默认值为当前工作目录，即 process.cwd()
  F(options, "context", () => process.cwd());

  // 专门用于为 infrastructureLogging 对象设置默认值
  applyInfrastructureLoggingDefaults(options.infrastructureLogging);
};

/**
 * @param {WebpackOptionsNormalized} options options to be modified
 * @param {number} [compilerIndex] index of compiler
 * @returns {ResolvedOptions} Resolved options after apply defaults
 */
const applyWebpackOptionsDefaults = (options, compilerIndex) => {
  // 默认的上下文
  F(options, "context", () => process.cwd());
  // 默认的打包目标 这里有 web  browserslist
  F(options, "target", () => getDefaultTarget(options.context));

  const { mode, name, target } = options;

  const targetProperties =
    target === false
      ? false
      : typeof target === "string"
        ? // 单个
          getTargetProperties(target, options.context)
        : // 数组
          getTargetsProperties(target, options.context);

  const development = mode === "development";
  // mode 未定义，默认是 生产环境
  const production = mode === "production" || !mode;

  // 默认的入口路径为 ./src，确保了项目有一个有效的打包入口
  if (typeof options.entry !== "function") {
    for (const key of Object.keys(options.entry)) {
      F(options.entry[key], "import", () => ["./src"]);
    }
  }

  // 默认的sourcemap 生成
  F(options, "devtool", () => (development ? "eval" : false));
  D(options, "watch", false); // 默认不开启监听
  D(options, "profile", false); // 默认不开启性能分析
  D(options, "parallelism", 100); // 默认最大并行数量 100
  // 默认不控制构建记录的输入输出路径
  D(options, "recordsInputPath", false);
  D(options, "recordsOutputPath", false);

  // 为实验性功能配置默认值
  applyExperimentsDefaults(options.experiments, {
    production,
    development,
    targetProperties,
  });

  const futureDefaults =
    /** @type {NonNullable<ExperimentsNormalized["futureDefaults"]>} */
    (options.experiments.futureDefaults);

  // 开发环境下，默认内存缓存，否则不缓存
  F(options, "cache", () => (development ? { type: "memory" } : false));

  // 为缓存配置默认值
  applyCacheDefaults(options.cache, {
    name: name || DEFAULT_CACHE_NAME,
    mode: mode || "production",
    development,
    cacheUnaffected: options.experiments.cacheUnaffected,
    compilerIndex,
  });
  const cache = Boolean(options.cache);

  // 为快照配置默认值
  applySnapshotDefaults(options.snapshot, {
    production,
    futureDefaults,
  });

  // 为 module 配置默认值
  applyModuleDefaults(options.module, {
    cache,
    syncWebAssembly: options.experiments.syncWebAssembly,
    asyncWebAssembly: options.experiments.asyncWebAssembly,
    css: options.experiments.css,
    futureDefaults,
    isNode: targetProperties && targetProperties.node === true,
    targetProperties,
  });

  applyOutputDefaults(options.output, {
    context: options.context,
    targetProperties,
    isAffectedByBrowserslist:
      target === undefined ||
      (typeof target === "string" && target.startsWith("browserslist")) ||
      (Array.isArray(target) &&
        target.some((target) => target.startsWith("browserslist"))),
    outputModule:
      /** @type {NonNullable<ExperimentsNormalized["outputModule"]>} */
      (options.experiments.outputModule),
    development,
    entry: options.entry,
    futureDefaults,
  });

  // 用于设置 externalsPresets 的默认配置项，以支持不同的运行环境（如 web、node、electron 等）和扩展配置
  applyExternalsPresetsDefaults(options.externalsPresets, {
    targetProperties, // 运行环境的属性对象，决定目标是否支持特定的环境
    buildHttp: Boolean(options.experiments.buildHttp), // 用于控制是否允许构建 HTTP 模块
  });

  // 为 loader 设置默认值
  applyLoaderDefaults(
    /** @type {NonNullable<WebpackOptionsNormalized["loader"]>} */ (
      options.loader
    ),
    { targetProperties, environment: options.output.environment }
  );

  // 用于设置 options.externalsType 的默认值
  F(options, "externalsType", () => {
    const validExternalTypes = require("../../schemas/WebpackOptions.json")
      .definitions.ExternalsType.enum;
    return options.output.library &&
      validExternalTypes.includes(options.output.library.type)
      ? /** @type {ExternalsType} */ (options.output.library.type)
      : options.output.module
        ? "module-import" // 模块化导入的方式
        : "var"; // 传统的外部模块导出方式
  });

  applyNodeDefaults(options.node, {
    futureDefaults:
      /** @type {NonNullable<WebpackOptionsNormalized["experiments"]["futureDefaults"]>} */
      (options.experiments.futureDefaults),
    outputModule: options.output.module,
    targetProperties,
  });

  // 为 性能分析设置默认，依据构建环境和 targetProperties 动态决定 performance 设置为对象或 false
  F(options, "performance", () =>
    production &&
    targetProperties &&
    (targetProperties.browser || targetProperties.browser === null)
      ? {}
      : false
  );

  // 为 performance 配置对象设置默认值，如果上一步的配置不是 false
  applyPerformanceDefaults(
    /** @type {NonNullable<WebpackOptionsNormalized["performance"]>} */
    (options.performance),
    {
      production,
    }
  );

  // 为 webpack 的优化设置配置默认值
  applyOptimizationDefaults(options.optimization, {
    development,
    production,
    css:
      /** @type {NonNullable<ExperimentsNormalized["css"]>} */
      (options.experiments.css),
    records: Boolean(options.recordsInputPath || options.recordsOutputPath),
  });

  // 智能合并 Webpack 的 resolve 和 resolveLoader 选项的默认设置与用户自定义配置
  options.resolve = cleverMerge(
    getResolveDefaults({
      cache,
      context: options.context,
      targetProperties,
      mode: options.mode,
      css: options.experiments.css,
    }),
    options.resolve
  );

  options.resolveLoader = cleverMerge(
    getResolveLoaderDefaults({ cache }),
    options.resolveLoader
  );

  // 构造一个包含目标平台信息的对象
  return {
    platform:
      targetProperties === false
        ? targetProperties
        : {
            web: targetProperties.web,
            browser: targetProperties.browser,
            webworker: targetProperties.webworker,
            node: targetProperties.node,
            nwjs: targetProperties.nwjs,
            electron: targetProperties.electron,
          },
  };
};

/**
 * 为 Webpack 的实验性功能设置默认值
 *
 * targetProperties： 目标属性
 */
const applyExperimentsDefaults = (
  experiments,
  { production, development, targetProperties }
) => {
  // 是否使用未来的默认配置
  D(experiments, "futureDefaults", false);
  // 保持向后兼容
  D(experiments, "backCompat", !experiments.futureDefaults);
  // 默认同步 WebAssembly 功能未启用
  D(experiments, "syncWebAssembly", false);
  D(experiments, "asyncWebAssembly", experiments.futureDefaults);
  D(experiments, "outputModule", false); // 输出模块功能
  D(experiments, "layers", false); // 模块层功能
  D(experiments, "lazyCompilation", undefined);
  D(experiments, "buildHttp", undefined);
  D(experiments, "cacheUnaffected", experiments.futureDefaults);
  F(experiments, "css", () => (experiments.futureDefaults ? true : undefined));

  // TODO webpack 6: remove this. topLevelAwait should be enabled by default
  // webpack6 将会移除，默认情况下应该启用topLevelAwait
  // 是否启用顶层 await 功能
  let shouldEnableTopLevelAwait = true;
  if (typeof experiments.topLevelAwait === "boolean") {
    shouldEnableTopLevelAwait = experiments.topLevelAwait;
  }
  D(experiments, "topLevelAwait", shouldEnableTopLevelAwait);

  if (typeof experiments.buildHttp === "object") {
    D(experiments.buildHttp, "frozen", production);
    D(experiments.buildHttp, "upgrade", false); // 未启用升级功能
  }
};

/**
 * 为 Webpack 的缓存配置设置默认值
 *
 * @param {CacheOptionsNormalized} cache options
 * @param {object} options options
 */
const applyCacheDefaults = (
  cache,
  { name, mode, development, cacheUnaffected, compilerIndex }
) => {
  if (cache === false) return;

  switch (cache.type) {
    // 文件系统缓存
    case "filesystem":
      F(cache, "name", () =>
        compilerIndex !== undefined
          ? `${`${name}-${mode}`}__compiler${compilerIndex + 1}__`
          : `${name}-${mode}`
      );
      D(cache, "version", "");

      // 动态计算缓存路径
      F(cache, "cacheDirectory", () => {
        const cwd = process.cwd();
        let dir = cwd;

        // 这里死循环一直向上查找 package.json 文件，找到后退出循环，找到顶层后也退出循环
        for (;;) {
          try {
            if (fs.statSync(path.join(dir, "package.json")).isFile()) break;
            // eslint-disable-next-line no-empty
          } catch (_err) {}
          const parent = path.dirname(dir);
          if (dir === parent) {
            dir = undefined;
            break;
          }
          dir = parent;
        }

        if (!dir) {
          // 没有找到包含 package.json 的目录 默认的缓存目录 cwd/.cache/webpack，其中 cwd 是当前工作目录
          return path.resolve(cwd, ".cache/webpack");
        } else if (process.versions.pnp === "1") {
          // 检测到 PnP 的版本为 1，返回 .pnp/.cache/webpack 作为缓存目录
          // PnP 是 Yarn 的一种依赖管理方式，它改变了模块的安装和解析机制
          return path.resolve(dir, ".pnp/.cache/webpack");
        } else if (process.versions.pnp === "3") {
          // 不同的版本使用不同的缓存目录结构
          return path.resolve(dir, ".yarn/.cache/webpack");
        }
        // 默认使用 node_modules/.cache/webpack 作为缓存目录。这是常见的 Node.js 模块缓存路径
        return path.resolve(dir, "node_modules/.cache/webpack");
      });
      // 缓存存储的具体位置
      F(cache, "cacheLocation", () =>
        path.resolve(
          /** @type {NonNullable<FileCacheOptions["cacheDirectory"]>} */
          (cache.cacheDirectory),
          /** @type {NonNullable<FileCacheOptions["name"]>} */ (cache.name)
        )
      );

      // 哈希算法默认使用 md4，md4 是一种快速的哈希算法，通常用于小数据块的处理
      D(cache, "hashAlgorithm", "md4");
      D(cache, "store", "pack"); // 缓存将以打包的方式存储
      D(cache, "compression", false); // 不进行压缩
      D(cache, "profile", false); // 不启用性能分析
      D(cache, "idleTimeout", 60000); // 60000 毫秒（1分钟），表示在闲置后多长时间清理缓存
      // 初始存储的闲置超时时间为 5000 毫秒（5秒）
      D(cache, "idleTimeoutForInitialStore", 5000);
      // 大规模更改后的闲置超时时间为 1000 毫秒（1秒）
      D(cache, "idleTimeoutAfterLargeChanges", 1000);
      // 在开发模式下最多保留 5 个内存生成，其他情况下不限制
      D(cache, "maxMemoryGenerations", development ? 5 : Infinity);
      // 缓存最大保留时间为 （60 天）
      D(cache, "maxAge", 1000 * 60 * 60 * 24 * 60); // 1 month

      // 仅在开发模式下允许内存收集
      D(cache, "allowCollectingMemory", development);
      D(cache, "memoryCacheUnaffected", development && cacheUnaffected);
      // 允许写入缓存
      D(cache, "readonly", false);
      // 构建依赖项，默认依赖于 Webpack 的安装目录
      D(
        /** @type {NonNullable<FileCacheOptions["buildDependencies"]>} */
        (cache.buildDependencies),
        "defaultWebpack",
        // path.sep 操作系统的分隔符 （在 Unix 系统中是 /，在 Windows 系统中是 \）
        [path.resolve(__dirname, "..") + path.sep]
      );
      break;

    // 内存缓存
    case "memory":
      // 当缓存类型为内存时，设置最大生成数为无限制
      D(cache, "maxGenerations", Infinity);
      D(cache, "cacheUnaffected", development && cacheUnaffected);
      break;
  }
};

/**
 * 为快照相关的配置设置默认值，特别是与路径管理和构建依赖项相关的设置
 * @param {SnapshotOptions} snapshot options
 * @param {object} options options
 */
const applySnapshotDefaults = (snapshot, { production, futureDefaults }) => {
  // 使用未来的默认设置
  if (futureDefaults) {
    // 管理路径
    F(snapshot, "managedPaths", () =>
      process.versions.pnp === "3"
        ? // 匹配 .yarn/unplugged 的路径
          [
            /^(.+?(?:[\\/]\.yarn[\\/]unplugged[\\/][^\\/]+)?[\\/]node_modules[\\/])/,
          ]
        : // 匹配 node_modules 的路径
          [/^(.+?[\\/]node_modules[\\/])/]
    );

    // 不可变路径
    F(snapshot, "immutablePaths", () =>
      process.versions.pnp === "3"
        ? [/^(.+?[\\/]cache[\\/][^\\/]+\.zip[\\/]node_modules[\\/])/]
        : []
    );
  } else {
    // 根据当前 watchpack 的位置动态计算并设置管理路径
    A(snapshot, "managedPaths", () => {
      if (process.versions.pnp === "3") {
        const match =
          /^(.+?)[\\/]cache[\\/]watchpack-npm-[^\\/]+\.zip[\\/]node_modules[\\/]/.exec(
            require.resolve("watchpack")
          );
        if (match) {
          return [path.resolve(match[1], "unplugged")];
        }
      } else {
        const match = /^(.+?[\\/]node_modules[\\/])/.exec(
          require.resolve("watchpack")
        );
        if (match) {
          return [match[1]];
        }
      }
      return [];
    });
    A(snapshot, "immutablePaths", () => {
      if (process.versions.pnp === "1") {
        const match =
          /^(.+?[\\/]v4)[\\/]npm-watchpack-[^\\/]+-[\da-f]{40}[\\/]node_modules[\\/]/.exec(
            require.resolve("watchpack")
          );
        if (match) {
          return [match[1]];
        }
      } else if (process.versions.pnp === "3") {
        const match =
          /^(.+?)[\\/]watchpack-npm-[^\\/]+\.zip[\\/]node_modules[\\/]/.exec(
            require.resolve("watchpack")
          );
        if (match) {
          return [match[1]];
        }
      }
      return [];
    });
  }

  // 始终将未管理路径设置为空数组
  F(snapshot, "unmanagedPaths", () => []);
  // 构建依赖项设置为对象，包含时间戳和哈希信息
  F(snapshot, "resolveBuildDependencies", () => ({
    timestamp: true,
    hash: true,
  }));
  F(snapshot, "buildDependencies", () => ({ timestamp: true, hash: true }));

  // 模块和解析  在生产模式下，配置包括时间戳和哈希；否则，仅包含时间戳
  F(snapshot, "module", () =>
    production ? { timestamp: true, hash: true } : { timestamp: true }
  );
  F(snapshot, "resolve", () =>
    production ? { timestamp: true, hash: true } : { timestamp: true }
  );
};

/**
 * 为 JavaScript 解析器选项设置默认值，确保在解析 JavaScript 模块时拥有合理的默认行为
 */
const applyJavascriptParserOptionsDefaults = (
  parserOptions,
  { futureDefaults, isNode }
) => {
  // 默认为 "." 用于未知上下文的默认请求路径，通常是当前目录
  D(parserOptions, "unknownContextRequest", ".");
  // 默认为 false 表示未知上下文的正则匹配设置，false 表示不匹配任何内容
  D(parserOptions, "unknownContextRegExp", false);

  // 默认为 true 表示是否递归解析未知上下文中的依赖
  D(parserOptions, "unknownContextRecursive", true);
  // 默认为 true 若设置为 true，在处理未知上下文时会产生警告
  D(parserOptions, "unknownContextCritical", true);
  // 默认为 "." 用于表达式上下文的默认请求路径
  D(parserOptions, "exprContextRequest", ".");
  // 默认为 false 表示不匹配任何表达式上下文
  D(parserOptions, "exprContextRegExp", false);
  // 默认为 true 是否递归解析表达式上下文
  D(parserOptions, "exprContextRecursive", true);
  // 默认为 true 表示表达式上下文是否会引发警告
  D(parserOptions, "exprContextCritical", true);
  // 默认为 /.*/ 此正则匹配所有内容，用于包裹上下文的正则匹配
  D(parserOptions, "wrappedContextRegExp", /.*/);
  // 默认为 true 是否递归解析包裹上下文
  D(parserOptions, "wrappedContextRecursive", true);
  // 默认为 false 表示包裹上下文不会产生警告
  D(parserOptions, "wrappedContextCritical", false);
  // 默认为 false 在导入中不强制 this 上下文为严格模式
  D(parserOptions, "strictThisContextOnImports", false);

  // 默认为 true 支持 import.meta 对象
  D(parserOptions, "importMeta", true);
  // 默认为 "lazy" 表示动态导入以懒加载方式进行
  D(parserOptions, "dynamicImportMode", "lazy");
  // 动态导入的预取和预加载行为 默认为 false，通常在优化资源加载时使用
  D(parserOptions, "dynamicImportPrefetch", false);
  D(parserOptions, "dynamicImportPreload", false);
  D(parserOptions, "dynamicImportFetchPriority", false);

  // 在 Node.js 环境下为 true，表示可以在模块中使用 createRequire 函数
  D(parserOptions, "createRequire", isNode);

  // 如果采用未来的默认值，当导出项在模块中不存在时，将抛出错误，这是更严格的检查规则
  if (futureDefaults) D(parserOptions, "exportsPresence", "error");
};

/**
 * 用于设置 CSS 生成器的默认选项
 */
const applyCssGeneratorOptionsDefaults = (
  generatorOptions,
  { targetProperties }
) => {
  // 决定是否只导出 CSS 文件中实际使用的部分,false 导出全部
  // 在特定环境下（如不在浏览器环境或没有 document 属性），避免导出未被使用的内容，优化代码体积
  D(
    generatorOptions,
    "exportsOnly",
    !targetProperties || !targetProperties.document
  );

  // 生成的 CSS 模块使用 ES Module 的导出语法
  D(generatorOptions, "esModule", true);
};

/**
 * 为 Webpack 的 模块处理 配置设置一系列默认值
 * @param {ModuleOptions} module options
 * @param {object} options options
 */
const applyModuleDefaults = (
  module,
  {
    cache,
    syncWebAssembly, // 是否使用同步 WebAssembly 模块
    asyncWebAssembly, // 是否使用异步 WebAssembly 模块
    css, // 是否启用 CSS 处理
    futureDefaults, // 是否使用未来的默认设置
    isNode, // 当前目标是否为 Node.js
    targetProperties, // 目标属性的对象，描述构建的目标环境
  }
) => {
  if (cache) {
    D(
      module,
      "unsafeCache",
      // 模块是否被缓存
      (module) => {
        const name = module.nameForCondition();
        return name && NODE_MODULES_REGEXP.test(name);
      }
    );
  } else {
    D(module, "unsafeCache", false);
  }

  // asset 解析器默认为空
  F(module.parser, ASSET_MODULE_TYPE, () => ({}));
  F(module.parser.asset, "dataUrlCondition", () => ({}));
  /**
   * dataUrlCondition: 如果 dataUrlCondition 是一个对象，设置其 maxSize 属性为 8096 字节（8 KB），
   * 表示在这个大小以内的资产可以以数据 URL 形式嵌入
   */
  if (typeof module.parser.asset.dataUrlCondition === "object") {
    D(module.parser.asset.dataUrlCondition, "maxSize", 8096);
  }

  // js 解析器默认为空
  F(module.parser, "javascript", () => ({}));

  // 为 js 解析器 设置默认选项
  applyJavascriptParserOptionsDefaults(module.parser.javascript, {
    futureDefaults,
    isNode,
  });

  // 启用了 CSS 处理
  if (css) {
    F(module.parser, "css", () => ({}));

    // 表示允许使用命名导出
    D(module.parser.css, "namedExports", true);

    F(module.generator, "css", () => ({}));

    // 为 CSS 生成器设置默认选项
    applyCssGeneratorOptionsDefaults(module.generator.css, {
      targetProperties,
    });

    // 初始化自动 CSS 生成器，并设置生成的 CSS 类名格式和导出约定
    F(module.generator, "css/auto", () => ({}));
    D(
      module.generator["css/auto"],
      "localIdentName",
      "[uniqueName]-[id]-[local]"
    );
    D(module.generator["css/auto"], "exportsConvention", "as-is");

    F(module.generator, "css/module", () => ({}));
    D(
      module.generator["css/module"],
      "localIdentName",
      "[uniqueName]-[id]-[local]"
    );
    D(module.generator["css/module"], "exportsConvention", "as-is");

    F(module.generator, "css/global", () => ({}));
    D(
      module.generator["css/global"],
      "localIdentName",
      "[uniqueName]-[id]-[local]"
    );
    D(module.generator["css/global"], "exportsConvention", "as-is");
  }

  // 为模块设置默认规则
  A(module, "defaultRules", () => {
    const esm = {
      type: JAVASCRIPT_MODULE_TYPE_ESM,
      resolve: {
        byDependency: {
          esm: {
            fullySpecified: true,
          },
        },
      },
    };
    const commonjs = {
      type: JAVASCRIPT_MODULE_TYPE_DYNAMIC,
    };

    const rules = [
      // 包含 Node.js 专用代码的模块，自动识别它们为 JavaScript 模块
      {
        mimetype: "application/node",
        type: JAVASCRIPT_MODULE_TYPE_AUTO,
      },
      // 识别json文件,能够在模块中直接加载 JSON 数据。
      {
        test: /\.json$/i,
        type: JSON_MODULE_TYPE,
      },
      // 类似于前一条规则，但通过 MIME 类型匹配 JSON 文件
      {
        mimetype: "application/json",
        type: JSON_MODULE_TYPE,
      },
      // 识别 esm
      {
        test: /\.mjs$/i,
        ...esm,
      },

      // 匹配js文件,type 为 module 时应用 esm 规则
      {
        test: /\.js$/i,
        descriptionData: {
          type: "module",
        },
        ...esm,
      },
      // 应用 cjs 规则
      {
        test: /\.cjs$/i,
        ...commonjs,
      },
      // 匹配js type 为 cjs 时 应用其规则
      {
        test: /\.js$/i,
        descriptionData: {
          type: "commonjs",
        },
        ...commonjs,
      },

      // 将这类 JavaScript 文件识别为 ESM 类型，适用于浏览器或服务器端通用的 JS 文件
      {
        mimetype: {
          or: ["text/javascript", "application/javascript"],
        },
        ...esm,
      },
    ];

    // 异步加载 wasm
    if (asyncWebAssembly) {
      const wasm = {
        type: WEBASSEMBLY_MODULE_TYPE_ASYNC,
        rules: [
          {
            descriptionData: {
              type: "module",
            },
            resolve: {
              fullySpecified: true,
            },
          },
        ],
      };

      // 匹配 wasm 文件
      rules.push({
        test: /\.wasm$/i,
        ...wasm,
      });
      //  MIME 类型为 application/wasm 时 应用 wasm 规则
      rules.push({
        mimetype: "application/wasm",
        ...wasm,
      });
    } else if (syncWebAssembly) {
      // 同步加载 wasm

      const wasm = {
        type: WEBASSEMBLY_MODULE_TYPE_SYNC,
        rules: [
          {
            descriptionData: {
              type: "module",
            },
            resolve: {
              fullySpecified: true,
            },
          },
        ],
      };
      rules.push({
        test: /\.wasm$/i,
        ...wasm,
      });
      rules.push({
        mimetype: "application/wasm",
        ...wasm,
      });
    }

    if (css) {
      const resolve = {
        // 要求 import 路径包括文件扩展名，比如 .css
        fullySpecified: true,
        // 优先使用相对路径进行模块解析，有助于确保 CSS 文件的依赖关系按相对路径加载
        preferRelative: true,
      };

      // 匹配 css 结尾的文件
      rules.push({
        test: /\.css$/i,
        // Webpack 自动检测是否将 CSS 文件视作 CSS 模块处理
        // 文件名中包含 .module. 或 .modules.，则将其作为 CSS 模块
        type: CSS_MODULE_TYPE_AUTO,
        resolve,
      });

      rules.push({
        // 需要 hash 处理的 CSS 模块文件
        mimetype: "text/css+module",
        // 这是 CSS 模块文件，Webpack 将自动对文件中的 CSS 类名进行哈希处理
        type: CSS_MODULE_TYPE_MODULE,
        resolve,
      });

      // 普通的 CSS 文件，不会对 CSS 类名进行任何哈希处理
      rules.push({
        mimetype: "text/css",
        type: CSS_MODULE_TYPE,
        resolve,
      });
    }

    rules.push(
      {
        // 应用于模块依赖为 url 的资源（例如通过 import 或 require 引用的外部资源）
        dependency: "url",
        // 通过 oneOf 指定了两种处理方案
        oneOf: [
          {
            // 匹配 scheme 为 data 的资源 即Data URI 格式的资源，如 base64 格式的图像
            scheme: /^data$/,
            // 将资源嵌入为 Data URL 内联数据，以减少 HTTP 请求
            type: "asset/inline",
          },
          {
            // 对于其他 URL 资源（非 Data URI 格式的资源）
            // 将资源复制到构建输出目录并生成对应的引用
            type: "asset/resource",
          },
        ],
      },
      {
        // 以 assert 方式声明资源类型为 JSON 的模块
        assert: { type: "json" },
        // 将模块类型设置为 JSON
        type: JSON_MODULE_TYPE,
      },
      {
        // 以 with 方式声明资源类型为 JSON 的模块
        with: { type: "json" },
        // 将模块类型设置为 JSON
        type: JSON_MODULE_TYPE,
      }
    );

    /**
     * - CSS 规则：根据文件后缀、mimetype 指定不同的 CSS 文件处理方式，
     * 支持普通 CSS 文件、CSS 模块文件以及根据文件名自动识别 CSS 模块
     *
     * - URL 资源规则：支持内联和外部资源的不同处理方式
     *
     * - JSON 文件规则：增加了对 assert 和 with 的 JSON 文件声明方式的支持
     */
    return rules;
  });
};

/**
 * 用于配置和设定 Webpack 输出（output）的默认值
 * @param {Output} output options
 * @param {object} options options
 * @param {string} options.context context
 * @param {TargetProperties | false} options.targetProperties target properties
 * @param {boolean} options.isAffectedByBrowserslist is affected by browserslist
 * @param {boolean} options.outputModule is outputModule experiment enabled
 * @param {boolean} options.development is development mode
 * @param {Entry} options.entry entry option
 * @param {boolean} options.futureDefaults is future defaults enabled
 * @returns {void}
 */
const applyOutputDefaults = (
  output,
  {
    context, // 上下文路径，通常是项目的根目录
    targetProperties: tp, // 目标特性，用于确定支持的功能
    isAffectedByBrowserslist, // 是否受到 Browserslist 配置的影响
    outputModule, // 输出是否为模块（ESM）
    development, // 是否为开发模式
    entry, // 入口配置
    futureDefaults, // 是否使用未来的默认设置
  }
) => {
  /**
   * 用于获取库的名称
   */
  const getLibraryName = (library) => {
    // 传入的库不是数组,切存在 type 属性,则取其name 属性,否则直接使用
    const libraryName =
      typeof library === "object" &&
      library &&
      !Array.isArray(library) &&
      "type" in library
        ? library.name
        : library;

    // 如果是数组通过.拼接成字符串
    if (Array.isArray(libraryName)) {
      return libraryName.join(".");
    } else if (typeof libraryName === "object") {
      // 递归调用 getLibraryName 函数获取 root 的名称
      return getLibraryName(libraryName.root);
    } else if (typeof libraryName === "string") {
      return libraryName;
    }

    // 如果都不是，返回空字符串
    return "";
  };

  // uniqueName 是用于生成库的唯一标识符
  F(output, "uniqueName", () => {
    // 获取库的名称,处理库名称中可能存在的特殊字符或格式
    const libraryName = getLibraryName(output.library).replace(
      /**
       * 这个正则表达式包含了三个主要部分，用 | 分隔，表示“或”的关系
       *
       * 这个正则表达式旨在匹配类似于以下格式的字符串：
       * - "[name]." （第一部分）
       * - ".[name]" （第二部分）
       * - "[name]" （第三部分）
       */
      /^\[(\\*[\w:]+\\*)\](\.)|(\.)\[(\\*[\w:]+\\*)\](?=\.|$)|\[(\\*[\w:]+\\*)\]/g,
      // m 是匹配到的字符串,剩余的为捕获组
      (m, a, d1, d2, b, c) => {
        // 取出有效的捕获内容
        const content = a || b || c;
        // 判断捕获的内容是否被转义（以 \ 开头和结尾）
        // 如果是转义的，则将内容格式化为特定的字符串形式，移除开头和结尾的 \；否则返回空字符串
        return content.startsWith("\\") && content.endsWith("\\")
          ? `${d2 || ""}[${content.slice(1, -1)}]${d1 || ""}`
          : "";
      }
    );

    // 如果库的名称获取成功则返回
    if (libraryName) return libraryName;

    // 从 pkg 中获取名称
    const pkgPath = path.resolve(context, "package.json");
    try {
      const packageInfo = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return packageInfo.name || "";
    } catch (err) {
      if (/** @type {Error & { code: string }} */ (err).code !== "ENOENT") {
        /** @type {Error & { code: string }} */
        (err).message +=
          `\nwhile determining default 'output.uniqueName' from 'name' in ${pkgPath}`;
        throw err;
      }
      return "";
    }
  });

  // 输出是否是一个 ES 模块
  F(output, "module", () => Boolean(outputModule));
  // 文件名后缀为 .mjs
  D(output, "filename", output.module ? "[name].mjs" : "[name].js");
  // 如果不是模块输出，则使用立即调用函数表达式（IIFE）格式
  F(output, "iife", () => !output.module);
  // 用于指定动态导入的函数名称
  D(output, "importFunctionName", "import");
  // 用于指定导入元信息的名称
  D(output, "importMetaName", "import.meta");

  // chunk 的文件名
  F(output, "chunkFilename", () => {
    const filename = output.filename;
    if (typeof filename !== "function") {
      // 是否包含 [name] 占位符，表示文件名中包含 chunk 的名称
      const hasName = filename.includes("[name]");
      // 是否包含 [id] 占位符，表示 chunk 的唯一 ID
      const hasId = filename.includes("[id]");
      // 是否包含 [chunkhash] 占位符，用于生成与 chunk 内容相关的 hash
      const hasChunkHash = filename.includes("[chunkhash]");
      // 是否包含 [contenthash] 占位符，通常用于更改内容时生成的 hash
      const hasContentHash = filename.includes("[contenthash]");
      // Anything changing depending on chunk is fine

      // 包含上述任意一个占位符，直接返回原始的 filename
      if (hasChunkHash || hasContentHash || hasName || hasId) return filename;

      // 没有包含任何可变的占位符，就用正则表达式替换 filename 的基础名称部分
      // 在其前面加上 [id].，确保生成的文件名会随着 ID 的变化而变化
      return filename.replace(/(^|\/)([^/]*(?:\?|$))/, "$1[id].$2");
    }
    return output.module ? "[id].mjs" : "[id].js";
  });

  // 生成 CSS 文件的文件名
  F(output, "cssFilename", () => {
    const filename = output.filename;
    if (typeof filename !== "function") {
      // 将文件名中的 .js 后缀替换为 .css
      return filename.replace(/\.[mc]?js(\?|$)/, ".css$1");
    }
    return "[id].css";
  });
  // css chunk
  F(output, "cssChunkFilename", () => {
    const chunkFilename = output.chunkFilename;

    // 主要是将 chunk 文件名中的 .js 后缀替换为 .css
    if (typeof chunkFilename !== "function") {
      return chunkFilename.replace(/\.[mc]?js(\?|$)/, ".css$1");
    }
    return "[id].css";
  });

  // 当前环境不是开发模式，则启用 CSS 头部数据压缩
  D(output, "cssHeadDataCompression", !development);
  /**
   * 使用占位符 [hash]、[ext] 和 [query]
   * - [hash]: 将会根据文件内容生成的哈希值，确保每次内容变化时文件名也会变化，有助于缓存管理
   * - [ext]: 文件的扩展名（如 .png, .jpg, 等）
   * - [query]: URL 查询参数，通常用于控制请求的附加信息
   */
  D(output, "assetModuleFilename", "[hash][ext][query]");
  // 设置 WebAssembly 模块文件名的格式，确保 WebAssembly 文件在内容变化时也能生成新的文件名，避免缓存问题
  D(output, "webassemblyModuleFilename", "[hash].module.wasm");

  // 着在 Webpack 发出文件之前，会比较当前生成的文件和上次生成的文件。
  // 如果没有变化，则不会发出。这对于优化构建性能、避免不必要的文件发出非常有用
  D(output, "compareBeforeEmit", true);
  // 示生成的文件将包含字符集声明，例如 UTF-8。这对于确保浏览器正确解析文件内容很重要
  D(output, "charset", true);

  // 唯一名称
  const uniqueNameId = Template.toIdentifier(output.uniqueName);
  // 热更新时的全局变量名称
  F(output, "hotUpdateGlobal", () => `webpackHotUpdate${uniqueNameId}`);
  // 用于加载 chunk 时的全局变量名称
  F(output, "chunkLoadingGlobal", () => `webpackChunk${uniqueNameId}`);
  // 定义 Webpack 输出的全局对象
  F(output, "globalObject", () => {
    if (tp) {
      if (tp.global) return "global"; // Node.js 环境
      if (tp.globalThis) return "globalThis"; // 适用于所有环境的通用全局对象
    }
    return "self"; //  Web Worker 或浏览器环境中的全局对象
  });
  F(output, "chunkFormat", () => {
    if (tp) {
      const helpMessage = isAffectedByBrowserslist
        ? "Make sure that your 'browserslist' includes only platforms that support these features or select an appropriate 'target' to allow selecting a chunk format by default. Alternatively specify the 'output.chunkFormat' directly."
        : "Select an appropriate 'target' to allow selecting one by default, or specify the 'output.chunkFormat' directly.";
      if (output.module) {
        if (tp.dynamicImport) return "module";
        if (tp.document) return "array-push";
        throw new Error(
          "For the selected environment is no default ESM chunk format available:\n" +
            "ESM exports can be chosen when 'import()' is available.\n" +
            `JSONP Array push can be chosen when 'document' is available.\n${
              helpMessage
            }`
        );
      } else {
        if (tp.document) return "array-push";
        if (tp.require) return "commonjs";
        if (tp.nodeBuiltins) return "commonjs";
        if (tp.importScripts) return "array-push";
        throw new Error(
          "For the selected environment is no default script chunk format available:\n" +
            "JSONP Array push can be chosen when 'document' or 'importScripts' is available.\n" +
            `CommonJs exports can be chosen when 'require' or node builtins are available.\n${
              helpMessage
            }`
        );
      }
    }
    throw new Error(
      "Chunk format can't be selected by default when no target is specified"
    );
  });
  D(output, "asyncChunks", true);
  F(output, "chunkLoading", () => {
    if (tp) {
      switch (output.chunkFormat) {
        case "array-push":
          if (tp.document) return "jsonp";
          if (tp.importScripts) return "import-scripts";
          break;
        case "commonjs":
          if (tp.require) return "require";
          if (tp.nodeBuiltins) return "async-node";
          break;
        case "module":
          if (tp.dynamicImport || output.module) return "import";
          break;
      }
      if (
        tp.require === null ||
        tp.nodeBuiltins === null ||
        tp.document === null ||
        tp.importScripts === null
      ) {
        return "universal";
      }
    }
    return false;
  });
  F(output, "workerChunkLoading", () => {
    if (tp) {
      switch (output.chunkFormat) {
        case "array-push":
          if (tp.importScriptsInWorker) return "import-scripts";
          break;
        case "commonjs":
          if (tp.require) return "require";
          if (tp.nodeBuiltins) return "async-node";
          break;
        case "module":
          if (tp.dynamicImportInWorker || output.module) return "import";
          break;
      }
      if (
        tp.require === null ||
        tp.nodeBuiltins === null ||
        tp.importScriptsInWorker === null
      ) {
        return "universal";
      }
    }
    return false;
  });
  F(output, "wasmLoading", () => {
    if (tp) {
      if (tp.fetchWasm) return "fetch";
      if (tp.nodeBuiltins)
        return output.module ? "async-node-module" : "async-node";
      if (tp.nodeBuiltins === null || tp.fetchWasm === null) {
        return "universal";
      }
    }
    return false;
  });
  F(output, "workerWasmLoading", () => output.wasmLoading);
  F(output, "devtoolNamespace", () => output.uniqueName);
  if (output.library) {
    F(output.library, "type", () => (output.module ? "module" : "var"));
  }
  F(output, "path", () => path.join(process.cwd(), "dist"));
  F(output, "pathinfo", () => development);
  D(output, "sourceMapFilename", "[file].map[query]");
  D(
    output,
    "hotUpdateChunkFilename",
    `[id].[fullhash].hot-update.${output.module ? "mjs" : "js"}`
  );
  D(output, "hotUpdateMainFilename", "[runtime].[fullhash].hot-update.json");
  D(output, "crossOriginLoading", false);
  F(output, "scriptType", () => (output.module ? "module" : false));
  D(
    output,
    "publicPath",
    (tp && (tp.document || tp.importScripts)) || output.scriptType === "module"
      ? "auto"
      : ""
  );
  D(output, "workerPublicPath", "");
  D(output, "chunkLoadTimeout", 120000);
  D(output, "hashFunction", futureDefaults ? "xxhash64" : "md4");
  D(output, "hashDigest", "hex");
  D(output, "hashDigestLength", futureDefaults ? 16 : 20);
  D(output, "strictModuleErrorHandling", false);
  D(output, "strictModuleExceptionHandling", false);

  const environment = /** @type {Environment} */ (output.environment);
  /**
   * @param {boolean | undefined} v value
   * @returns {boolean} true, when v is truthy or undefined
   */
  const optimistic = (v) => v || v === undefined;
  /**
   * @param {boolean | undefined} v value
   * @param {boolean | undefined} c condition
   * @returns {boolean | undefined} true, when v is truthy or undefined, or c is truthy
   */
  const conditionallyOptimistic = (v, c) => (v === undefined && c) || v;

  F(
    environment,
    "globalThis",
    () => /** @type {boolean | undefined} */ (tp && tp.globalThis)
  );
  F(
    environment,
    "bigIntLiteral",
    () =>
      tp && optimistic(/** @type {boolean | undefined} */ (tp.bigIntLiteral))
  );
  F(
    environment,
    "const",
    () => tp && optimistic(/** @type {boolean | undefined} */ (tp.const))
  );
  F(
    environment,
    "arrowFunction",
    () =>
      tp && optimistic(/** @type {boolean | undefined} */ (tp.arrowFunction))
  );
  F(
    environment,
    "asyncFunction",
    () =>
      tp && optimistic(/** @type {boolean | undefined} */ (tp.asyncFunction))
  );
  F(
    environment,
    "forOf",
    () => tp && optimistic(/** @type {boolean | undefined} */ (tp.forOf))
  );
  F(
    environment,
    "destructuring",
    () =>
      tp && optimistic(/** @type {boolean | undefined} */ (tp.destructuring))
  );
  F(
    environment,
    "optionalChaining",
    () =>
      tp && optimistic(/** @type {boolean | undefined} */ (tp.optionalChaining))
  );
  F(
    environment,
    "nodePrefixForCoreModules",
    () =>
      tp &&
      optimistic(
        /** @type {boolean | undefined} */ (tp.nodePrefixForCoreModules)
      )
  );
  F(
    environment,
    "templateLiteral",
    () =>
      tp && optimistic(/** @type {boolean | undefined} */ (tp.templateLiteral))
  );
  F(environment, "dynamicImport", () =>
    conditionallyOptimistic(
      /** @type {boolean | undefined} */ (tp && tp.dynamicImport),
      output.module
    )
  );
  F(environment, "dynamicImportInWorker", () =>
    conditionallyOptimistic(
      /** @type {boolean | undefined} */ (tp && tp.dynamicImportInWorker),
      output.module
    )
  );
  F(environment, "module", () =>
    conditionallyOptimistic(
      /** @type {boolean | undefined} */ (tp && tp.module),
      output.module
    )
  );
  F(
    environment,
    "document",
    () => tp && optimistic(/** @type {boolean | undefined} */ (tp.document))
  );

  const { trustedTypes } = output;
  if (trustedTypes) {
    F(
      trustedTypes,
      "policyName",
      () =>
        /** @type {NonNullable<Output["uniqueName"]>} */
        (output.uniqueName).replace(/[^a-zA-Z0-9\-#=_/@.%]+/g, "_") || "webpack"
    );
    D(trustedTypes, "onPolicyCreationFailure", "stop");
  }

  /**
   * @param {function(EntryDescription): void} fn iterator
   * @returns {void}
   */
  const forEachEntry = (fn) => {
    for (const name of Object.keys(entry)) {
      fn(/** @type {{[k: string] : EntryDescription}} */ (entry)[name]);
    }
  };
  A(output, "enabledLibraryTypes", () => {
    /** @type {LibraryType[]} */
    const enabledLibraryTypes = [];
    if (output.library) {
      enabledLibraryTypes.push(output.library.type);
    }
    forEachEntry((desc) => {
      if (desc.library) {
        enabledLibraryTypes.push(desc.library.type);
      }
    });
    return enabledLibraryTypes;
  });

  A(output, "enabledChunkLoadingTypes", () => {
    const enabledChunkLoadingTypes = new Set();
    if (output.chunkLoading) {
      enabledChunkLoadingTypes.add(output.chunkLoading);
    }
    if (output.workerChunkLoading) {
      enabledChunkLoadingTypes.add(output.workerChunkLoading);
    }
    forEachEntry((desc) => {
      if (desc.chunkLoading) {
        enabledChunkLoadingTypes.add(desc.chunkLoading);
      }
    });
    return Array.from(enabledChunkLoadingTypes);
  });

  A(output, "enabledWasmLoadingTypes", () => {
    const enabledWasmLoadingTypes = new Set();
    if (output.wasmLoading) {
      enabledWasmLoadingTypes.add(output.wasmLoading);
    }
    if (output.workerWasmLoading) {
      enabledWasmLoadingTypes.add(output.workerWasmLoading);
    }
    forEachEntry((desc) => {
      if (desc.wasmLoading) {
        enabledWasmLoadingTypes.add(desc.wasmLoading);
      }
    });
    return Array.from(enabledWasmLoadingTypes);
  });
};

/**
 * 用于设置 externalsPresets 的默认配置项，以支持不同的运行环境（如 web、node、electron 等）和扩展配置
 */
const applyExternalsPresetsDefaults = (
  externalsPresets,
  { targetProperties, buildHttp }
) => {
  // 当 buildHttp 不启用并且 targetProperties.web 存在时，
  // 设置 web 为 true，表示外部模块支持 Web 环境
  D(
    externalsPresets,
    "web",
    /** @type {boolean | undefined} */
    (!buildHttp && targetProperties && targetProperties.web)
  );

  // 目标属性对象支持node，将node 设置为 true，表示支持 Node.js 环境
  D(
    externalsPresets,
    "node",
    /** @type {boolean | undefined} */
    (targetProperties && targetProperties.node)
  );

  // 表示支持 nwjs 环境
  // NW.js 是基于 Chromium 和 Node.js 的桌面应用框架
  D(
    externalsPresets,
    "nwjs",
    /** @type {boolean | undefined} */
    (targetProperties && targetProperties.nwjs)
  );

  /** 下面几个是针对 electron 的配置 --------------------------------- */
  // 表示支持 Electron
  D(
    externalsPresets,
    "electron",
    /** @type {boolean | undefined} */
    (targetProperties && targetProperties.electron)
  );
  // 表示支持 Electron 主进程
  D(
    externalsPresets,
    "electronMain",
    /** @type {boolean | undefined} */
    (
      targetProperties &&
        targetProperties.electron &&
        targetProperties.electronMain
    )
  );

  // 表示支持 Electron 预加载进程
  D(
    externalsPresets,
    "electronPreload",
    /** @type {boolean | undefined} */
    (
      targetProperties &&
        targetProperties.electron &&
        targetProperties.electronPreload
    )
  );

  // 表示支持 Electron 渲染进程
  D(
    externalsPresets,
    "electronRenderer",
    /** @type {boolean | undefined} */
    (
      targetProperties &&
        targetProperties.electron &&
        targetProperties.electronRenderer
    )
  );
};

/**
 * 用于为 loader 对象设置默认属性值
 * 定义了 loader 的目标环境（例如 electron、nwjs、node 等）以及环境变量
 */
const applyLoaderDefaults = (loader, { targetProperties, environment }) => {
  F(loader, "target", () => {
    if (targetProperties) {
      if (targetProperties.electron) {
        if (targetProperties.electronMain) return "electron-main";
        if (targetProperties.electronPreload) return "electron-preload";
        if (targetProperties.electronRenderer) return "electron-renderer";
        return "electron";
      }
      if (targetProperties.nwjs) return "nwjs";
      if (targetProperties.node) return "node";
      if (targetProperties.web) return "web";
    }
  });
  D(loader, "environment", environment);
};

/**
 * 为 Webpack 中的 node 配置项提供默认值
 * 主要处理 global、__filename 和 __dirname 这三个属性
 *
 * 此函数的主要作用是基于不同的配置参数,为 node 配置项提供合理的默认值。
 * 这在构建时帮助 Webpack 模拟 Node.js 的一些全局变量，
 * 特别是 global、__filename 和 __dirname，以支持多种运行环境
 */
const applyNodeDefaults = (
  node, // Webpack 配置中用于模拟 Node.js 环境的属性
  { futureDefaults, outputModule, targetProperties } // 环境信息
) => {
  // 直接返回，不应用任何默认配置
  if (node === false) return;

  // 设置 node.global 的默认值
  F(node, "global", () => {
    if (targetProperties && targetProperties.global) return false;
    // TODO webpack 6 should always default to false
    return futureDefaults ? "warn" : true;
  });

  // 返回 __filename 和 __dirname 的默认值
  const handlerForNames = () => {
    if (targetProperties && targetProperties.node)
      /**
       * node-module：将模块类型设置为 Node 风格的模块
       * eval-only：只允许在 eval 环境中使用
       */
      return outputModule ? "node-module" : "eval-only";
    // TODO webpack 6 should always default to false
    return futureDefaults ? "warn-mock" : "mock";
  };

  F(node, "__filename", handlerForNames);
  F(node, "__dirname", handlerForNames);
};

/**
 * 为 performance 配置对象设置默认值
 * @param {Performance} performance options
 * @param {object} options options
 * @param {boolean} options.production is production
 * @returns {void}
 */
const applyPerformanceDefaults = (performance, { production }) => {
  // 如果禁用性能分析 直接返回
  if (performance === false) return;

  // 限制单个静态资源文件的最大体积（250 KB），超出该体积时 Webpack 会在构建完成时发出提示
  D(performance, "maxAssetSize", 250000);
  // 限制入口点的资源总大小，即一个入口点包含的所有资源文件大小的总和
  D(performance, "maxEntrypointSize", 250000);
  // 控制 Webpack 是否输出性能提示
  F(performance, "hints", () => (production ? "warning" : false));
};

/**
 * 主要用于 Webpack 的优化设置 (optimization) 中，将不同的默认值应用到相关配置项中，
 * 依据环境条件（如生产或开发环境）进行合理调整
 */
const applyOptimizationDefaults = (
  optimization,
  { production, development, css, records }
) => {
  // 禁用移除可用模块
  D(optimization, "removeAvailableModules", false);
  // 启用移除空 chunk 的功能
  D(optimization, "removeEmptyChunks", true);
  // 启用合并重复的 chunk，减少冗余
  D(optimization, "mergeDuplicateChunks", true);
  // 在生产环境下标记已包含的 chunk
  D(optimization, "flagIncludedChunks", production);

  /**
   * 模块 ID 和 Chunk ID 配置
   *
   * - 生产环境使用 deterministic（确保构建内容一致的 ID 分配）
   * - 开发环境使用 named 以便于调试
   * - 默认情况下使用 natural，即自然排序的 ID
   */
  F(optimization, "moduleIds", () => {
    if (production) return "deterministic";
    if (development) return "named";
    return "natural";
  });
  F(optimization, "chunkIds", () => {
    if (production) return "deterministic";
    if (development) return "named";
    return "natural";
  });

  // 生产环境下，启用 sideEffects 以移除无副作用代码，开发环境则只标记副作用
  F(optimization, "sideEffects", () => (production ? true : "flag"));

  // 模块、导出、内图、变量混淆等优化，生产环境下会开启，开发环境下关闭
  D(optimization, "providedExports", true);
  D(optimization, "usedExports", production);
  D(optimization, "innerGraph", production);
  D(optimization, "mangleExports", production);
  D(optimization, "concatenateModules", production);

  /** 运行时和错误配置 -------------------------------------------------- */
  // 在生产环境关闭此功能，以确保模块分割
  D(optimization, "runtimeChunk", false);
  // 在开发环境保留错误输出
  D(optimization, "emitOnErrors", !production);
  // 生产环境下进行 WebAssembly 类型检查
  D(optimization, "checkWasmTypes", production);
  // 禁用对 WebAssembly 导入的混淆
  D(optimization, "mangleWasmImports", false);

  /** 记录文件和内容哈希 ---------------------------------------------------- */
  // 使用记录文件生成可移植的模块 ID 和 chunk ID
  D(optimization, "portableRecords", records);
  // 使用基于内容的哈希以确保缓存的有效性（生产环境）
  D(optimization, "realContentHash", production);

  /** 代码压缩 -------------------------------------------------------------- */
  // 生产环境下启用 minimize，利用 TerserPlugin 进行代码压缩，减少最终打包体积
  D(optimization, "minimize", production);
  A(optimization, "minimizer", () => [
    {
      apply: (compiler) => {
        // Lazy load the Terser plugin
        const TerserPlugin = require("terser-webpack-plugin");
        new TerserPlugin({
          terserOptions: {
            compress: {
              passes: 2,
            },
          },
        }).apply(compiler);
      },
    },
  ]);

  // 环境变量设置
  F(optimization, "nodeEnv", () => {
    if (production) return "production";
    if (development) return "development";
    return false;
  });

  /** splitChunks 配置 --------------------------------------------------- */
  const { splitChunks } = optimization;
  /**
   * 配置 splitChunks，其目的是在 Webpack 优化时拆分代码，按需加载模块，以减少打包后的文件大小和加载时间
   */
  if (splitChunks) {
    // 定义要优化的模块类型
    // 若项目包含 CSS，则还包括 css，unknown 则表示支持未知模块类型，确保打包时能适应不同资源类型
    A(splitChunks, "defaultSizeTypes", () =>
      css ? ["javascript", "css", "unknown"] : ["javascript", "unknown"]
    );

    // 在生产环境中将文件路径信息从输出中移除，提升文件路径隐私
    D(splitChunks, "hidePathInfo", production);
    // 设为 async，表示只拆分异步导入的模块，避免同步模块分块影响页面加载
    D(splitChunks, "chunks", "async");

    // 是否优化使用的导出
    D(splitChunks, "usedExports", optimization.usedExports === true);
    // 设置模块被引用的最小次数为 1，即模块至少被引用一次时才会进行分割
    D(splitChunks, "minChunks", 1);
    // 设置块的最小尺寸，生产环境下为 20000，开发环境为 10000，以更合理地分块
    F(splitChunks, "minSize", () => (production ? 20000 : 10000));
    // 在开发环境下为 0，即不强制最小剩余大小，以增强调试灵活性
    F(splitChunks, "minRemainingSize", () => (development ? 0 : undefined));

    // 强制分块的大小阈值，生产环境设为 50000，开发环境为 30000
    F(splitChunks, "enforceSizeThreshold", () => (production ? 50000 : 30000));
    // 生产环境最大异步请求和初始请求数为 30，开发环境为 Infinity，表示无限制
    F(splitChunks, "maxAsyncRequests", () => (production ? 30 : Infinity));
    F(splitChunks, "maxInitialRequests", () => (production ? 30 : Infinity));
    // 分块名称的分隔符，默认 "-" 用于生成更直观的分块名称
    D(splitChunks, "automaticNameDelimiter", "-");

    // 定义两个缓存组 default 和 defaultVendors，分别处理通用模块和第三方模块分组
    const cacheGroups = splitChunks.cacheGroups;

    // 用于通用模块，复用已存在的块
    F(cacheGroups, "default", () => ({
      idHint: "",
      reuseExistingChunk: true,
      minChunks: 2, // 模块至少被使用两次时会被缓存
      priority: -20, // 优先级为 -20
    }));

    // 用于 node_modules 内的第三方模块，优先级较高为 -10，以便第三方依赖被优先提取到 vendors 缓存中
    F(cacheGroups, "defaultVendors", () => ({
      idHint: "vendors",
      reuseExistingChunk: true,
      test: NODE_MODULES_REGEXP,
      priority: -10,
    }));
  }
};

/**
 * 生成 Webpack 的解析选项,会根据传入的参数动态调整，以适应不同的构建环境和目标平台
 */
const getResolveDefaults = ({
  cache, // 缓存配置
  context, // 当前的上下文路径，用于解析模块
  targetProperties, // 指定目标平台的属性对象
  mode, // 构建模式
  css, // 是否处理 CSS
}) => {
  /** 条件数组 */
  const conditions = ["webpack"];

  conditions.push(mode === "development" ? "development" : "production");

  // 根据目标属性构建条件
  if (targetProperties) {
    if (targetProperties.webworker) conditions.push("worker");
    if (targetProperties.node) conditions.push("node");
    if (targetProperties.web) conditions.push("browser");
    if (targetProperties.electron) conditions.push("electron");
    if (targetProperties.nwjs) conditions.push("nwjs");
  }

  /** js 文件的扩展名,用于在解析时使用 */
  const jsExtensions = [".js", ".json", ".wasm"];

  // 确定是否启用浏览器字段（browser），当且仅当满足特定条件时（如支持 web，且不是 Node.js）
  const tp = targetProperties;
  const browserField =
    tp && tp.web && (!tp.node || (tp.electron && tp.electronRenderer));

  /** 处理 cjs 依赖 */
  const cjsDeps = () => ({
    aliasFields: browserField ? ["browser"] : [],
    mainFields: browserField ? ["browser", "module", "..."] : ["module", "..."],
    conditionNames: ["require", "module", "..."],
    extensions: [...jsExtensions],
  });

  /** 处理 esm 依赖 */
  const esmDeps = () => ({
    aliasFields: browserField ? ["browser"] : [],
    mainFields: browserField ? ["browser", "module", "..."] : ["module", "..."],
    conditionNames: ["import", "module", "..."],
    extensions: [...jsExtensions],
  });

  // 构建 解析配置项
  const resolveOptions = {
    // 启用或禁用缓存机制。这可以加快模块解析的速度，通过存储已经解析的模块来避免重复工作
    cache,
    // 指定查找模块的目录,Webpack 将在 node_modules 文件夹中查找依赖模块
    modules: ["node_modules"],
    // 解析模块时要考虑的条件名称
    conditionNames: conditions,
    // 指定目录中的主文件名，默认值为 ["index"]。当模块解析时，Webpack 将优先查找这些文件
    mainFiles: ["index"],

    // 在查找模块时自动添加的文件扩展名,这里为空数组,通常通过后续的配置来填充
    extensions: [],
    // 模块的别名字段
    aliasFields: [],
    // 在解析过程中要查找的 exports 字段。这里设置为 ["exports"]，
    // 表示将尝试从模块的 package.json 文件中的 exports 字段查找导出
    exportsFields: ["exports"],
    // 用于模块解析的根目录。这里使用了传入的 context，表示模块解析的起始位置
    roots: [context],
    // 在解析过程中要查找的主要字段。这里设置为 ["main"]，
    // 意味着会从模块的 package.json 文件中查找 main 字段以确定入口文件
    mainFields: ["main"],
    // 在解析过程中要查找的导入字段。此处设置为 ["imports"]，表示会查找模块的 imports 字段
    importsFields: ["imports"],

    // 根据不同的依赖类型（如 ESM、CommonJS 等）来处理模块解析的具体方式
    byDependency: {
      wasm: esmDeps(),
      esm: esmDeps(),
      loaderImport: esmDeps(),
      url: {
        preferRelative: true, // 表示相对路径优先
      },
      worker: {
        ...esmDeps(),
        preferRelative: true,
      },
      commonjs: cjsDeps(),
      amd: cjsDeps(),
      // for backward-compat: loadModule
      loader: cjsDeps(),
      // for backward-compat: Custom Dependency
      unknown: cjsDeps(),
      // for backward-compat: getResolve without dependencyType
      undefined: cjsDeps(),
    },
  };

  // 为 css 解析添加相关的配置
  if (css) {
    /** 用于解析 CSS 文件时的决策 */
    const styleConditions = [];

    // 解析时需要考虑 Webpack 特定的条件
    styleConditions.push("webpack");
    // 根据不同的环境来选择合适的模块版本或解析策略
    styleConditions.push(mode === "development" ? "development" : "production");
    // 处理样式文件的解析
    styleConditions.push("style");

    // 影响 Webpack 在解析 CSS 导入时的行为
    resolveOptions.byDependency["css-import"] = {
      // We avoid using any main files because we have to be consistent with CSS `@import`
      // and CSS `@import` does not handle `main` files in directories,
      // you should always specify the full URL for styles
      /**
       * 设置为空数组,表示不使用任何主文件
       * 这是因为 CSS 的 @import 语法不支持主文件的概念，因此需要显式指定导入的完整 URL
       */
      mainFiles: [],
      // 在解析 CSS 文件时，会优先查找 package.json 中的 style 字段，确保加载适合样式的模块
      mainFields: ["style", "..."],
      // 告知 Webpack 在解析 CSS 时要考虑这些条件
      conditionNames: styleConditions,
      // 在查找模块时，WebPack 将自动考虑 .css 文件扩展名
      extensions: [".css"],
      // 优先使用相对路径
      preferRelative: true,
    };
  }

  return resolveOptions;
};

/**
 * @param {object} options options
 * @param {boolean} options.cache is cache enable
 * @returns {ResolveOptions} resolve options
 */
const getResolveLoaderDefaults = ({ cache }) => {
  /** @type {ResolveOptions} */
  const resolveOptions = {
    cache,
    conditionNames: ["loader", "require", "node"],
    exportsFields: ["exports"],
    mainFields: ["loader", "main"],
    extensions: [".js"],
    mainFiles: ["index"],
  };

  return resolveOptions;
};

/**
 * @param {InfrastructureLogging} infrastructureLogging options
 * @returns {void}
 */
const applyInfrastructureLoggingDefaults = (infrastructureLogging) => {
  // 默认的错误输出流
  F(infrastructureLogging, "stream", () => process.stderr);

  // 计算tty （是否支持文本终端）
  const tty =
    /** @type {any} */ (infrastructureLogging.stream).isTTY &&
    process.env.TERM !== "dumb";

  // 日志级别，默认 "info"
  D(infrastructureLogging, "level", "info");

  // 调试模式，默认 false
  D(infrastructureLogging, "debug", false);

  // 是否启用颜色输出
  D(infrastructureLogging, "colors", tty);

  // 是否仅追加日志（如果不支持 TTY，则设置为 true）
  D(infrastructureLogging, "appendOnly", !tty);
};

module.exports.applyWebpackOptionsBaseDefaults =
  applyWebpackOptionsBaseDefaults;
module.exports.applyWebpackOptionsDefaults = applyWebpackOptionsDefaults;
