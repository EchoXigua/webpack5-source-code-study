const memoize = require("./util/memoize");

/**
 * 实现了惰性加载的功能，用于延迟调用工厂函数 factory
 * 通过 memoize 机制确保工厂函数只会被调用一次。函数返回的 f 本质上是一个包装器，
 * 它会在第一次调用时执行 factory，并在后续调用中缓存工厂函数的结果，以提升性能
 *
 * @param {function(): T} factory factory function
 * @returns {T} function
 */
const lazyFunction = (factory) => {
  /**
   * 使用缓存函数包装传入的工厂函数
   * memoize的作用是: 工厂函数 factory 只会被调用一次，后续的调用会直接返回第一次调用的结果，而不会重复执行 factory
   */
  const fac = memoize(factory);

  // 返回一个函数，将外部传入的参数转发给工厂函数返回的结果
  const f = (...args) => fac()(...args);
  return f;
};

/**
 * 将 exports 对象的属性合并到 obj 中,它支持递归嵌套的对象
 * 通过 getter 提供懒加载的功能，同时将最终的对象冻结，使其不可修改
 */
const mergeExports = (obj, exports) => {
  // 获取 exports 对象的所有自身属性的描述符
  // 如configurable、enumerable、writable、value、get、set等属性
  const descriptors = Object.getOwnPropertyDescriptors(exports);

  for (const name of Object.keys(descriptors)) {
    const descriptor = descriptors[name];

    // 如果属性描述符包含 getter
    if (descriptor.get) {
      // 获取 getter
      const fn = descriptor.get;
      // 将 getter 做惰性加载，提高性能
      Object.defineProperty(obj, name, {
        configurable: false, // 不可重新配置
        enumerable: true, // 可遍历
        get: memoize(fn), // 惰性加载并缓存 fn 的结果
      });
    } else if (typeof descriptor.value === "object") {
      // 如果属性的值是对象
      Object.defineProperty(obj, name, {
        configurable: false,
        enumerable: true,
        writable: false,
        // 递归调用 来处理这个对象，会将嵌套对象的属性继续合并到 obj 中，直到不再有嵌套对象为止
        value: mergeExports({}, descriptor.value),
      });
    } else {
      // 既不是 getter，也不是对象，则抛出一个错误
      throw new Error(
        "Exposed values must be either a getter or an nested object"
      );
    }
  }

  // 返回最终的 obj 对象，冻结 obj，使其不可修改确保合并后的对象不被篡改
  return /** @type {A & B} */ (Object.freeze(obj));
};

const fn = lazyFunction(() => require("./webpack"));

module.exports = mergeExports(fn, {
  get webpack() {
    return require("./webpack");
  },
  get version() {
    return /** @type {string} */ (require("../package.json").version);
  },
  get cli() {
    return require("./cli");
  },
  // TODO webpack 6 deprecate
  get WebpackOptionsValidationError() {
    return require("schema-utils").ValidationError;
  },
  get ValidationError() {
    return require("schema-utils").ValidationError;
  },
});
