/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const parseJson = require("json-parse-even-better-errors");
const asyncLib = require("neo-async");
const {
  SyncHook,
  SyncBailHook,
  AsyncParallelHook,
  AsyncSeriesHook,
} = require("tapable");
const { SizeOnlySource } = require("webpack-sources");
const webpack = require(".");
const Cache = require("./Cache");
// const CacheFacade = require("./CacheFacade");
// const ChunkGraph = require("./ChunkGraph");
// const Compilation = require("./Compilation");
// const ConcurrentCompilationError = require("./ConcurrentCompilationError");
// const ContextModuleFactory = require("./ContextModuleFactory");
// const ModuleGraph = require("./ModuleGraph");
// const NormalModuleFactory = require("./NormalModuleFactory");
// const RequestShortener = require("./RequestShortener");
// const ResolverFactory = require("./ResolverFactory");
// const Stats = require("./Stats");
// const Watching = require("./Watching");
// const WebpackError = require("./WebpackError");
// const { Logger } = require("./logging/Logger");
// const { join, dirname, mkdirp } = require("./util/fs");
// const { makePathsRelative } = require("./util/identifier");
// const { isSourceEqual } = require("./util/source");

/**
 * 判断一个字符串数组是否已按字典顺序排序
 * 对于一个按字典顺序排序的数组，任何位置 i 的元素都不应大于位置 i+1 的元素
 * @param {string[]} array an array
 * @returns {boolean} true, if the array is sorted
 */
const isSorted = (array) => {
  for (let i = 1; i < array.length; i++) {
    if (array[i - 1] > array[i]) return false;
  }
  return true;
};

/**
 * 将对象 obj 中的属性按属性名称进行排序，并返回包含这些属性的有序新对象
 *
 * 给一个对象添加属性，会按照下列规则存储顺序：
 * - 整数键（如 "1", "2"）：这些键会按照从小到大的顺序排列
 * - 字符串键（不包含整数键）：按照插入顺序排列
 * - Symbol 键：按插入顺序排列
 *
 * @param {{[key: string]: any}} obj an object
 * @param {string[]} keys the keys of the object
 * @returns {{[key: string]: any}} the object with properties sorted by property name
 */
const sortObject = (obj, keys) => {
  const o = {};

  // 将对象的key 按字典顺序排序
  for (const k of keys.sort()) {
    o[k] = obj[k];
  }
  return o;
};

/**
 * 用于判断 filename 中是否包含 hashes 列表中的任意字符串
 * 通常用于文件名中是否包含特定的哈希值，以便进行校验或处理
 *
 * @param {string} filename 需要检查的文件名
 * @param {string | string[] | undefined} hashes 哈希值列表，可以是单个字符串、字符串数组或未定义
 * @returns {boolean}
 */
const includesHash = (filename, hashes) => {
  if (!hashes) return false;
  if (Array.isArray(hashes)) {
    return hashes.some((hash) => filename.includes(hash));
  }
  return filename.includes(hashes);
};

