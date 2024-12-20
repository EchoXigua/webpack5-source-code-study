const Stats = require("./Stats");

class Watching {
  /**
   * 初始化文件监视器，该监视器在 Webpack 构建过程中实时监视文件变化并触发构建更新
   * @param {Compiler} compiler the compiler
   * @param {WatchOptions} watchOptions options
   * @param {Callback<Stats>} handler 当检测到文件变动后调用，用于处理更新操作
   */
  constructor(compiler, watchOptions, handler) {
    /** 记录监视的开始时间 */
    this.startTime = null;
    /** 表示监视状态是否有效，true 为无效 */
    this.invalid = false;
    /** 监视器回调函数，用于处理文件更新 */
    this.handler = handler;
    /** 存储监视完成后的回调函数数组 */
    this.callbacks = [];
    /** 用于在关闭监视器时触发的回调函数 */
    this._closeCallbacks = undefined;

    /** 表示监视器是否已关闭 */
    this.closed = false;
    /** 表示监视器是否处于暂停状态 */
    this.suspended = false;
    /** 表示监视器是否被阻塞 */
    this.blocked = false;

    // 用于判断是否阻塞、处理文件更改事件和失效事件
    this._isBlocked = () => false;
    this._onChange = () => {};
    this._onInvalid = () => {};

    // 配置监视选项
    if (typeof watchOptions === "number") {
      // 如果配置项是数字，则作为 aggregateTimeout（即文件变化检测的延迟时间）
      this.watchOptions = {
        aggregateTimeout: watchOptions,
      };
    } else if (watchOptions && typeof watchOptions === "object") {
      // 如果是对象，浅拷贝一份
      this.watchOptions = { ...watchOptions };
    } else {
      // 不符合默认为空对象
      this.watchOptions = {};
    }

    // 延迟变更检测，默认为 20ms，表示在文件变更后等待一段时间再执行后续操作，避免频繁触发构建
    if (typeof this.watchOptions.aggregateTimeout !== "number") {
      this.watchOptions.aggregateTimeout = 20;
    }

    // 保存 compiler 实例
    this.compiler = compiler;
    /** 当前是否正在进行编译 */
    this.running = false;
    /** 是否是初始编译，用于标识第一次编译后的监视行为 */
    this._initial = true;
    /** 记是否已经报告无效状态 */
    this._invalidReported = true;
    /** 是否需要记录编译状态 */
    this._needRecords = true;
    /** 主监视器实例，用于实际监听文件的变动 */
    this.watcher = undefined;
    /** 用于保存暂停状态下的监视器实例 */
    this.pausedWatcher = undefined;
    /**
     * 收集被修改的文件，支持增量编译
     * @type {Set<string> | undefined}
     */
    this._collectedChangedFiles = undefined;
    /**
     * 收集被删除的文件，支持增量编译
     * @type {Set<string> | undefined}
     */
    this._collectedRemovedFiles = undefined;

    /** 绑定 _done 方法，用于标记编译完成 */
    this._done = this._done.bind(this);

    /**
     * 延迟到下一次事件循环后执行 _invalidate，从而触发一次初始编译
     */
    process.nextTick(() => {
      if (this._initial) this._invalidate();
    });
  }

