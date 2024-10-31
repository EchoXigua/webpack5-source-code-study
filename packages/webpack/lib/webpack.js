"use strict";

const util = require("util");
const webpackOptionsSchemaCheck = require("../schemas/WebpackOptions.check.js");
const webpackOptionsSchema = require("../schemas/WebpackOptions.json");

const Compiler = require("./Compiler");
// const MultiCompiler = require("./MultiCompiler");
const WebpackOptionsApply = require("./WebpackOptionsApply");
const {
  applyWebpackOptionsDefaults,
  applyWebpackOptionsBaseDefaults,
} = require("./config/defaults");
const { getNormalizedWebpackOptions } = require("./config/normalization");
const NodeEnvironmentPlugin = require("./node/NodeEnvironmentPlugin");

const memoize = require("./util/memoize");
const getValidateSchema = memoize(() => require("./validateSchema"));

/**
 * 用于创建 MultiCompiler 实例，以支持多编译器配置
 * 这通常在 Webpack 需要同时编译多个配置时使用（例如多入口应用）
 *
 * @param {*} childOptions 包含多个编译器配置的数组，通常在用户传入多配置时会被传递到此函数
 * @param {*} options 配置 MultiCompiler 的选项，包含需要共享的通用配置
 * @returns
 */
const createMultiCompiler = (childOptions, options) => {
  // 创建多个 Compiler 实例数组，index 作为 compilerIndex 传递给 createCompiler，用于多编译器配置的区分
  const compilers = childOptions.map((options, index) =>
    createCompiler(options, index)
  );

  /**
   * MultiCompiler 是 Webpack 提供的用于管理多个编译器实例的类
   * 允许 Webpack 同时编译多个配置，并处理多配置项目的依赖关系、同步等需求
   */
  const compiler = new MultiCompiler(compilers, options);

  // 设置子编译器的依赖关系
  for (const childCompiler of compilers) {
    // dependencies 是一个特殊配置，用于指定某个子编译器是否依赖于其他编译器的输出
    if (childCompiler.options.dependencies) {
      // 将依赖关系添加到 MultiCompiler 实例中，确保多编译器的构建顺序符合依赖关系
      compiler.setDependencies(
        childCompiler,
        childCompiler.options.dependencies
      );
    }
  }

  // 返回 MultiCompiler 实例
  return compiler;
};

/**
 * 这个函数是 webpack 用于创建单个编译器实例的核心方法之一
 * 将经过规范化的 Webpack 配置 options 应用于一个新的 Compiler 实例，并完成插件的加载和必要的环境配置
 *
 * @param {*} rawOptions 未规范化的 Webpack 配置对象
 * @param {*} compilerIndex 用于多编译器环境中表示编译器的索引，在某些情况下用于不同编译器的配置区分
 * @returns
 */
const createCompiler = (rawOptions, compilerIndex) => {
  // 将用户提供的 rawOptions 规范化
  const options = getNormalizedWebpackOptions(rawOptions);

  // 给 options 中的核心字段填充默认值，这些默认值通常包括路径、文件命名规则等基础配置
  applyWebpackOptionsBaseDefaults(options);

  /**
   * 创建编译器实例
   * - options.context 作为项目的根目录，用于确定资源路径的相对位置
   * - options 传递给 Compiler 实例，提供了配置所需的所有细节
   */
  const compiler = new Compiler(options.context, options);

  // 配置 Webpack 的环境，使其能够在 Node.js 环境下工作
  new NodeEnvironmentPlugin({
    infrastructureLogging: options.infrastructureLogging,
  }).apply(compiler);

  // 加载并应用插件
  if (Array.isArray(options.plugins)) {
    // 遍历插件数组，依次将每个插件应用到 编译器实例上
    for (const plugin of options.plugins) {
      if (typeof plugin === "function") {
        /** @type {WebpackPluginFunction} */
        (plugin).call(compiler, compiler);
      } else if (plugin) {
        plugin.apply(compiler);
      }
    }
  }

  // 基于编译器的索引进一步调整配置，这个配置处理逻辑通常在多编译器的场景下更有用
  // 这里给 options 中添加默认配置项（如果用户没填写会用默认值覆盖，否则使用用户提供的）
  const resolvedDefaultOptions = applyWebpackOptionsDefaults(
    options,
    compilerIndex
  );

  // 返回的配置包含 平台信息则应用到编译器实例上
  if (resolvedDefaultOptions.platform) {
    compiler.platform = resolvedDefaultOptions.platform;
  }

  // 触发编译器 environment 和 afterEnvironment 钩子
  // 通知编译器即将进入编译的初始化阶段，并允许插件在此时执行特定的操作
  compiler.hooks.environment.call();
  compiler.hooks.afterEnvironment.call();

  // 将 options 的配置项应用到 compiler 上，进一步设置和调整 compiler 的运行环境和行为
  new WebpackOptionsApply().process(options, compiler);

  // 调用 initialize 钩子，标志着编译器初始化完成，可以开始处理编译任务
  compiler.hooks.initialize.call();
  // 返回初始化完成的编译器实例
  return compiler;
};