class Compiler {
  /**
   * @param {string} context Webpack 编译的工作目录路径
   * @param {WebpackOptions} options 用于编译的配置选项
   */
  constructor(context, options = {}) {
    /**
     * hooks：包含多个编译生命周期事件的钩子，这些钩子让插件可以在编译的各个阶段执行自定义逻辑
     * 允许开发者通过插件或其他代码对构建过程进行扩展或定制
     * 每个钩子都与 Webpack 的某一阶段或事件关联，使用不同的钩子类型可以决定是否允许异步执行、是否允许中断流程等
     *
     * - 主要分为 SyncHook（同步钩子）、AsyncSeriesHook（异步串行钩子）和 AsyncParallelHook（异步并行钩子）
     * - SyncBailHook 也是一种同步钩子，它允许在调用监听器时，提前返回一个值，
     * 只要某个监听器返回非 undefined 的值，后续的监听器将不会被调用
     *
     * - 同步：
     * 		- 通过 new SyncHook([])、 new SyncBailHook 初始化
     * 		- 使用 tap 注册回调
     * 		- 使用 call 触发所有注册的回调
     * - 异步：
     * 		- 通过 new AsyncSeriesHook（按tapAsync 注册顺序串行）、new AsyncParallelHook 初始化
     * 		- 使用 tapAsync 注册回调
     * 		- 使用 callAsync 触发回调
     */
    this.hooks = Object.freeze({
      // Webpack 初始化后执行，可用于在插件中定义某些初始逻辑
      initialize: new SyncHook([]),

      /** 运行和完成钩子 ---------------------------------------- */
      /** 用于判断编译后是否生成新的输出文件。返回 false 会阻止生成 */
      shouldEmit: new SyncBailHook(["compilation"]),
      /** 构建完成时的钩子 */
      done: new AsyncSeriesHook(["stats"]),
      /** 在 done 钩子之后立即触发，用于执行与 done 钩子相关的后续操作 */
      afterDone: new SyncHook(["stats"]),
      /** 用于判断是否进行额外的构建周期 */
      additionalPass: new AsyncSeriesHook([]),

      /** 生成输出相关钩子 -------------------------------------------- */
      /** 在 Webpack 启动前触发 */
      beforeRun: new AsyncSeriesHook(["compiler"]),
      /** 在 Webpack 启动时触发 */
      run: new AsyncSeriesHook(["compiler"]),
      /** 生成打包产物之前触发 */
      emit: new AsyncSeriesHook(["compilation"]),
      /** 文件生成后触发，允许处理生成的文件 */
      assetEmitted: new AsyncSeriesHook(["file", "info"]),
      /** 与 emit 钩子类似，但在打包完成后执行 */
      afterEmit: new AsyncSeriesHook(["compilation"]),

      /** 每次新的编译上下文创建时触发，用于在编译过程开始时对编译环境进行设置和修改 */
      thisCompilation: new SyncHook(["compilation", "params"]),
      /** 在 thisCompilation 钩子之后触发，允许对编译上下文进行进一步的操作或修改 */
      compilation: new SyncHook(["compilation", "params"]),
      /** 在正常模块工厂创建时触发，可以在这里对模块的构建过程进行干预，比如添加自定义解析规则或修改模块处理逻辑 */
      normalModuleFactory: new SyncHook(["normalModuleFactory"]),
      /**
       * 在上下文模块工厂创建时触发，允许对上下文模块的处理进行自定义和扩展，
       * 上下文模块是指动态引入的模块，这个钩子允许开发者自定义它们的构建逻辑
       */
      contextModuleFactory: new SyncHook(["contextModuleFactory"]),

      /** 构建和编译相关钩子 ----------------------------------------------  */
      /** 在编译过程开始之前触发，常用于初始化编译依赖的资源 */
      beforeCompile: new AsyncSeriesHook(["params"]),
      /** 表示编译的开始 */
      compile: new SyncHook(["params"]),
      /** 执行模块构建过程的核心钩子 */
      make: new AsyncParallelHook(["compilation"]),
      /** make 钩子之后，用于处理构建完成后的操作 */
      finishMake: new AsyncSeriesHook(["compilation"]),
      /** 编译结束后执行，可用于清理和处理编译结果 */
      afterCompile: new AsyncSeriesHook(["compilation"]),

      /** 处理构建记录的钩子 ------------------------------------------------- */
      readRecords: new AsyncSeriesHook([]),
      emitRecords: new AsyncSeriesHook([]),

      /** 观察和文件变化相关钩子 --------------------------------------------- */
      /** 监听模式下，编译前触发 */
      watchRun: new AsyncSeriesHook(["compiler"]),
      /** 编译失败时触发 */
      failed: new SyncHook(["error"]),
      /** 文件变动导致编译无效时触发 */
      invalid: new SyncHook(["filename", "changeTime"]),
      /** 观察模式关闭时触发 */
      watchClose: new SyncHook([]),
      /** 在 Webpack 关闭或结束时触发，允许执行一些清理操作，比如关闭连接、释放资源等 */
      shutdown: new AsyncSeriesHook([]),

      /** 提供日志信息 */
      infrastructureLog: new SyncBailHook(["origin", "type", "args"]),

      // TODO the following hooks are weirdly located here
      // TODO move them for webpack 5
      /** 环境初始化后触发 */
      environment: new SyncHook([]),
      afterEnvironment: new SyncHook([]),
      /** 插件和解析器完成设置后触发 */
      afterPlugins: new SyncHook(["compiler"]),
      afterResolvers: new SyncHook(["compiler"]),
      /** 用于处理 entry 配置项的钩子 */
      entryOption: new SyncBailHook(["context", "entry"]),
    });

    /** 存储 Webpack 本身的实例 */
    this.webpack = webpack;

    /** 编译器名称，通常用于标识不同的编译器实例 */
    this.name = undefined;

    /** 父编译实例，主要用于多重编译时（例如 DLL） */
    this.parentCompilation = undefined;
    /**
     * 指向顶级 Compiler 实例的引用
     * @type {Compiler}
     */
    this.root = this;
    /** 定义输出文件路径 */
    this.outputPath = "";
    /** 指示当前是否在“观察模式”（watch mode）下运行。若处于观察模式，Webpack 会监听文件变动并重新构建 */
    this.watching = undefined;

    /** 用于管理编译输出的文件系统 */
    this.outputFileSystem = null;
    this.intermediateFileSystem = null;
    /** 用于读取项目文件的输入文件系统 */
    this.inputFileSystem = null;
    /** 文件监视系统，用于检测文件更改 */
    this.watchFileSystem = null;

    /** 用于指定记录文件的输入和输出路径，记录文件通常用于保存构建状态和信息，以便在下次构建时进行快速恢复 */
    this.recordsInputPath = null;
    this.recordsOutputPath = null;
    /** 存储记录信息的对象，可能包括模块的构建信息和状态 */
    this.records = {};

    /** 存储受 Webpack 监控和管理的路径集合 */
    this.managedPaths = new Set();
    /** 存储未受 webpack 管理的路径集合 */
    this.unmanagedPaths = new Set();
    /** 存储不可变路径集合，指示 Webpack 认为这些路径中的内容不会变化，因此不需要重新构建。 */
    this.immutablePaths = new Set();

    /** 存储被修改的文件路径集合，用于在构建过程中追踪文件的变化 */
    this.modifiedFiles = undefined;
    /** 存储被删除的文件路径集合，帮助 Webpack 跟踪哪些文件已不再存在 */
    this.removedFiles = undefined;
    /** 存储文件的时间戳信息，通常用于判断文件是否被修改 */
    this.fileTimestamps = undefined;
    /** 存储上下文文件的时间戳信息，帮助判断上下文是否有变化 */
    this.contextTimestamps = undefined;
    /** 记录文件系统开始时间，可能用于监控文件系统的性能 */
    this.fsStartTime = undefined;

    /** 创建解析器的工厂，用于处理模块的解析和导入逻辑 */
    this.resolverFactory = new ResolverFactory();

    /** 用于记录基础设施日志的函数，帮助调试和监控构建过程 */
    this.infrastructureLogger = undefined;

    /** 存储与目标平台相关的属性，指示支持的目标环境（如 Web、Node.js、Electron 等） */
    this.platform = {
      web: null,
      browser: null,
      webworker: null,
      node: null,
      nwjs: null,
      electron: null,
    };

    /** 存储传递给 Webpack 的配置选项，用于定制构建过程 */
    this.options = options;

    /** 存储编译上下文路径，通常是 Webpack 执行的工作目录 */
    this.context = context;

    /** 用于缩短请求路径，以便于输出和日志记录 */
    this.requestShortener = new RequestShortener(context, this.root);

    /** 用于存储构建过程中的缓存信息，提高构建效率 */
    this.cache = new Cache();

    /** 存储模块的内存缓存信息，加速模块的构建和解析过程 */
    /** @type {Map<Module, { buildInfo: BuildInfo, references: References | undefined, memCache: WeakTupleMap<any, any> }> | undefined} */
    this.moduleMemCaches = undefined;

    /** 存储编译器的路径信息，可能用于输出或错误处理 */
    this.compilerPath = "";

    /**
     * 指示编译器当前是否正在运行，方便管理构建过程的状态
     * @type {boolean}
     */
    this.running = false;

    /**
     * 指示编译器是否处于空闲状态，通常在构建过程和资源管理中使用
     * @type {boolean}
     */
    this.idle = false;

    /**
     * 指示编译器是否在观察模式下运行，决定是否监听文件变化
     * @type {boolean}
     */
    this.watchMode = false;

    /** 表示是否开启向后兼容模式，通常用于支持旧版本的 Webpack 配置 */
    this._backCompat = this.options.experiments.backCompat !== false;

    /**
     * 存储上一次的编译结果，以便在后续处理时参考
     * @type {Compilation | undefined}
     */
    this._lastCompilation = undefined;
    /** 存储上一次的正常模块工厂，方便复用或优化模块的构建 */
    this._lastNormalModuleFactory = undefined;

    /**
     * 存储资产发射源的缓存信息，以优化资产的发射过程
     *
     * @private
     * @type {WeakMap<Source, CacheEntry>}
     */
    this._assetEmittingSourceCache = new WeakMap();
    /**
     * 记录已发射文件的状态，以便于管理和优化输出过程
     * @private
     * @type {Map<string, number>}
     */
    this._assetEmittingWrittenFiles = new Map();
    /**
     * 存储之前发射的文件，以便在构建过程中进行检查和优化
     * @private
     * @type {Set<string>}
     */
    this._assetEmittingPreviousFiles = new Set();
  }