  /**
   * 方法的主要作用是将新变动的文件（新增和删除的文件）合并到 _collectedChangedFiles 和 _collectedRemovedFiles 中
   * 合并机制确保了暂存的文件信息的完整性和准确性，以便在适当的时机对变动文件进行统一处理
   * @param {ReadonlySet<string>=} changedFiles 新增或更改的文件
   * @param {ReadonlySet<string>=} removedFiles 删除的文件
   */
  _mergeWithCollected(changedFiles, removedFiles) {
    // 没有变化的文件需要处理，直接返回
    if (!changedFiles) return;

    // 检查是否初始化
    if (!this._collectedChangedFiles) {
      // 没有初始化，说明是第一次收集文件变动，直接使用传入的文件进行初始化
      this._collectedChangedFiles = new Set(changedFiles);
      this._collectedRemovedFiles = new Set(removedFiles);
    } else {
      // 如果某文件先被标记为删除，又被标记为更改
      // 则该文件应当只存在于 _collectedChangedFiles 中，而不应存在于 _collectedRemovedFiles 中
      for (const file of changedFiles) {
        this._collectedChangedFiles.add(file);
        this._collectedRemovedFiles.delete(file);
      }

      // 如果某文件曾被标记为更改，后来又被标记为删除，最终的状态应当是删除
      for (const file of removedFiles) {
        this._collectedChangedFiles.delete(file);
        this._collectedRemovedFiles.add(file);
      }
    }
  }

