/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

/** @template T @typedef {function(): T} FunctionReturning */

/**
 *
 * 实现一个简单的记忆函数用于缓存函数 fn 的结果，以避免重复计算
 *
 * 核心思想是：只调用一次 传入的函数 fn，之后每次调用 memoize 返回的函数时，直接返回缓存的结果，而不再重新执行 fn
 *
 * @template T
 * @param {FunctionReturning<T>} fn memorized function
 * @returns {FunctionReturning<T>} new function
 */
const memoize = (fn) => {
  // fn 是需要被记忆化（缓存结果）的函数
  let cache = false;
  /** @type {T | undefined} */
  let result;
  return () => {
    // 说明fn 执行过一次了，直接返回缓存的结果
    if (cache) {
      return /** @type {T} */ (result);
    }

    // 缓存执行的结果
    result = fn();
    // 标记已缓存
    cache = true;
    // 将 fn 置为 undefined，以便释放对 fn 的引用，帮助垃圾回收机制释放内存
    fn = undefined;
    // 返回 fn 执行后的结果
    return /** @type {T} */ (result);
  };
};

module.exports = memoize;
