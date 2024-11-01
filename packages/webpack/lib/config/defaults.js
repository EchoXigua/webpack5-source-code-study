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

  applyCacheDefaults(options.cache, {
    name: name || DEFAULT_CACHE_NAME,
    mode: mode || "production",
    development,
    cacheUnaffected: options.experiments.cacheUnaffected,
    compilerIndex,
  });
  const cache = Boolean(options.cache);

  applySnapshotDefaults(options.snapshot, {
    production,
    futureDefaults,
  });

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

  applyExternalsPresetsDefaults(options.externalsPresets, {
    targetProperties,
    buildHttp: Boolean(options.experiments.buildHttp),
  });

  applyLoaderDefaults(
    /** @type {NonNullable<WebpackOptionsNormalized["loader"]>} */ (
      options.loader
    ),
    { targetProperties, environment: options.output.environment }
  );

  F(options, "externalsType", () => {
    const validExternalTypes = require("../../schemas/WebpackOptions.json")
      .definitions.ExternalsType.enum;
    return options.output.library &&
      validExternalTypes.includes(options.output.library.type)
      ? /** @type {ExternalsType} */ (options.output.library.type)
      : options.output.module
        ? "module-import"
        : "var";
  });

  applyNodeDefaults(options.node, {
    futureDefaults:
      /** @type {NonNullable<WebpackOptionsNormalized["experiments"]["futureDefaults"]>} */
      (options.experiments.futureDefaults),
    outputModule: options.output.module,
    targetProperties,
  });

  F(options, "performance", () =>
    production &&
    targetProperties &&
    (targetProperties.browser || targetProperties.browser === null)
      ? {}
      : false
  );
  applyPerformanceDefaults(
    /** @type {NonNullable<WebpackOptionsNormalized["performance"]>} */
    (options.performance),
    {
      production,
    }
  );

  applyOptimizationDefaults(options.optimization, {
    development,
    production,
    css:
      /** @type {NonNullable<ExperimentsNormalized["css"]>} */
      (options.experiments.css),
    records: Boolean(options.recordsInputPath || options.recordsOutputPath),
  });

  options.resolve = cleverMerge(
    getResolveDefaults({
      cache,
      context: /** @type {Context} */ (options.context),
      targetProperties,
      mode: /** @type {Mode} */ (options.mode),
      css:
        /** @type {NonNullable<ExperimentsNormalized["css"]>} */
        (options.experiments.css),
    }),
    options.resolve
  );

  options.resolveLoader = cleverMerge(
    getResolveLoaderDefaults({ cache }),
    options.resolveLoader
  );

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
 * @param {CssGeneratorOptions} generatorOptions generator options
 * @param {object} options options
 * @param {TargetProperties | false} options.targetProperties target properties
 * @returns {void}
 */