  /**
   * 该方法用于处理文件监视的更新逻辑，管理文件和目录的变更集合，以及触发新的编译过程
   * @param {TimeInfoEntries=} fileTimeInfoEntries 文件的时间信息
   * @param {TimeInfoEntries=} contextTimeInfoEntries 目录的时间信息
   * @param {ReadonlySet<string>=} changedFiles 文件变更的集合
   * @param {ReadonlySet<string>=} removedFiles 文件删除的集合
   * @returns {void}
   */
  _go(fileTimeInfoEntries, contextTimeInfoEntries, changedFiles, removedFiles) {
    // 标记不是首次运行
    this._initial = false;
    // 初始化开始时间
    if (this.startTime === null) this.startTime = Date.now();

    // 编译正在运行
    this.running = true;

    // 存在 watcher 实例
    if (this.watcher) {
      // 暂存 watcher 实例
      this.pausedWatcher = this.watcher;
      // 记录暂停的时间
      this.lastWatcherStartTime = Date.now();
      // 暂停当前的 watcher
      this.watcher.pause();
      // 将当前实例置空
      this.watcher = null;
    } else if (!this.lastWatcherStartTime) {
      // 没有 lastWatcherStartTime（表示首次编译），则初始化该时间戳
      this.lastWatcherStartTime = Date.now();
    }
    // 记录文件系统的编译开始时间戳
    this.compiler.fsStartTime = Date.now();

    if (
      changedFiles &&
      removedFiles &&
      fileTimeInfoEntries &&
      contextTimeInfoEntries
    ) {
      // 传入了文件变更信息
      this._mergeWithCollected(changedFiles, removedFiles);
      this.compiler.fileTimestamps = fileTimeInfoEntries;
      this.compiler.contextTimestamps = contextTimeInfoEntries;
    } else if (this.pausedWatcher) {
      // 没有变更文件信息，则检查 pausedWatcher 是否存在

      // 存在获取更新的文件和目录信息
      if (this.pausedWatcher.getInfo) {
        // 更新至 compiler
        const {
          changes,
          removals,
          fileTimeInfoEntries,
          contextTimeInfoEntries,
        } = this.pausedWatcher.getInfo();
        this._mergeWithCollected(changes, removals);
        this.compiler.fileTimestamps = fileTimeInfoEntries;
        this.compiler.contextTimestamps = contextTimeInfoEntries;
      } else {
        // 获取文件变更集合，更新时间戳信息
        this._mergeWithCollected(
          this.pausedWatcher.getAggregatedChanges &&
            this.pausedWatcher.getAggregatedChanges(),
          this.pausedWatcher.getAggregatedRemovals &&
            this.pausedWatcher.getAggregatedRemovals()
        );
        this.compiler.fileTimestamps =
          this.pausedWatcher.getFileTimeInfoEntries();
        this.compiler.contextTimestamps =
          this.pausedWatcher.getContextTimeInfoEntries();
      }
    }

    /**
     * 将内部收集到的变更和删除文件集合赋值给 compiler 实例
     * 将收集的变更和删除信息清空，为下一次变更收集做好准备
     */
    this.compiler.modifiedFiles = this._collectedChangedFiles;
    this._collectedChangedFiles = undefined;
    this.compiler.removedFiles = this._collectedRemovedFiles;
    this._collectedRemovedFiles = undefined;

    /**
     * 整个编译过程的内部函数。它通过一系列检查、回调和钩子确保每次编译在正确的状态下执行
     * @returns
     */
    const run = () => {
      // 当前编译器处理空闲状态
      if (this.compiler.idle) {
        // 通过 endIdle 结束缓存的空闲状态
        return this.compiler.cache.endIdle((err) => {
          // 结束空闲状态后，会继续执行 run，确保缓存激活后再继续编译
          if (err) return this._done(err);
          this.compiler.idle = false;
          run();
        });
      }

      // 编译过程中是否需要访问持久化记录，通常在增量编译时需要
      if (this._needRecords) {
        // 读取相关记录，读取成功后再次调用 run 继续编译
        return this.compiler.readRecords((err) => {
          if (err) return this._done(err);

          this._needRecords = false;
          run();
        });
      }

      // 编译流程启动 ------------------------------------------>>>>>>>

      // 重置标记，表示当前编译为有效状态
      this.invalid = false;
      this._invalidReported = false;

      // 触发 watchRun 钩子，允许插件在编译开始前做一些处理
      this.compiler.hooks.watchRun.callAsync(this.compiler, (err) => {
        if (err) return this._done(err);
        /**
         * 在编译完成后被调用，处理编译结果并触发后续流程
         * @param {Error | null} err error
         * @param {Compilation=} _compilation compilation
         * @returns {void}
         */
        const onCompiled = (err, _compilation) => {
          if (err) return this._done(err, _compilation);

          const compilation = _compilation;

          // 若编译过程中有文件变更导致 invalid 置为 true，则终止当前编译，避免重复工作
          if (this.invalid) return this._done(null, compilation);

          // 调用 shouldEmit，决定是否应该输出编译结果
          // 若返回 false，则不会继续输出阶段，直接调用 _done 结束当前编译过程
          if (this.compiler.hooks.shouldEmit.call(compilation) === false) {
            return this._done(null, compilation);
          }

          // 在下一次事件循环中去处理回调函数
          process.nextTick(() => {
            const logger = compilation.getLogger("webpack.Compiler");
            logger.time("emitAssets");

            // 触发 emitAssets 钩子，输出编译的资源文件
            this.compiler.emitAssets(compilation, (err) => {
              logger.timeEnd("emitAssets");
              if (err) return this._done(err, compilation);
              // 在资源输出后再检查 invalid，若为 true，终止当前编译
              if (this.invalid) return this._done(null, compilation);

              logger.time("emitRecords");
              // 触发 emitRecords 钩子，记录输出信息
              this.compiler.emitRecords((err) => {
                logger.timeEnd("emitRecords");
                if (err) return this._done(err, compilation);

                // 检查是否需要额外编译
                if (compilation.hooks.needAdditionalPass.call()) {
                  compilation.needAdditionalPass = true;

                  // 若需要额外编译，更新 startTime 和 endTime
                  compilation.startTime = this.startTime;
                  compilation.endTime = Date.now();

                  logger.time("done hook");
                  const stats = new Stats(compilation);
                  // 触发 done 钩子：调用 done 钩子通知编译已完成
                  this.compiler.hooks.done.callAsync(stats, (err) => {
                    logger.timeEnd("done hook");
                    if (err) return this._done(err, compilation);

                    // 触发 additionalPass 钩子 重新调用 compile 进行额外的编译
                    this.compiler.hooks.additionalPass.callAsync((err) => {
                      if (err) return this._done(err, compilation);
                      this.compiler.compile(onCompiled);
                    });
                  });
                  return;
                }
                return this._done(null, compilation);
              });
            });
          });
        };

        // 触发编译
        this.compiler.compile(onCompiled);
      });
    };

    run();
  }

