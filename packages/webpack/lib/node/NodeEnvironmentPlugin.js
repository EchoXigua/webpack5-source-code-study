/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const CachedInputFileSystem = require("enhanced-resolve").CachedInputFileSystem;
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