  /**
   * @param {string} name cache name
   * @returns {CacheFacade} the cache facade instance
   */
  getCache(name) {
    return new CacheFacade(
      this.cache,
      `${this.compilerPath}${name}`,
      this.options.output.hashFunction
    );
  }

  /**
   * @param {string | (function(): string)} name name of the logger, or function called once to get the logger name
   * @returns {Logger} a logger with that name
   */
  getInfrastructureLogger(name) {
    if (!name) {
      throw new TypeError(
        "Compiler.getInfrastructureLogger(name) called without a name"
      );
    }
    return new Logger(
      (type, args) => {
        if (typeof name === "function") {
          name = name();
          if (!name) {
            throw new TypeError(
              "Compiler.getInfrastructureLogger(name) called with a function not returning a name"
            );
          }
        }
        if (
          this.hooks.infrastructureLog.call(name, type, args) === undefined &&
          this.infrastructureLogger !== undefined
        ) {
          this.infrastructureLogger(name, type, args);
        }
      },
      (childName) => {
        if (typeof name === "function") {
          if (typeof childName === "function") {
            return this.getInfrastructureLogger(() => {
              if (typeof name === "function") {
                name = name();
                if (!name) {
                  throw new TypeError(
                    "Compiler.getInfrastructureLogger(name) called with a function not returning a name"
                  );
                }
              }
              if (typeof childName === "function") {
                childName = childName();
                if (!childName) {
                  throw new TypeError(
                    "Logger.getChildLogger(name) called with a function not returning a name"
                  );
                }
              }
              return `${name}/${childName}`;
            });
          }
          return this.getInfrastructureLogger(() => {
            if (typeof name === "function") {
              name = name();
              if (!name) {
                throw new TypeError(
                  "Compiler.getInfrastructureLogger(name) called with a function not returning a name"
                );
              }
            }
            return `${name}/${childName}`;
          });
        }
        if (typeof childName === "function") {
          return this.getInfrastructureLogger(() => {
            if (typeof childName === "function") {
              childName = childName();
              if (!childName) {
                throw new TypeError(
                  "Logger.getChildLogger(name) called with a function not returning a name"
                );
              }
            }
            return `${name}/${childName}`;
          });
        }
        return this.getInfrastructureLogger(`${name}/${childName}`);
      }
    );
  }

