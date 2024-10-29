/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

/**
 * Enhanced Resolve 是 Webpack 团队开发的路径解析库，用于在模块打包和构建过程中找到需要的模块文件
 * 其核心功能是将模块路径解析成真实文件路径，尤其在复杂的模块引用中，它提供了更加灵活和高效的解析方式
 *
 * - 模块路径解析：根据模块路径和配置规则找到文件的位置，支持 Webpack 的 alias 和 extensions 等配置
 * - 文件类型优先级：支持多种文件后缀的优先级配置，例如 Webpack 可以自动识别 .js、.json、.jsx 等文件后缀
 * - 支持模块别名：支持通过 resolve.alias 配置模块别名，方便代码书写，且增强代码的可读性和维护性
 * - 自定义解析插件：提供插件机制，可以定义自定义规则，比如根据环境条件加载不同的文件
 */
const CachedInputFileSystem = require("enhanced-resolve").CachedInputFileSystem;

/**
 * graceful-fs 是 Node.js 标准库 fs 的增强版，专门用于处理文件系统操作中的一些常见问题
 * 原生 fs 库在处理大量并发文件操作时可能会出现性能问题，而 graceful-fs 提供了一些增强特性，
 * 特别是在处理文件锁、网络文件系统、以及内存控制方面的改进
 *
 * - 处理文件描述符过多问题：在高并发场景中，标准的 fs 库可能会因文件描述符耗尽而报错。
 * graceful-fs 通过自动重试机制解决了这一问题。
 * - 兼容性：与原生 fs 接口完全兼容，可以无缝替换 Node.js 中的 fs
 * - 缓解内存泄漏问题：通过对文件流的改进，减少内存泄漏的风险，适用于需要频繁读写文件的场景
 * - 处理锁定文件：解决文件被锁定或正在被使用时的报错问题
 */
const fs = require("graceful-fs");
const createConsoleLogger = require("../logging/createConsoleLogger");
const NodeWatchFileSystem = require("./NodeWatchFileSystem");
const nodeConsole = require("./nodeConsole");

/**
 * webpack 插件，配置编译器在 Node.js 环境中运行所需的文件系统和日志工具
 */
class NodeEnvironmentPlugin {
  /**
   * @param {object} options 插件的配置对象
   * @param {InfrastructureLogging} options.infrastructureLogging 基础设施日志配置
   */
  constructor(options) {
    this.options = options;
  }

  /**
   * 用于将该插件应用到传入的 compiler（编译器实例）上
   * @param {Compiler} compiler 编译器实例
   * @returns {void}
   */
  apply(compiler) {
    // 提取基础设施日志记录配置
    const { infrastructureLogging } = this.options;

    // 给编译器实例添加基础日志记录器
    compiler.infrastructureLogger = createConsoleLogger({
      level: infrastructureLogging.level || "info",
      debug: infrastructureLogging.debug || false,
      console:
        infrastructureLogging.console ||
        nodeConsole({
          colors: infrastructureLogging.colors, // 是否在日志中启用颜色输出
          appendOnly: infrastructureLogging.appendOnly, // 是否以附加的方式写入日志
          stream: infrastructureLogging.stream, // 定义日志写入的流对象
        }),
    });

    // 创建一个缓存文件系统实例，设置缓存过期时间为 60000 毫秒（60 秒），提供文件读取缓存功能，减少文件系统调用次数
    compiler.inputFileSystem = new CachedInputFileSystem(fs, 60000);

    const inputFileSystem = compiler.inputFileSystem;

    // 输出文件系统和 中间文件系统指向 nodejs中的 fs（经graceful-fs封装）
    compiler.outputFileSystem = fs;
    compiler.intermediateFileSystem = fs;

    // 创建文件监视系统，允许在文件更改时触发相应的回调
    compiler.watchFileSystem = new NodeWatchFileSystem(inputFileSystem);

    // beforeRun 钩子：在 Webpack 编译流程启动前触发，通过 tap 方法绑定回调函数
    compiler.hooks.beforeRun.tap("NodeEnvironmentPlugin", (compiler) => {
      if (
        compiler.inputFileSystem === inputFileSystem &&
        inputFileSystem.purge
      ) {
        // 清除 inputFileSystem 中的文件缓存，确保每次运行编译器时都能加载最新的文件
        // fsStartTime 保存文件系统清除操作的开始时间，用于后续的时间记录
        compiler.fsStartTime = Date.now();
        inputFileSystem.purge();
      }
    });
  }
}

module.exports = NodeEnvironmentPlugin;
