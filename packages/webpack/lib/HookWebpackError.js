/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Sean Larkin @thelarkinn
*/

"use strict";

const WebpackError = require("./WebpackError");

/**
 * 一个专门用于表示 Webpack 钩子中的错误的类，继承自 WebpackError，
 * 提供了额外的信息来帮助开发者理解错误的来源
 */
class HookWebpackError extends WebpackError {
  /**
   * @param {Error} error 内部错误
   * @param {string} hook 发生错误的钩子名称
   */
  constructor(error, hook) {
    super(error.message);

    // 以便在捕获错误时能明确识别
    this.name = "HookWebpackError";
    /** 存储错误发生的钩子名称 */
    this.hook = hook;
    /** 存储原始错误，以便在需要时访问 */
    this.error = error;
    /** 隐藏堆栈信息 */
    this.hideStack = true;

    /** 提供更详细的错误信息，包含错误发生的钩子及其堆栈 */
    this.details = `caused by plugins in ${hook}\n${error.stack}`;

    /** 添加内部错误的堆栈信息 */
    this.stack += `\n-- inner error --\n${error.stack}`;
  }
}

module.exports = HookWebpackError;

/**
 * @param {Error} error an error
 * @param {string} hook name of the hook
 * @returns {WebpackError} a webpack error
 */
const makeWebpackError = (error, hook) => {
  if (error instanceof WebpackError) return error;
  return new HookWebpackError(error, hook);
};
module.exports.makeWebpackError = makeWebpackError;

/**
 * @template T
 * @param {function(WebpackError | null, T=): void} callback webpack error callback
 * @param {string} hook name of hook
 * @returns {Callback<T>} generic callback
 */
const makeWebpackErrorCallback = (callback, hook) => (err, result) => {
  if (err) {
    if (err instanceof WebpackError) {
      callback(err);
      return;
    }
    callback(new HookWebpackError(err, hook));
    return;
  }
  callback(null, result);
};

module.exports.makeWebpackErrorCallback = makeWebpackErrorCallback;

/**
 * @template T
 * @param {function(): T} fn function which will be wrapping in try catch
 * @param {string} hook name of hook
 * @returns {T} the result
 */
const tryRunOrWebpackError = (fn, hook) => {
  let r;
  try {
    r = fn();
  } catch (err) {
    if (err instanceof WebpackError) {
      throw err;
    }
    throw new HookWebpackError(/** @type {Error} */ (err), hook);
  }
  return r;
};

module.exports.tryRunOrWebpackError = tryRunOrWebpackError;