  // TODO webpack 6: solve this in a better way
  // e.g. move compilation specific info from Modules into ModuleGraph
  _cleanupLastCompilation() {
    if (this._lastCompilation !== undefined) {
      for (const childCompilation of this._lastCompilation.children) {
        for (const module of childCompilation.modules) {
          ChunkGraph.clearChunkGraphForModule(module);
          ModuleGraph.clearModuleGraphForModule(module);
          module.cleanupForCache();
        }
        for (const chunk of childCompilation.chunks) {
          ChunkGraph.clearChunkGraphForChunk(chunk);
        }
      }

      for (const module of this._lastCompilation.modules) {
        ChunkGraph.clearChunkGraphForModule(module);
        ModuleGraph.clearModuleGraphForModule(module);
        module.cleanupForCache();
      }
      for (const chunk of this._lastCompilation.chunks) {
        ChunkGraph.clearChunkGraphForChunk(chunk);
      }
      this._lastCompilation = undefined;
    }
  }

  // TODO webpack 6: solve this in a better way
  _cleanupLastNormalModuleFactory() {
    if (this._lastNormalModuleFactory !== undefined) {
      this._lastNormalModuleFactory.cleanupForCache();
      this._lastNormalModuleFactory = undefined;
    }
  }

  /**
   * @param {WatchOptions} watchOptions the watcher's options
   * @param {RunCallback<Stats>} handler signals when the call finishes
   * @returns {Watching} a compiler watcher
   */
  watch(watchOptions, handler) {
    if (this.running) {
      return handler(new ConcurrentCompilationError());
    }

    this.running = true;
    this.watchMode = true;
    this.watching = new Watching(this, watchOptions, handler);
    return this.watching;
  }

  /**
   * @param {RunCallback<Stats>} callback signals when the call finishes
   * @returns {void}
   */
  run(callback) {
    if (this.running) {
      return callback(new ConcurrentCompilationError());
    }

    /** @type {Logger | undefined} */
    let logger;

    /**
     * @param {Error | null} err error
     * @param {Stats=} stats stats
     */
    const finalCallback = (err, stats) => {
      if (logger) logger.time("beginIdle");
      this.idle = true;
      this.cache.beginIdle();
      this.idle = true;
      if (logger) logger.timeEnd("beginIdle");
      this.running = false;
      if (err) {
        this.hooks.failed.call(err);
      }
      if (callback !== undefined) callback(err, stats);
      this.hooks.afterDone.call(/** @type {Stats} */ (stats));
    };

    const startTime = Date.now();

    this.running = true;

    /**
     * @param {Error | null} err error
     * @param {Compilation=} _compilation compilation
     * @returns {void}
     */
    const onCompiled = (err, _compilation) => {
      if (err) return finalCallback(err);

      const compilation = /** @type {Compilation} */ (_compilation);

      if (this.hooks.shouldEmit.call(compilation) === false) {
        compilation.startTime = startTime;
        compilation.endTime = Date.now();
        const stats = new Stats(compilation);
        this.hooks.done.callAsync(stats, (err) => {
          if (err) return finalCallback(err);
          return finalCallback(null, stats);
        });
        return;
      }

      process.nextTick(() => {
        logger = compilation.getLogger("webpack.Compiler");
        logger.time("emitAssets");
        this.emitAssets(compilation, (err) => {
          /** @type {Logger} */
          (logger).timeEnd("emitAssets");
          if (err) return finalCallback(err);

          if (compilation.hooks.needAdditionalPass.call()) {
            compilation.needAdditionalPass = true;

            compilation.startTime = startTime;
            compilation.endTime = Date.now();
            /** @type {Logger} */
            (logger).time("done hook");
            const stats = new Stats(compilation);
            this.hooks.done.callAsync(stats, (err) => {
              /** @type {Logger} */
              (logger).timeEnd("done hook");
              if (err) return finalCallback(err);

              this.hooks.additionalPass.callAsync((err) => {
                if (err) return finalCallback(err);
                this.compile(onCompiled);
              });
            });
            return;
          }

          /** @type {Logger} */
          (logger).time("emitRecords");
          this.emitRecords((err) => {
            /** @type {Logger} */
            (logger).timeEnd("emitRecords");
            if (err) return finalCallback(err);

            compilation.startTime = startTime;
            compilation.endTime = Date.now();
            /** @type {Logger} */
            (logger).time("done hook");
            const stats = new Stats(compilation);
            this.hooks.done.callAsync(stats, (err) => {
              /** @type {Logger} */
              (logger).timeEnd("done hook");
              if (err) return finalCallback(err);
              this.cache.storeBuildDependencies(
                compilation.buildDependencies,
                (err) => {
                  if (err) return finalCallback(err);
                  return finalCallback(null, stats);
                }
              );
            });
          });
        });
      });
    };

    const run = () => {
      this.hooks.beforeRun.callAsync(this, (err) => {
        if (err) return finalCallback(err);

        this.hooks.run.callAsync(this, (err) => {
          if (err) return finalCallback(err);

          this.readRecords((err) => {
            if (err) return finalCallback(err);

            this.compile(onCompiled);
          });
        });
      });
    };

    if (this.idle) {
      this.cache.endIdle((err) => {
        if (err) return finalCallback(err);

        this.idle = false;
        run();
      });
    } else {
      run();
    }
  }

