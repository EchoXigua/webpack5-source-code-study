const SerializerMiddleware = require("./SerializerMiddleware");

/**
 * 表示一个不可序列化的常量对象
 */
const NOT_SERIALIZABLE = {};

/**
 * 存储构造函数和对应的序列化器配置对象
 */
const serializers = new Map();

/**
 * 将字符串 key（由 request 和 name 拼接而成）映射到 serializer，便于反向查找
 */
const serializerInversed = new Map();

class ObjectMiddleware extends SerializerMiddleware {
  static register(Constructor, request, name, serializer) {
    // 构建唯一标识
    const key = `${request}/${name}`;

    // 检查重复注册，防止构造函数被重复注册
    if (serializers.has(Constructor)) {
      throw new Error(
        `ObjectMiddleware.register: serializer for ${Constructor.name} is already registered`
      );
    }

    if (serializerInversed.has(key)) {
      throw new Error(
        `ObjectMiddleware.register: serializer for ${key} is already registered`
      );
    }

    // 将 Constructor 关联的 request、name 和 serializer 存储在 serializers 中
    serializers.set(Constructor, {
      request,
      name,
      serializer,
    });

    // 将 key 直接关联到 serializer，便于快速通过 key 查找序列化器
    serializerInversed.set(key, serializer);
  }
}

module.exports = ObjectMiddleware;
module.exports.NOT_SERIALIZABLE = NOT_SERIALIZABLE;
