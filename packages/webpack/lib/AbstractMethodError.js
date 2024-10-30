/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Ivan Kopeykin @vankop
*/

"use strict";

const WebpackError = require("./WebpackError");

/**
 * 用于匹配调用栈中方法名称的格式，通过捕获分组 ([a-zA-Z0-9_.]*) 提取方法名，例如 ClassName.methodName
 */
const CURRENT_METHOD_REGEXP = /at ([a-zA-Z0-9_.]*)/;

/**
 * 函数生成错误消息内容，当 method 参数存在时，将方法名附加在错误信息上，否则生成默认的错误信息
 * @param {string=} method method name
 * @returns {string} message
 */
function createMessage(method) {
  return `Abstract method${method ? ` ${method}` : ""}. Must be overridden.`;
}

/**
 * 该构造函数的主要作用是生成包含调用栈信息的错误消息，提取出触发该错误的方法名，
 * 用于构造更具描述性的错误提示信息，尤其在开发和调试中帮助开发者迅速定位未实现的方法位置
 * 其关键在于动态地获取抛出错误的具体方法名称，并将其拼接成 “必须被重写”的抽象方法错误提示
 *
 * @constructor
 */
function Message() {
  this.stack = undefined;

  // 将当前调用栈赋值给 this.stack
  Error.captureStackTrace(this);
  //  将堆栈信息切割为数组，从中查找触发错误的第4行
  // （这行通常显示调用方法的上下文信息），通过正则匹配到当前方法的名称
  const match = this.stack.split("\n")[3].match(CURRENT_METHOD_REGEXP);

  // 生成包含方法名称的错误提示，用于提示开发者在该类中有未实现的抽象方法
  this.message = match && match[1] ? createMessage(match[1]) : createMessage();
}

/**
 * Error for abstract method
 * @example
 * ```js
 * class FooClass {
 *     abstractMethod() {
 *         throw new AbstractMethodError(); // error message: Abstract method FooClass.abstractMethod. Must be overridden.
 *     }
 * }
 *
 * ```
 * 在 FooClass 中，如果 abstractMethod 未被重写时调用，将抛出 AbstractMethodError，并附带错误提示信息
 *
 */
class AbstractMethodError extends WebpackError {
  constructor() {
    super(new Message().message);
    this.name = "AbstractMethodError";
  }
}

module.exports = AbstractMethodError;