  /**
   * @param {RunAsChildCallback} callback signals when the call finishes
   * @returns {void}
   */
  runAsChild(callback) {
    const startTime = Date.now();

    /**
     * @param {Error | null} err error
     * @param {Chunk[]=} entries entries
     * @param {Compilation=} compilation compilation
     */
    const finalCallback = (err, entries, compilation) => {
      try {
        callback(err, entries, compilation);
      } catch (runAsChildErr) {
        const err = new WebpackError(
          `compiler.runAsChild callback error: ${runAsChildErr}`
        );
        err.details = /** @type {Error} */ (runAsChildErr).stack;
        /** @type {Compilation} */
        (this.parentCompilation).errors.push(err);
      }
    };

    this.compile((err, _compilation) => {
      if (err) return finalCallback(err);

      const compilation = /** @type {Compilation} */ (_compilation);
      const parentCompilation = /** @type {Compilation} */ (
        this.parentCompilation
      );

      parentCompilation.children.push(compilation);

      for (const { name, source, info } of compilation.getAssets()) {
        parentCompilation.emitAsset(name, source, info);
      }

      /** @type {Chunk[]} */
      const entries = [];

      for (const ep of compilation.entrypoints.values()) {
        entries.push(...ep.chunks);
      }

      compilation.startTime = startTime;
      compilation.endTime = Date.now();

      return finalCallback(null, entries, compilation);
    });
  }

  purgeInputFileSystem() {
    if (this.inputFileSystem && this.inputFileSystem.purge) {
      this.inputFileSystem.purge();
    }
  }

