/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Jarid Margolin @jaridmargolin
*/

"use strict";

/**
 * inspect 是一个特殊的方法，允许对象自定义其在被 util.inspect() 函数调用时的字符串表示形式
 * inspect.custom 可以定义这个对象在输出时的格式
 */
const inspect = require("util").inspect.custom;
const makeSerializable = require("./util/makeSerializable");

class WebpackError extends Error {
  /**
   * @param {string=} message 错误信息
   */
  constructor(message) {
    super(message);

    /** 存储错误的详细信息 */
    this.details = undefined;
    /** 指向发生错误的模块 */
    this.module = undefined;
    /** 表示错误的具体位置 */
    this.loc = undefined;
    /** 是否隐藏堆栈信息 */
    this.hideStack = undefined;
    /** 指向与错误相关的代码块 */
    this.chunk = undefined;
    /** 发生错误的文件名 */
    this.file = undefined;
  }

  /**
   * 当使用 util.inspect() 打印 WebpackError 实例时，
   * Node.js 会自动调用此自定义的 inspect 方法，从而提供一个包含堆栈跟踪和错误详细信息的字符串输出
   * @returns
   */
  [inspect]() {
    return this.stack + (this.details ? `\n${this.details}` : "");
  }

  /**
   * 调用 write 方法依次写入错误的名称、消息、堆栈、详细信息、位置和隐藏堆栈标志
   * @param {ObjectSerializerContext} context context
   */
  serialize({ write }) {
    write(this.name);
    write(this.message);
    write(this.stack);
    write(this.details);
    write(this.loc);
    write(this.hideStack);
  }

  /**
   * 使用 read 方法依次读取错误的名称、消息、堆栈、详细信息、位置和隐藏堆栈标志，并将它们分配给实例的相应属性
   * @param {ObjectDeserializerContext} context context
   */
  deserialize({ read }) {
    this.name = read();
    this.message = read();
    this.stack = read();
    this.details = read();
    this.loc = read();
    this.hideStack = read();
  }
}

makeSerializable(WebpackError, "webpack/lib/WebpackError");

module.exports = WebpackError;
