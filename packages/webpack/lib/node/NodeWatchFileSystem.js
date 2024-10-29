/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const util = require("util");
const Watchpack = require("watchpack");

/**
 * Webpack 用于 Node.js 环境下文件监视的实现，
 * 通过 watch 方法来管理文件和目录的监视，实现增量构建
 * 主要通过 Watchpack 进行文件监视工作，并对 Webpack 文件系统进行缓存和事件处理
 */
class NodeWatchFileSystem {
  /**
   * @param inputFileSystem 传入的文件系统实例，用于访问和操作文件
   */
  constructor(inputFileSystem) {
    this.inputFileSystem = inputFileSystem;
    this.watcherOptions = {
      // 设为 0，表示监视时无聚合延迟
      aggregateTimeout: 0,
    };

    // 根据监视配置项初始化监视器，用于实际的文件监视和变更管理
    this.watcher = new Watchpack(this.watcherOptions);
  }

  /**
   * 监视文件和目录变化的核心方法
   *
   * @param {*} files 监视的文件
   * @param {*} directories 目录
   * @param {*} missing 缺失文件
   * @param {*} startTime
   * @param {*} options
   * @param {*} callback 回调
   * @param {*} callbackUndelayed 未延迟触发的回调
   * @returns
   */
  watch(
    files,
    directories,
    missing,
    startTime,
    options,
    callback,
    callbackUndelayed
  ) {
    // 参数验证，确保 files、directories、missing 都是可迭代对象
    // callback 和 callbackUndelayed 是函数，startTime 是数字，options 是对象
    if (!files || typeof files[Symbol.iterator] !== "function") {
      throw new Error("Invalid arguments: 'files'");
    }
    if (!directories || typeof directories[Symbol.iterator] !== "function") {
      throw new Error("Invalid arguments: 'directories'");
    }
    if (!missing || typeof missing[Symbol.iterator] !== "function") {
      throw new Error("Invalid arguments: 'missing'");
    }
    if (typeof callback !== "function") {
      throw new Error("Invalid arguments: 'callback'");
    }
    if (typeof startTime !== "number" && startTime) {
      throw new Error("Invalid arguments: 'startTime'");
    }
    if (typeof options !== "object") {
      throw new Error("Invalid arguments: 'options'");
    }
    if (typeof callbackUndelayed !== "function" && callbackUndelayed) {
      throw new Error("Invalid arguments: 'callbackUndelayed'");
    }

    // 保存旧的 Watchpack 实例，以便稍后关闭并释放资源
    const oldWatcher = this.watcher;

    // 用新的 options 创建 Watchpack 监视器
    this.watcher = new Watchpack(options);

    // 设置未延迟触发的回调
    if (callbackUndelayed) {
      this.watcher.once("change", callbackUndelayed);
    }

    const fetchTimeInfo = () => {
      // 分别存储文件和目录的变更时间信息
      const fileTimeInfoEntries = new Map();
      const contextTimeInfoEntries = new Map();

      if (this.watcher) {
        // 从 Watchpack 中收集最新的变更时间信息
        this.watcher.collectTimeInfoEntries(
          fileTimeInfoEntries,
          contextTimeInfoEntries
        );
      }
      return { fileTimeInfoEntries, contextTimeInfoEntries };
    };

    // 监听 Watchpack 实例的 aggregated 事件，这个事件会在文件的变更和删除操作被聚合后触发
    this.watcher.once(
      "aggregated",
      /**
       * @param {Set<string>} changes changes
       * @param {Set<string>} removals removals
       */
      (changes, removals) => {
        // 暂停发出事件（避免在超时时清除聚合的更改和删除） 避免在短时间内多次触发事件，影响性能
        this.watcher.pause();

        const fs = this.inputFileSystem;
        if (fs && fs.purge) {
          // 遍历 changes 和 removals 集合，将变更和删除的文件从缓存中清除

          // purge 函数用于删除缓存中的数据，从而避免 Webpack 使用过时的文件信息，确保编译的文件是最新的
          for (const item of changes) {
            fs.purge(item);
          }
          for (const item of removals) {
            fs.purge(item);
          }
        }

        // 获取文件和上下文的时间信息，帮助 Webpack 判定文件或目录是否需要重新编译
        const { fileTimeInfoEntries, contextTimeInfoEntries } = fetchTimeInfo();

        // 触发回调
        callback(
          null,
          fileTimeInfoEntries,
          contextTimeInfoEntries,
          changes,
          removals
        );
      }
    );

    // 调用 Watchpack 的 watch 方法并开始监听传入的文件、目录和缺失文件
    this.watcher.watch({ files, directories, missing, startTime });

    // 存在旧的 watcher，则调用其 close 方法停止旧的监听，避免资源浪费
    if (oldWatcher) {
      oldWatcher.close();
    }

    return {
      /** 终止当前监听器，释放 watcher 资源 */
      close: () => {
        if (this.watcher) {
          this.watcher.close();
          this.watcher = null;
        }
      },
      /** 暂停当前监听器，适用于希望短时间内不再接收文件变更事件的场景 */
      pause: () => {
        if (this.watcher) {
          this.watcher.pause();
        }
      },

      /**
       * 返回聚合的删除文件列表
       * 该方法使用 util.deprecate 标记为已废弃，推荐使用更高效的 getInfo 方法替代
       * @deprecated
       */
      getAggregatedRemovals: util.deprecate(
        () => {
          const items = this.watcher && this.watcher.aggregatedRemovals;
          const fs = this.inputFileSystem;
          if (items && fs && fs.purge) {
            for (const item of items) {
              // 清理缓存中的删除文件
              fs.purge(item);
            }
          }
          return items;
        },
        "Watcher.getAggregatedRemovals is deprecated in favor of Watcher.getInfo since that's more performant.",
        "DEP_WEBPACK_WATCHER_GET_AGGREGATED_REMOVALS"
      ),
      /**
       * 返回聚合的文件变更列表
       * 该方法标记为已废弃，推荐使用 getInfo 方法
       * @deprecated
       */
      getAggregatedChanges: util.deprecate(
        () => {
          const items = this.watcher && this.watcher.aggregatedChanges;
          const fs = this.inputFileSystem;
          if (items && fs && fs.purge) {
            for (const item of items) {
              fs.purge(item);
            }
          }
          return items;
        },
        "Watcher.getAggregatedChanges is deprecated in favor of Watcher.getInfo since that's more performant.",
        "DEP_WEBPACK_WATCHER_GET_AGGREGATED_CHANGES"
      ),
      /** 返回文件的时间信息 */
      getFileTimeInfoEntries: util.deprecate(
        () => fetchTimeInfo().fileTimeInfoEntries,
        "Watcher.getFileTimeInfoEntries is deprecated in favor of Watcher.getInfo since that's more performant.",
        "DEP_WEBPACK_WATCHER_FILE_TIME_INFO_ENTRIES"
      ),
      /** 返回上下文的时间信息 */
      getContextTimeInfoEntries: util.deprecate(
        () => fetchTimeInfo().contextTimeInfoEntries,
        "Watcher.getContextTimeInfoEntries is deprecated in favor of Watcher.getInfo since that's more performant.",
        "DEP_WEBPACK_WATCHER_CONTEXT_TIME_INFO_ENTRIES"
      ),

      /**
       * 用于一次性返回所有文件变更信息（变更、删除、文件时间和上下文时间信息），提高调用性能
       * @returns
       */
      getInfo: () => {
        const removals = this.watcher && this.watcher.aggregatedRemovals;
        const changes = this.watcher && this.watcher.aggregatedChanges;
        const fs = this.inputFileSystem;
        if (fs && fs.purge) {
          if (removals) {
            for (const item of removals) {
              fs.purge(item);
            }
          }
          if (changes) {
            for (const item of changes) {
              fs.purge(item);
            }
          }
        }
        const { fileTimeInfoEntries, contextTimeInfoEntries } = fetchTimeInfo();
        return {
          changes,
          removals,
          fileTimeInfoEntries,
          contextTimeInfoEntries,
        };
      },
    };
  }
}

module.exports = NodeWatchFileSystem;