  /**
   * @param {Compilation} compilation the compilation
   * @param {Callback<void>} callback signals when the assets are emitted
   * @returns {void}
   */
  emitAssets(compilation, callback) {
    /** @type {string} */
    let outputPath;

    /**
     * @param {Error=} err error
     * @returns {void}
     */
    const emitFiles = (err) => {
      if (err) return callback(err);

      const assets = compilation.getAssets();
      compilation.assets = { ...compilation.assets };
      /** @type {Map<string, SimilarEntry>} */
      const caseInsensitiveMap = new Map();
      /** @type {Set<string>} */
      const allTargetPaths = new Set();
      asyncLib.forEachLimit(
        assets,
        15,
        ({ name: file, source, info }, callback) => {
          let targetFile = file;
          let immutable = info.immutable;
          const queryStringIdx = targetFile.indexOf("?");
          if (queryStringIdx >= 0) {
            targetFile = targetFile.slice(0, queryStringIdx);
            // We may remove the hash, which is in the query string
            // So we recheck if the file is immutable
            // This doesn't cover all cases, but immutable is only a performance optimization anyway
            immutable =
              immutable &&
              (includesHash(targetFile, info.contenthash) ||
                includesHash(targetFile, info.chunkhash) ||
                includesHash(targetFile, info.modulehash) ||
                includesHash(targetFile, info.fullhash));
          }

          /**
           * @param {Error=} err error
           * @returns {void}
           */
          const writeOut = (err) => {
            if (err) return callback(err);
            const targetPath = join(
              /** @type {OutputFileSystem} */
              (this.outputFileSystem),
              outputPath,
              targetFile
            );
            allTargetPaths.add(targetPath);

            // check if the target file has already been written by this Compiler
            const targetFileGeneration =
              this._assetEmittingWrittenFiles.get(targetPath);

            // create an cache entry for this Source if not already existing
            let cacheEntry = this._assetEmittingSourceCache.get(source);
            if (cacheEntry === undefined) {
              cacheEntry = {
                sizeOnlySource: undefined,
                writtenTo: new Map(),
              };
              this._assetEmittingSourceCache.set(source, cacheEntry);
            }

            /** @type {SimilarEntry | undefined} */
            let similarEntry;

            const checkSimilarFile = () => {
              const caseInsensitiveTargetPath = targetPath.toLowerCase();
              similarEntry = caseInsensitiveMap.get(caseInsensitiveTargetPath);
              if (similarEntry !== undefined) {
                const { path: other, source: otherSource } = similarEntry;
                if (isSourceEqual(otherSource, source)) {
                  // Size may or may not be available at this point.
                  // If it's not available add to "waiting" list and it will be updated once available
                  if (similarEntry.size !== undefined) {
                    updateWithReplacementSource(similarEntry.size);
                  } else {
                    if (!similarEntry.waiting) similarEntry.waiting = [];
                    similarEntry.waiting.push({ file, cacheEntry });
                  }
                  alreadyWritten();
                } else {
                  const err =
                    new WebpackError(`Prevent writing to file that only differs in casing or query string from already written file.
This will lead to a race-condition and corrupted files on case-insensitive file systems.
${targetPath}
${other}`);
                  err.file = file;
                  callback(err);
                }
                return true;
              }
              caseInsensitiveMap.set(
                caseInsensitiveTargetPath,
                (similarEntry = /** @type {SimilarEntry} */ ({
                  path: targetPath,
                  source,
                  size: undefined,
                  waiting: undefined,
                }))
              );
              return false;
            };

            /**
             * get the binary (Buffer) content from the Source
             * @returns {Buffer} content for the source
             */
            const getContent = () => {
              if (typeof source.buffer === "function") {
                return source.buffer();
              }
              const bufferOrString = source.source();
              if (Buffer.isBuffer(bufferOrString)) {
                return bufferOrString;
              }
              return Buffer.from(bufferOrString, "utf8");
            };

            const alreadyWritten = () => {
              // cache the information that the Source has been already been written to that location
              if (targetFileGeneration === undefined) {
                const newGeneration = 1;
                this._assetEmittingWrittenFiles.set(targetPath, newGeneration);
                /** @type {CacheEntry} */
                (cacheEntry).writtenTo.set(targetPath, newGeneration);
              } else {
                /** @type {CacheEntry} */
                (cacheEntry).writtenTo.set(targetPath, targetFileGeneration);
              }
              callback();
            };

            /**
             * Write the file to output file system
             * @param {Buffer} content content to be written
             * @returns {void}
             */
            const doWrite = (content) => {
              /** @type {OutputFileSystem} */
              (this.outputFileSystem).writeFile(targetPath, content, (err) => {
                if (err) return callback(err);

                // information marker that the asset has been emitted
                compilation.emittedAssets.add(file);

                // cache the information that the Source has been written to that location
                const newGeneration =
                  targetFileGeneration === undefined
                    ? 1
                    : targetFileGeneration + 1;
                /** @type {CacheEntry} */
                (cacheEntry).writtenTo.set(targetPath, newGeneration);
                this._assetEmittingWrittenFiles.set(targetPath, newGeneration);
                this.hooks.assetEmitted.callAsync(
                  file,
                  {
                    content,
                    source,
                    outputPath,
                    compilation,
                    targetPath,
                  },
                  callback
                );
              });
            };

            /**
             * @param {number} size size
             */
            const updateWithReplacementSource = (size) => {
              updateFileWithReplacementSource(
                file,
                /** @type {CacheEntry} */ (cacheEntry),
                size
              );
              /** @type {SimilarEntry} */
              (similarEntry).size = size;
              if (
                /** @type {SimilarEntry} */ (similarEntry).waiting !== undefined
              ) {
                for (const { file, cacheEntry } of /** @type {SimilarEntry} */ (
                  similarEntry
                ).waiting) {
                  updateFileWithReplacementSource(file, cacheEntry, size);
                }
              }
            };

            /**
             * @param {string} file file
             * @param {CacheEntry} cacheEntry cache entry
             * @param {number} size size
             */
            const updateFileWithReplacementSource = (
              file,
              cacheEntry,
              size
            ) => {
              // Create a replacement resource which only allows to ask for size
              // This allows to GC all memory allocated by the Source
              // (expect when the Source is stored in any other cache)
              if (!cacheEntry.sizeOnlySource) {
                cacheEntry.sizeOnlySource = new SizeOnlySource(size);
              }
              compilation.updateAsset(file, cacheEntry.sizeOnlySource, {
                size,
              });
            };

            /**
             * @param {IStats} stats stats
             * @returns {void}
             */
            const processExistingFile = (stats) => {
              // skip emitting if it's already there and an immutable file
              if (immutable) {
                updateWithReplacementSource(/** @type {number} */ (stats.size));
                return alreadyWritten();
              }

              const content = getContent();

              updateWithReplacementSource(content.length);

              // if it exists and content on disk matches content
              // skip writing the same content again
              // (to keep mtime and don't trigger watchers)
              // for a fast negative match file size is compared first
              if (content.length === stats.size) {
                compilation.comparedForEmitAssets.add(file);
                return /** @type {OutputFileSystem} */ (
                  this.outputFileSystem
                ).readFile(targetPath, (err, existingContent) => {
                  if (
                    err ||
                    !content.equals(/** @type {Buffer} */ (existingContent))
                  ) {
                    return doWrite(content);
                  }
                  return alreadyWritten();
                });
              }

              return doWrite(content);
            };

            const processMissingFile = () => {
              const content = getContent();

              updateWithReplacementSource(content.length);

              return doWrite(content);
            };

            // if the target file has already been written
            if (targetFileGeneration !== undefined) {
              // check if the Source has been written to this target file
              const writtenGeneration = /** @type {CacheEntry} */ (
                cacheEntry
              ).writtenTo.get(targetPath);
              if (writtenGeneration === targetFileGeneration) {
                // if yes, we may skip writing the file
                // if it's already there
                // (we assume one doesn't modify files while the Compiler is running, other then removing them)

                if (this._assetEmittingPreviousFiles.has(targetPath)) {
                  const sizeOnlySource = /** @type {SizeOnlySource} */ (
                    /** @type {CacheEntry} */ (cacheEntry).sizeOnlySource
                  );

                  // We assume that assets from the last compilation say intact on disk (they are not removed)
                  compilation.updateAsset(file, sizeOnlySource, {
                    size: sizeOnlySource.size(),
                  });

                  return callback();
                }
                // Settings immutable will make it accept file content without comparing when file exist
                immutable = true;
              } else if (!immutable) {
                if (checkSimilarFile()) return;
                // We wrote to this file before which has very likely a different content
                // skip comparing and assume content is different for performance
                // This case happens often during watch mode.
                return processMissingFile();
              }
            }

            if (checkSimilarFile()) return;
            if (this.options.output.compareBeforeEmit) {
              /** @type {OutputFileSystem} */
              (this.outputFileSystem).stat(targetPath, (err, stats) => {
                const exists = !err && /** @type {IStats} */ (stats).isFile();

                if (exists) {
                  processExistingFile(/** @type {IStats} */ (stats));
                } else {
                  processMissingFile();
                }
              });
            } else {
              processMissingFile();
            }
          };

          if (/\/|\\/.test(targetFile)) {
            const fs = /** @type {OutputFileSystem} */ (this.outputFileSystem);
            const dir = dirname(fs, join(fs, outputPath, targetFile));
            mkdirp(fs, dir, writeOut);
          } else {
            writeOut();
          }
        },
        (err) => {
          // Clear map to free up memory
          caseInsensitiveMap.clear();
          if (err) {
            this._assetEmittingPreviousFiles.clear();
            return callback(err);
          }

          this._assetEmittingPreviousFiles = allTargetPaths;

          this.hooks.afterEmit.callAsync(compilation, (err) => {
            if (err) return callback(err);

            return callback();
          });
        }
      );
    };

    this.hooks.emit.callAsync(compilation, (err) => {
      if (err) return callback(err);
      outputPath = compilation.getPath(this.outputPath, {});
      mkdirp(
        /** @type {OutputFileSystem} */ (this.outputFileSystem),
        outputPath,
        emitFiles
      );
    });
  }

