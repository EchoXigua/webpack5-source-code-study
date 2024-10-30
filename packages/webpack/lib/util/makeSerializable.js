/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const { register } = require("./serialization");

/**
 * 这个类主要负责处理对象的序列化和反序列化
 * 目的是在保存和恢复对象状态时提供统一的方法，允许对对象进行深度保存和恢复
 */
class ClassSerializer {
  /** 存储传入的构造函数，方便在反序列化时调用 */
  constructor(Constructor) {
    this.Constructor = Constructor;
  }

  serialize(obj, context) {
    obj.serialize(context);
  }

  deserialize(context) {
    // 这里检查构造函数身上有无反序列化函数（静态属性）
    if (typeof this.Constructor.deserialize === "function") {
      return this.Constructor.deserialize(context);
    }

    // 没有的话在实例身上获取
    const obj = new this.Constructor();
    obj.deserialize(context);
    return obj;
  }
}

/**
 * 导出一个函数用于注册序列化器
 * @param {Constructor} Constructor 构造函数
 * @param {string} request 请求标识，用于标识序列化的上下文
 * @param {string | null} [name] 指定序列化器的唯一名称，特别在多个序列化器共享同一请求时
 */
module.exports = (Constructor, request, name = null) => {
  register(Constructor, request, name, new ClassSerializer(Constructor));
};