const applyCssGeneratorOptionsDefaults = (
  generatorOptions,
  { targetProperties }
) => {
  D(
    generatorOptions,
    "exportsOnly",
    !targetProperties || !targetProperties.document
  );
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
    context,
    targetProperties: tp,
    isAffectedByBrowserslist,
    outputModule,
    development,
    entry,
    futureDefaults,
  }
) => {
  /**
   * @param {Library=} library the library option
   * @returns {string} a readable library name
   */
  const getLibraryName = (library) => {
    const libraryName =
      typeof library === "object" &&
      library &&
      !Array.isArray(library) &&
      "type" in library
        ? library.name
        : /** @type {LibraryName} */ (library);
    if (Array.isArray(libraryName)) {
      return libraryName.join(".");
    } else if (typeof libraryName === "object") {
      return getLibraryName(libraryName.root);
    } else if (typeof libraryName === "string") {
      return libraryName;
    }
    return "";
  };

  F(output, "uniqueName", () => {
    const libraryName = getLibraryName(output.library).replace(
      /^\[(\\*[\w:]+\\*)\](\.)|(\.)\[(\\*[\w:]+\\*)\](?=\.|$)|\[(\\*[\w:]+\\*)\]/g,
      (m, a, d1, d2, b, c) => {
        const content = a || b || c;
        return content.startsWith("\\") && content.endsWith("\\")
          ? `${d2 || ""}[${content.slice(1, -1)}]${d1 || ""}`
          : "";
      }
    );
    if (libraryName) return libraryName;
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

  F(output, "module", () => Boolean(outputModule));
  D(output, "filename", output.module ? "[name].mjs" : "[name].js");
  F(output, "iife", () => !output.module);
  D(output, "importFunctionName", "import");
  D(output, "importMetaName", "import.meta");
  F(output, "chunkFilename", () => {
    const filename =
      /** @type {NonNullable<Output["chunkFilename"]>} */
      (output.filename);
    if (typeof filename !== "function") {
      const hasName = filename.includes("[name]");
      const hasId = filename.includes("[id]");
      const hasChunkHash = filename.includes("[chunkhash]");
      const hasContentHash = filename.includes("[contenthash]");
      // Anything changing depending on chunk is fine
      if (hasChunkHash || hasContentHash || hasName || hasId) return filename;
      // Otherwise prefix "[id]." in front of the basename to make it changing
      return filename.replace(/(^|\/)([^/]*(?:\?|$))/, "$1[id].$2");
    }
    return output.module ? "[id].mjs" : "[id].js";
  });
  F(output, "cssFilename", () => {
    const filename =
      /** @type {NonNullable<Output["cssFilename"]>} */
      (output.filename);
    if (typeof filename !== "function") {
      return filename.replace(/\.[mc]?js(\?|$)/, ".css$1");
    }
    return "[id].css";
  });
  F(output, "cssChunkFilename", () => {
    const chunkFilename =
      /** @type {NonNullable<Output["cssChunkFilename"]>} */
      (output.chunkFilename);
    if (typeof chunkFilename !== "function") {
      return chunkFilename.replace(/\.[mc]?js(\?|$)/, ".css$1");
    }
    return "[id].css";
  });
  D(output, "cssHeadDataCompression", !development);
  D(output, "assetModuleFilename", "[hash][ext][query]");
  D(output, "webassemblyModuleFilename", "[hash].module.wasm");
  D(output, "compareBeforeEmit", true);
  D(output, "charset", true);
  const uniqueNameId = Template.toIdentifier(
    /** @type {NonNullable<Output["uniqueName"]>} */ (output.uniqueName)
  );
  F(output, "hotUpdateGlobal", () => `webpackHotUpdate${uniqueNameId}`);
  F(output, "chunkLoadingGlobal", () => `webpackChunk${uniqueNameId}`);
  F(output, "globalObject", () => {
    if (tp) {
      if (tp.global) return "global";
      if (tp.globalThis) return "globalThis";
    }
    return "self";
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
 * @param {ExternalsPresets} externalsPresets options
 * @param {object} options options
 * @param {TargetProperties | false} options.targetProperties target properties
 * @param {boolean} options.buildHttp buildHttp experiment enabled
 * @returns {void}
 */
const applyExternalsPresetsDefaults = (
  externalsPresets,
  { targetProperties, buildHttp }
) => {
  D(
    externalsPresets,
    "web",
    /** @type {boolean | undefined} */
    (!buildHttp && targetProperties && targetProperties.web)
  );
  D(
    externalsPresets,
    "node",
    /** @type {boolean | undefined} */
    (targetProperties && targetProperties.node)
  );
  D(
    externalsPresets,
    "nwjs",
    /** @type {boolean | undefined} */
    (targetProperties && targetProperties.nwjs)
  );
  D(
    externalsPresets,
    "electron",
    /** @type {boolean | undefined} */
    (targetProperties && targetProperties.electron)
  );
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
 * @param {Loader} loader options
 * @param {object} options options
 * @param {TargetProperties | false} options.targetProperties target properties
 * @param {Environment} options.environment environment
 * @returns {void}
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
 * @param {WebpackNode} node options
 * @param {object} options options
 * @param {TargetProperties | false} options.targetProperties target properties
 * @param {boolean} options.futureDefaults is future defaults enabled
 * @param {boolean} options.outputModule is output type is module
 * @returns {void}
 */
const applyNodeDefaults = (
  node,
  { futureDefaults, outputModule, targetProperties }
) => {
  if (node === false) return;

  F(node, "global", () => {
    if (targetProperties && targetProperties.global) return false;
    // TODO webpack 6 should always default to false
    return futureDefaults ? "warn" : true;
  });

  const handlerForNames = () => {
    if (targetProperties && targetProperties.node)
      return outputModule ? "node-module" : "eval-only";
    // TODO webpack 6 should always default to false
    return futureDefaults ? "warn-mock" : "mock";
  };

  F(node, "__filename", handlerForNames);
  F(node, "__dirname", handlerForNames);
};

/**
 * @param {Performance} performance options
 * @param {object} options options
 * @param {boolean} options.production is production
 * @returns {void}
 */
const applyPerformanceDefaults = (performance, { production }) => {
  if (performance === false) return;
  D(performance, "maxAssetSize", 250000);
  D(performance, "maxEntrypointSize", 250000);
  F(performance, "hints", () => (production ? "warning" : false));
};

/**
 * @param {Optimization} optimization options
 * @param {object} options options
 * @param {boolean} options.production is production
 * @param {boolean} options.development is development
 * @param {boolean} options.css is css enabled
 * @param {boolean} options.records using records
 * @returns {void}
 */
const applyOptimizationDefaults = (
  optimization,
  { production, development, css, records }
) => {
  D(optimization, "removeAvailableModules", false);
  D(optimization, "removeEmptyChunks", true);
  D(optimization, "mergeDuplicateChunks", true);
  D(optimization, "flagIncludedChunks", production);
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
  F(optimization, "sideEffects", () => (production ? true : "flag"));
  D(optimization, "providedExports", true);
  D(optimization, "usedExports", production);
  D(optimization, "innerGraph", production);
  D(optimization, "mangleExports", production);
  D(optimization, "concatenateModules", production);
  D(optimization, "runtimeChunk", false);
  D(optimization, "emitOnErrors", !production);
  D(optimization, "checkWasmTypes", production);
  D(optimization, "mangleWasmImports", false);
  D(optimization, "portableRecords", records);
  D(optimization, "realContentHash", production);
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
  F(optimization, "nodeEnv", () => {
    if (production) return "production";
    if (development) return "development";
    return false;
  });
  const { splitChunks } = optimization;
  if (splitChunks) {
    A(splitChunks, "defaultSizeTypes", () =>
      css ? ["javascript", "css", "unknown"] : ["javascript", "unknown"]
    );
    D(splitChunks, "hidePathInfo", production);
    D(splitChunks, "chunks", "async");
    D(splitChunks, "usedExports", optimization.usedExports === true);
    D(splitChunks, "minChunks", 1);
    F(splitChunks, "minSize", () => (production ? 20000 : 10000));
    F(splitChunks, "minRemainingSize", () => (development ? 0 : undefined));
    F(splitChunks, "enforceSizeThreshold", () => (production ? 50000 : 30000));
    F(splitChunks, "maxAsyncRequests", () => (production ? 30 : Infinity));
    F(splitChunks, "maxInitialRequests", () => (production ? 30 : Infinity));
    D(splitChunks, "automaticNameDelimiter", "-");
    const cacheGroups =
      /** @type {NonNullable<OptimizationSplitChunksOptions["cacheGroups"]>} */
      (splitChunks.cacheGroups);
    F(cacheGroups, "default", () => ({
      idHint: "",
      reuseExistingChunk: true,
      minChunks: 2,
      priority: -20,
    }));
    F(cacheGroups, "defaultVendors", () => ({
      idHint: "vendors",
      reuseExistingChunk: true,
      test: NODE_MODULES_REGEXP,
      priority: -10,
    }));
  }
};

/**
 * @param {object} options options
 * @param {boolean} options.cache is cache enable
 * @param {string} options.context build context
 * @param {TargetProperties | false} options.targetProperties target properties
 * @param {Mode} options.mode mode
 * @param {boolean} options.css is css enabled
 * @returns {ResolveOptions} resolve options
 */
const getResolveDefaults = ({
  cache,
  context,
  targetProperties,
  mode,
  css,
}) => {
  /** @type {string[]} */
  const conditions = ["webpack"];

  conditions.push(mode === "development" ? "development" : "production");

  if (targetProperties) {
    if (targetProperties.webworker) conditions.push("worker");
    if (targetProperties.node) conditions.push("node");
    if (targetProperties.web) conditions.push("browser");
    if (targetProperties.electron) conditions.push("electron");
    if (targetProperties.nwjs) conditions.push("nwjs");
  }

  const jsExtensions = [".js", ".json", ".wasm"];

  const tp = targetProperties;
  const browserField =
    tp && tp.web && (!tp.node || (tp.electron && tp.electronRenderer));

  /** @type {function(): ResolveOptions} */
  const cjsDeps = () => ({
    aliasFields: browserField ? ["browser"] : [],
    mainFields: browserField ? ["browser", "module", "..."] : ["module", "..."],
    conditionNames: ["require", "module", "..."],
    extensions: [...jsExtensions],
  });
  /** @type {function(): ResolveOptions} */
  const esmDeps = () => ({
    aliasFields: browserField ? ["browser"] : [],
    mainFields: browserField ? ["browser", "module", "..."] : ["module", "..."],
    conditionNames: ["import", "module", "..."],
    extensions: [...jsExtensions],
  });

  /** @type {ResolveOptions} */
  const resolveOptions = {
    cache,
    modules: ["node_modules"],
    conditionNames: conditions,
    mainFiles: ["index"],
    extensions: [],
    aliasFields: [],
    exportsFields: ["exports"],
    roots: [context],
    mainFields: ["main"],
    importsFields: ["imports"],
    byDependency: {
      wasm: esmDeps(),
      esm: esmDeps(),
      loaderImport: esmDeps(),
      url: {
        preferRelative: true,
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

  if (css) {
    const styleConditions = [];

    styleConditions.push("webpack");
    styleConditions.push(mode === "development" ? "development" : "production");
    styleConditions.push("style");

    resolveOptions.byDependency["css-import"] = {
      // We avoid using any main files because we have to be consistent with CSS `@import`
      // and CSS `@import` does not handle `main` files in directories,
      // you should always specify the full URL for styles
      mainFiles: [],
      mainFields: ["style", "..."],
      conditionNames: styleConditions,
      extensions: [".css"],
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