  /**
   * @param {Callback<void>} callback signals when the call finishes
   * @returns {void}
   */
  emitRecords(callback) {
    if (this.hooks.emitRecords.isUsed()) {
      if (this.recordsOutputPath) {
        asyncLib.parallel(
          [
            (cb) => this.hooks.emitRecords.callAsync(cb),
            this._emitRecords.bind(this),
          ],
          (err) => callback(err)
        );
      } else {
        this.hooks.emitRecords.callAsync(callback);
      }
    } else if (this.recordsOutputPath) {
      this._emitRecords(callback);
    } else {
      callback();
    }
  }

  /**
   * @param {Callback<void>} callback signals when the call finishes
   * @returns {void}
   */
  _emitRecords(callback) {
    const writeFile = () => {
      /** @type {OutputFileSystem} */
      (this.outputFileSystem).writeFile(
        /** @type {string} */ (this.recordsOutputPath),
        JSON.stringify(
          this.records,
          (n, value) => {
            if (
              typeof value === "object" &&
              value !== null &&
              !Array.isArray(value)
            ) {
              const keys = Object.keys(value);
              if (!isSorted(keys)) {
                return sortObject(value, keys);
              }
            }
            return value;
          },
          2
        ),
        callback
      );
    };

    const recordsOutputPathDirectory = dirname(
      /** @type {OutputFileSystem} */ (this.outputFileSystem),
      /** @type {string} */ (this.recordsOutputPath)
    );
    if (!recordsOutputPathDirectory) {
      return writeFile();
    }
    mkdirp(
      /** @type {OutputFileSystem} */ (this.outputFileSystem),
      recordsOutputPathDirectory,
      (err) => {
        if (err) return callback(err);
        writeFile();
      }
    );
  }

  /**
   * @param {Callback<void>} callback signals when the call finishes
   * @returns {void}
   */
  readRecords(callback) {
    if (this.hooks.readRecords.isUsed()) {
      if (this.recordsInputPath) {
        asyncLib.parallel(
          [
            (cb) => this.hooks.readRecords.callAsync(cb),
            this._readRecords.bind(this),
          ],
          (err) => callback(err)
        );
      } else {
        this.records = {};
        this.hooks.readRecords.callAsync(callback);
      }
    } else if (this.recordsInputPath) {
      this._readRecords(callback);
    } else {
      this.records = {};
      callback();
    }
  }

  /**
   * @param {Callback<void>} callback signals when the call finishes
   * @returns {void}
   */
  _readRecords(callback) {
    if (!this.recordsInputPath) {
      this.records = {};
      return callback();
    }
    /** @type {InputFileSystem} */
    (this.inputFileSystem).stat(this.recordsInputPath, (err) => {
      // It doesn't exist
      // We can ignore this.
      if (err) return callback();

      /** @type {InputFileSystem} */
      (this.inputFileSystem).readFile(
        /** @type {string} */ (this.recordsInputPath),
        (err, content) => {
          if (err) return callback(err);

          try {
            this.records = parseJson(
              /** @type {Buffer} */ (content).toString("utf-8")
            );
          } catch (parseErr) {
            return callback(
              new Error(
                `Cannot parse records: ${/** @type {Error} */ (parseErr).message}`
              )
            );
          }

          return callback();
        }
      );
    });
  }

