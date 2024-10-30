/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

/**
 * AsyncSeriesBailHook：异步执行，当某一处理函数返回非 undefined 值时，后续的钩子停止执行，类似 短路 功能
 * AsyncParallelHook：并行执行的异步钩子，所有钩子并行执行完后继续下一个操作
 * SyncHook：同步执行的钩子，无返回值，不会中断执行
 */
const { AsyncParallelHook, AsyncSeriesBailHook, SyncHook } = require("tapable");
const {
  makeWebpackError,
  makeWebpackErrorCallback,
} = require("./HookWebpackError");

/**
 * 函数的目的是简化多个异步操作的回调处理，允许我们设置一个计数器，
 * 只有在所有相关的异步操作都完成后，才会调用一次 callback
 * 如果任何一个操作出错，它会立即触发 callback 并停止后续的调用
 *
 * 这种模式特别适合处理并行异步任务，确保只有在所有处理程序都完成后，才会继续处理结果，或在遇到错误时及时返回
 *
 * @param {number} times times
 * @param {function(Error=): void} callback callback
 * @returns {function(Error=): void} callback
 */
const needCalls = (times, callback) => (err) => {
  // 如果 times 的值变为 0，说明已经完成了所需的调用次数，此时调用 callback(err)，将 err 作为参数传递给它
  if (--times === 0) {
    return callback(err);
  }
  // 如果存在错误且 times 大于0 示在某个调用中出现了错误
  if (err && times > 0) {
    // 为了确保后续的调用不会再触发 callback，将 times 设置为 0
    times = 0;
    return callback(err);
  }
};

/**
 * 通过各种生命周期钩子（hooks）来管理缓存的获取、存储、依赖管理、空闲状态和关闭等操作
 * 基于 tapable 提供的钩子机制，使外部插件或模块可以通过监听这些钩子来参与缓存逻辑
 */
class Cache {
  constructor() {
    // 定义了一些钩子函数
    this.hooks = {
      /** 获取缓存值时触发 */
      get: new AsyncSeriesBailHook(["identifier", "etag", "gotHandlers"]),
      /** 存储缓存数据时触发 */
      store: new AsyncParallelHook(["identifier", "etag", "data"]),
      /** 用于缓存构建依赖 */
      storeBuildDependencies: new AsyncParallelHook(["dependencies"]),
      /** 缓存的空闲状态管理钩子 */
      beginIdle: new SyncHook([]),
      endIdle: new AsyncParallelHook([]),
      /** 关闭缓存系统时的钩子 */
      shutdown: new AsyncParallelHook([]),
    };
  }

  /**
   * 负责从缓存中获取数据，并使用钩子机制来允许其他模块或插件参与这个过程
   *
   * @param {string} identifier 缓存的标识符，用于区分不同的缓存项
   * @param {Etag | null} etag 缓存项的 etag（可以理解为版本标签）
   * @param {CallbackCache<T>} callback 获取完成后执行的回调
   * @returns {void}
   */
  get(identifier, etag, callback) {
    /** 用于存储获取处理程序，这些处理程序会在获取操作完成后被调用 */
    const gotHandlers = [];
    // 触发get 钩子，允许其他模块在获取缓存值时执行自定义逻辑
    this.hooks.get.callAsync(identifier, etag, gotHandlers, (err, result) => {
      if (err) {
        // 在执行钩子时发生了错误，调用 callback 函数并传递一个格式化后的错误信息
        callback(makeWebpackError(err, "Cache.hooks.get"));
        return;
      }

      // 转换为 undefined，以便后续的逻辑处理，callback 通常会处理 undefined 值
      if (result === null) {
        result = undefined;
      }

      // 有多个处理程序需要处理结果
      if (gotHandlers.length > 1) {
        const innerCallback = needCalls(gotHandlers.length, () =>
          callback(null, result)
        );
        for (const gotHandler of gotHandlers) {
          gotHandler(result, innerCallback);
        }
      } else if (gotHandlers.length === 1) {
        gotHandlers[0](result, () => callback(null, result));
      } else {
        // 如果没有任何处理程序，直接调用 callback，传递 result（此时可能是 undefined）
        callback(null, result);
      }
    });
  }

  /**
   * 将数据存储到缓存中
   * @template T
   * @param {string} identifier 用于唯一标识缓存条目的字符串
   * @param {Etag | null} etag 条目的版本或状态。可以用于检查是否需要更新缓存
   * @param {T} data 要存储的实际数据
   * @param {CallbackCache<void>} callback 存储完成后的回调函数
   * @returns {void}
   */
  store(identifier, etag, data, callback) {
    this.hooks.store.callAsync(
      identifier,
      etag,
      data,
      makeWebpackErrorCallback(callback, "Cache.hooks.store")
    );
  }

  /**
   * 存储构建依赖关系
   * After this method has succeeded the cache can only be restored when build dependencies are
   * @param {Iterable<string>} dependencies 构建过程中需要跟踪的依赖关系，通常是字符串的迭代对象
   * @param {CallbackCache<void>} callback 存储完成后的回调函数
   * @returns {void}
   */
  storeBuildDependencies(dependencies, callback) {
    this.hooks.storeBuildDependencies.callAsync(
      dependencies,
      makeWebpackErrorCallback(callback, "Cache.hooks.storeBuildDependencies")
    );
  }

  /**
   * 缓存开始进入空闲状态
   * @returns {void}
   */
  beginIdle() {
    this.hooks.beginIdle.call();
  }

  /**
   * 缓存结束空闲状态
   * @param {CallbackCache<void>} callback 结束空闲状态后的回调函数
   * @returns {void}
   */
  endIdle(callback) {
    this.hooks.endIdle.callAsync(
      makeWebpackErrorCallback(callback, "Cache.hooks.endIdle")
    );
  }

  /**
   * 用于关闭缓存系统 在 Webpack 的构建过程中调用，以便进行清理操作
   * @param {CallbackCache<void>} callback 关闭操作完成后的回调函数
   * @returns {void}
   */
  shutdown(callback) {
    this.hooks.shutdown.callAsync(
      makeWebpackErrorCallback(callback, "Cache.hooks.shutdown")
    );
  }
}

/** 内存缓存阶段，优先级最高 */
Cache.STAGE_MEMORY = -10;
/** 默认缓存阶段。这个阶段可能与其它缓存策略结合使用，但没有特别的优先级。可以用于临时缓存数据 */
Cache.STAGE_DEFAULT = 0;
/** 磁盘缓存阶段。适用于需要持久化的缓存，通常用于较大或不常变化的数据，虽然访问速度慢于内存，但可以节省内存资源 */
Cache.STAGE_DISK = 10;
/** 网络缓存阶段。用于从远程服务获取数据的缓存，通常会涉及到网络请求并可能需要在使用前进行验证或更新 */
Cache.STAGE_NETWORK = 20;

module.exports = Cache;