  /**
   * 这个函数是 Webpack 源码中负责处理编译任务完成后的回调函数，它会在构建流程结束时执行，
   * 以处理编译结果、调用插件钩子并释放相关资源
   * @param {(Error | null)=} err an optional error
   * @param {Compilation=} compilation the compilation
   * @returns {void}
   */
  _done(err, compilation) {
    // 标记当前 Webpack 的编译任务不再运行，意味着可以准备下一次构建任务
    this.running = false;

    const logger = compilation && compilation.getLogger("webpack.Watching");

    /**
     * 存放当前编译任务的统计信息
     */
    let stats;

    /**
     * 内部错误处理函数，用于处理构建过程中的错误
     * @param {Error} err error
     * @param {Callback<void>[]=} cbs callbacks
     */
    const handleError = (err, cbs) => {
      //  调用 failed 钩子，通知插件有错误发生
      this.compiler.hooks.failed.call(err);
      // 将缓存状态标记为空闲，以便准备下一次使用
      this.compiler.cache.beginIdle();
      // 标记当前为空闲
      this.compiler.idle = true;
      this.handler(err, stats);

      if (!cbs) {
        cbs = this.callbacks;
        this.callbacks = [];
      }

      // 每个回调函数都将被调用，通知所有监听者错误状态
      for (const cb of cbs) cb(err);
    };

    // 检查是否需要重新构建
    if (
      // 检查当前构建是否被标记为无效
      this.invalid &&
      // 没有暂停
      !this.suspended &&
      // 没有阻塞
      !this.blocked &&
      !(this._isBlocked() && (this.blocked = true))
    ) {
      if (compilation) {
        // 将本次构建的依赖信息缓存起来
        logger.time("storeBuildDependencies");
        this.compiler.cache.storeBuildDependencies(
          compilation.buildDependencies,
          (err) => {
            logger.timeEnd("storeBuildDependencies");
            if (err) return handleError(err);
            this._go();
          }
        );
      } else {
        // 执行下一个构建流程
        this._go();
      }
      return;
    }

    // 记录编译的开始和结束时间
    if (compilation) {
      // 将本次任务的 startTime 和 endTime 记录在 compilation 对象
      compilation.startTime = /** @type {number} */ (this.startTime);
      compilation.endTime = Date.now();
      stats = new Stats(compilation);
    }
    // 表示当前构建已完成
    this.startTime = null;
    // 若有错误发生 调用错误处理函数
    if (err) return handleError(err);

    // 保存一份回调函数数组
    const cbs = this.callbacks;
    this.callbacks = [];
    logger.time("done hook");
    // 触发 done 钩子，通知所有插件当前编译已完成
    this.compiler.hooks.done.callAsync(stats, (err) => {
      logger.timeEnd("done hook");
      if (err) return handleError(err, cbs);
      this.handler(null, stats);

      // 缓存构建的依赖项，以便 Webpack 可以更高效地进行增量编译
      logger.time("storeBuildDependencies");
      this.compiler.cache.storeBuildDependencies(
        compilation.buildDependencies,
        (err) => {
          logger.timeEnd("storeBuildDependencies");
          if (err) return handleError(err, cbs);
          // 存储过程中无错误发生，则将编译器状态标记为空闲
          logger.time("beginIdle");
          this.compiler.cache.beginIdle();
          this.compiler.idle = true;
          logger.timeEnd("beginIdle");

          // 将编译器恢复到文件监听模式
          process.nextTick(() => {
            if (!this.closed) {
              // 监听所有构建依赖项
              this.watch(
                compilation.fileDependencies,
                compilation.contextDependencies,
                compilation.missingDependencies
              );
            }
          });

          // 遍历并调用每个回调函数，通知构建完成
          for (const cb of cbs) cb(null);
          // 调用 afterDone 钩子，通知插件构建过程已完全结束
          this.compiler.hooks.afterDone.call(stats);
        }
      );
    });
  }