  /**
   * @param {Compilation} compilation the compilation
   * @param {string} compilerName the compiler's name
   * @param {number} compilerIndex the compiler's index
   * @param {OutputOptions=} outputOptions the output options
   * @param {WebpackPluginInstance[]=} plugins the plugins to apply
   * @returns {Compiler} a child compiler
   */
  createChildCompiler(
    compilation,
    compilerName,
    compilerIndex,
    outputOptions,
    plugins
  ) {
    const childCompiler = new Compiler(this.context, {
      ...this.options,
      output: {
        ...this.options.output,
        ...outputOptions,
      },
    });
    childCompiler.name = compilerName;
    childCompiler.outputPath = this.outputPath;
    childCompiler.inputFileSystem = this.inputFileSystem;
    childCompiler.outputFileSystem = null;
    childCompiler.resolverFactory = this.resolverFactory;
    childCompiler.modifiedFiles = this.modifiedFiles;
    childCompiler.removedFiles = this.removedFiles;
    childCompiler.fileTimestamps = this.fileTimestamps;
    childCompiler.contextTimestamps = this.contextTimestamps;
    childCompiler.fsStartTime = this.fsStartTime;
    childCompiler.cache = this.cache;
    childCompiler.compilerPath = `${this.compilerPath}${compilerName}|${compilerIndex}|`;
    childCompiler._backCompat = this._backCompat;

    const relativeCompilerName = makePathsRelative(
      this.context,
      compilerName,
      this.root
    );
    if (!this.records[relativeCompilerName]) {
      this.records[relativeCompilerName] = [];
    }
    if (this.records[relativeCompilerName][compilerIndex]) {
      childCompiler.records = this.records[relativeCompilerName][compilerIndex];
    } else {
      this.records[relativeCompilerName].push((childCompiler.records = {}));
    }

    childCompiler.parentCompilation = compilation;
    childCompiler.root = this.root;
    if (Array.isArray(plugins)) {
      for (const plugin of plugins) {
        if (plugin) {
          plugin.apply(childCompiler);
        }
      }
    }
    for (const name in this.hooks) {
      if (
        ![
          "make",
          "compile",
          "emit",
          "afterEmit",
          "invalid",
          "done",
          "thisCompilation",
        ].includes(name) &&
        childCompiler.hooks[/** @type {keyof Compiler["hooks"]} */ (name)]
      ) {
        childCompiler.hooks[
          /** @type {keyof Compiler["hooks"]} */
          (name)
        ].taps =
          this.hooks[
            /** @type {keyof Compiler["hooks"]} */
            (name)
          ].taps.slice();
      }
    }

    compilation.hooks.childCompiler.call(
      childCompiler,
      compilerName,
      compilerIndex
    );

    return childCompiler;
  }

  isChild() {
    return Boolean(this.parentCompilation);
  }

  /**
   * @param {CompilationParams} params the compilation parameters
   * @returns {Compilation} compilation
   */
  createCompilation(params) {
    this._cleanupLastCompilation();
    return (this._lastCompilation = new Compilation(this, params));
  }

  /**
   * @param {CompilationParams} params the compilation parameters
   * @returns {Compilation} the created compilation
   */
  newCompilation(params) {
    const compilation = this.createCompilation(params);
    compilation.name = this.name;
    compilation.records = this.records;
    this.hooks.thisCompilation.call(compilation, params);
    this.hooks.compilation.call(compilation, params);
    return compilation;
  }

  createNormalModuleFactory() {
    this._cleanupLastNormalModuleFactory();
    const normalModuleFactory = new NormalModuleFactory({
      context: this.options.context,
      fs: /** @type {InputFileSystem} */ (this.inputFileSystem),
      resolverFactory: this.resolverFactory,
      options: this.options.module,
      associatedObjectForCache: this.root,
      layers: this.options.experiments.layers,
    });
    this._lastNormalModuleFactory = normalModuleFactory;
    this.hooks.normalModuleFactory.call(normalModuleFactory);
    return normalModuleFactory;
  }

  createContextModuleFactory() {
    const contextModuleFactory = new ContextModuleFactory(this.resolverFactory);
    this.hooks.contextModuleFactory.call(contextModuleFactory);
    return contextModuleFactory;
  }

  newCompilationParams() {
    const params = {
      normalModuleFactory: this.createNormalModuleFactory(),
      contextModuleFactory: this.createContextModuleFactory(),
    };
    return params;
  }

  /**
   * @param {RunCallback<Compilation>} callback signals when the compilation finishes
   * @returns {void}
   */
  compile(callback) {
    const params = this.newCompilationParams();
    this.hooks.beforeCompile.callAsync(params, (err) => {
      if (err) return callback(err);

      this.hooks.compile.call(params);

      const compilation = this.newCompilation(params);

      const logger = compilation.getLogger("webpack.Compiler");

      logger.time("make hook");
      this.hooks.make.callAsync(compilation, (err) => {
        logger.timeEnd("make hook");
        if (err) return callback(err);

        logger.time("finish make hook");
        this.hooks.finishMake.callAsync(compilation, (err) => {
          logger.timeEnd("finish make hook");
          if (err) return callback(err);

          process.nextTick(() => {
            logger.time("finish compilation");
            compilation.finish((err) => {
              logger.timeEnd("finish compilation");
              if (err) return callback(err);

              logger.time("seal compilation");
              compilation.seal((err) => {
                logger.timeEnd("seal compilation");
                if (err) return callback(err);

                logger.time("afterCompile hook");
                this.hooks.afterCompile.callAsync(compilation, (err) => {
                  logger.timeEnd("afterCompile hook");
                  if (err) return callback(err);

                  return callback(null, compilation);
                });
              });
            });
          });
        });
      });
    });
  }

  /**
   * @param {RunCallback<void>} callback signals when the compiler closes
   * @returns {void}
   */
  close(callback) {
    if (this.watching) {
      // When there is still an active watching, close this first
      this.watching.close((err) => {
        this.close(callback);
      });
      return;
    }
    this.hooks.shutdown.callAsync((err) => {
      if (err) return callback(err);
      // Get rid of reference to last compilation to avoid leaking memory
      // We can't run this._cleanupLastCompilation() as the Stats to this compilation
      // might be still in use. We try to get rid of the reference to the cache instead.
      this._lastCompilation = undefined;
      this._lastNormalModuleFactory = undefined;
      this.cache.shutdown(callback);
    });
  }
}

module.exports = Compiler;