const asArray = (options) =>
  Array.isArray(options) ? Array.from(options) : [options];

/**
 * 这个函数是 Webpack 的核心构建接口，支持单编译器和多编译器的功能
 * @param {*} options 单个 Webpack 配置对象，或者是一个数组（代表多个配置对象和多编译器选项）
 * @param {*} callback 如果提供了，将在构建完成后被调用
 */
const webpack = (options, callback) => {
  /** 用于生成 Webpack 编译器或多编译器的实例 */
  const create = () => {
    // 将 options 转为数组，验证所有选项是否符合预定义的架构（schema）
    if (!asArray(options).every(webpackOptionsSchemaCheck)) {
      // 如果不符合，则调用 getValidateSchema() 验证实际的架构，并发出警告，提示存在潜在的性能问题
      getValidateSchema()(webpackOptionsSchema, options);
      util.deprecate(
        () => {},
        "webpack bug: Pre-compiled schema reports error while real schema is happy. This has performance drawbacks.",
        "DEP_WEBPACK_PRE_COMPILED_SCHEMA_INVALID"
      )();
    }

    /** 存储编译器实例 */
    let compiler;
    /** 是否启用监听模式 */
    let watch = false;
    /** 存储监听选项 */
    let watchOptions;

    // 处理多个
    if (Array.isArray(options)) {
      // 创建多编译器实例
      compiler = createMultiCompiler(options, options);

      // 检查是否有任何选项启用了监听模式 (watch)，以及收集所有的 watchOptions
      watch = options.some((options) => options.watch);
      watchOptions = options.map((options) => options.watchOptions || {});
    } else {
      // 处理单个
      const webpackOptions = options;
      // 创建单个编译器实例
      compiler = createCompiler(webpackOptions);
      watch = webpackOptions.watch;
      watchOptions = webpackOptions.watchOptions || {};
    }
    return { compiler, watch, watchOptions };
  };

  // 执行编译或监听
  if (callback) {
    // 如果提供了 callback，则尝试创建编译器
    try {
      const { compiler, watch, watchOptions } = create();
      // 并根据 watch 的值决定执行 compiler.watch（监听模式）或 compiler.run（正常运行模式）
      if (watch) {
        // 编译器将开始监听文件更改，并在更改时调用 callback
        compiler.watch(watchOptions, callback);
      } else {
        compiler.run((err, stats) => {
          // 在完成后关闭编译器，最后调用 callback 并传递任何错误或统计信息
          compiler.close((err2) => {
            callback(err || err2, stats);
          });
        });
      }

      // 返回编译器实例
      return compiler;
    } catch (err) {
      process.nextTick(() => callback(err));
      return null;
    }
  } else {
    // 未提供回调
    const { compiler, watch } = create();

    // 在 watch 模式下发出弃用警告，说明在使用 watch 选项时需要提供 callback
    if (watch) {
      util.deprecate(
        () => {},
        "A 'callback' argument needs to be provided to the 'webpack(options, callback)' function when the 'watch' option is set. There is no way to handle the 'watch' option without a callback.",
        "DEP_WEBPACK_WATCH_WITHOUT_CALLBACK"
      )();
    }
    return compiler;
  }
};

module.exports = webpack;