  /**
   * 这个方法的主要作用是在 Webpack 的监听模式下启动文件监控，
   * 以便实时捕获文件的改动，并触发对应的编译流程
   * @returns {void}
   */
  watch(files, dirs, missing) {
    // 确保当前没有暂停的监听器
    this.pausedWatcher = null;
    this.watcher =
      /**
       * 开始监听指定的文件和目录
       * @type {WatchFileSystem} */
      (this.compiler.watchFileSystem).watch(
        files, // 当前编译过程中涉及的文件列表
        dirs, // 需要监控的目录
        missing, // 缺失的依赖项列表
        /** @type {number} */ (this.lastWatcherStartTime), // 上次开始监听的时间戳
        this.watchOptions, // 监听的配置项（如延迟等参数）
        (
          err,
          fileTimeInfoEntries,
          contextTimeInfoEntries,
          changedFiles,
          removedFiles
        ) => {
          // 文件变化后的回调函数，用于处理文件改动事件
          if (err) {
            this.compiler.modifiedFiles = undefined;
            this.compiler.removedFiles = undefined;
            this.compiler.fileTimestamps = undefined;
            this.compiler.contextTimestamps = undefined;
            this.compiler.fsStartTime = undefined;
            return this.handler(err);
          }

          // 将文件时间信息、改动文件和删除文件的信息传递给下一步的编译流程，
          // 使编译器意识到文件发生了改动
          this._invalidate(
            fileTimeInfoEntries,
            contextTimeInfoEntries,
            changedFiles,
            removedFiles
          );

          // 通知编译器文件发生变化，以触发重新编译
          this._onChange();
        },
        (fileName, changeTime) => {
          // 文件失效时的回调函数
          if (!this._invalidReported) {
            this._invalidReported = true;
            //  触发 invalid 钩子通知插件当前文件失效
            this.compiler.hooks.invalid.call(fileName, changeTime);
          }
          this._onInvalid();
        }
      );
  }

  /**
   * @param {Callback<void>=} callback signals when the build has completed again
   * @returns {void}
   */
  invalidate(callback) {
    if (callback) {
      this.callbacks.push(callback);
    }
    if (!this._invalidReported) {
      this._invalidReported = true;
      this.compiler.hooks.invalid.call(null, Date.now());
    }
    this._onChange();
    this._invalidate();
  }

  /**
   * 用于处理文件或上下文信息发生变动时的逻辑
   * 根据监视器的当前状态，决定是否立即处理这些变动，或者将变动信息暂存等待下次处理
   * @param {TimeInfoEntries=} fileTimeInfoEntries 文件的时间信息
   * @param {TimeInfoEntries=} contextTimeInfoEntries 上下文的时间信息
   * @param {ReadonlySet<string>=} changedFiles 新增的文件列表
   * @param {ReadonlySet<string>=} removedFiles 被删除的文件列表
   * @returns {void}
   */
  _invalidate(
    fileTimeInfoEntries,
    contextTimeInfoEntries,
    changedFiles,
    removedFiles
  ) {
    // 如果监视器被暂停或阻塞，将文件变动合并到内部的一个暂存集合中
    // 这种方式允许记录变动信息，但暂时不触发文件处理操作，等到监视器恢复时再统一处理
    if (this.suspended || (this._isBlocked() && (this.blocked = true))) {
      this._mergeWithCollected(changedFiles, removedFiles);
      return;
    }

    // 如果监视器正在运行（即一个构建过程正在进行中）
    if (this.running) {
      // 存储变动信息
      this._mergeWithCollected(changedFiles, removedFiles);
      // 表明当前构建过程有变动，需要重新构建
      this.invalid = true;
    } else {
      this._go(
        fileTimeInfoEntries,
        contextTimeInfoEntries,
        changedFiles,
        removedFiles
      );
    }
  }
}

module.exports = Watching;
