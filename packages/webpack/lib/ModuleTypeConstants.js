/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Sean Larkin @TheLarkInn
*/

"use strict";

/**
 * 自动识别 JavaScript 文件的模块类型
 */
const JAVASCRIPT_MODULE_TYPE_AUTO = "javascript/auto";

/**
 * 用于 CommonJS 模块系统，这种模块具有动态加载特性
 */
const JAVASCRIPT_MODULE_TYPE_DYNAMIC = "javascript/dynamic";

/**
 * 遵循严格 ES 模块语法的文件，不支持 CommonJS、AMD 等其他模块格式
 */
const JAVASCRIPT_MODULE_TYPE_ESM = "javascript/esm";

/**
 * 用于 JSON 文件，Webpack 会将其解析为 ES 模块格式
 */
const JSON_MODULE_TYPE = "json";

/**
 * 用于 WebAssembly 模块（异步加载），Webpack 5 默认的 WebAssembly 处理方式
 */
const WEBASSEMBLY_MODULE_TYPE_ASYNC = "webassembly/async";

/**
 * 支持同步加载的 WebAssembly 模块，这是为了向后兼容 Webpack 4 的行为
 */
const WEBASSEMBLY_MODULE_TYPE_SYNC = "webassembly/sync";

/**  CSS 模块类型 ----------------------------------------------- */
/**
 * 用于普通 CSS 文件
 */
const CSS_MODULE_TYPE = "css";

/**
 * 用于 CSS 模块文件，class 名称需要用 :local 显式定义
 */
const CSS_MODULE_TYPE_GLOBAL = "css/global";

/**
 * 用于 CSS 模块文件，默认将 class 名称进行哈希处理
 */
const CSS_MODULE_TYPE_MODULE = "css/module";

/**
 * 根据文件名（包含 .module. 或 .modules.）自动识别是否作为 CSS 模块处理
 */
const CSS_MODULE_TYPE_AUTO = "css/auto";

/**  资产（Asset）模块类型 ----------------------------------------------- */
/**
 * 自动选择 asset/inline 或 asset/resource，根据文件大小来决定 (8096)
 */
const ASSET_MODULE_TYPE = "asset";

/**
 * 将文件内联为数据 URI，与传统的 url-loader 类似
 */
const ASSET_MODULE_TYPE_INLINE = "asset/inline";

/**
 * 将文件复制到输出目录，与 file-loader 功能一致
 */
const ASSET_MODULE_TYPE_RESOURCE = "asset/resource";

/**
 * 将文件作为源代码导入，与 raw-loader 类似
 */
const ASSET_MODULE_TYPE_SOURCE = "asset/source";

/**
 * 用于处理包含在 CSS 文件中的数据 URI 格式的资源
 * 此类资源通常以 base64 编码形式嵌入到 CSS 中，比如图片或字体文件，这样可以避免额外的网络请求
 *
 * 在 css-loader 中，可以将 CSS 文件中引用的小文件（如小图标）自动转换为 base64 数据 URI，
 * 这种处理方式可以减少 HTTP 请求的数量
 */
const ASSET_MODULE_TYPE_RAW_DATA_URL = "asset/raw-data-url";

/** Webpack 内部模块类型 ----------------------------------------------- */
/**
 * Webpack 的运行时模块，包含 Webpack 自身的运行时抽象
 */
const WEBPACK_MODULE_TYPE_RUNTIME = "runtime";

/**
 * 用于 模块联邦 的 Fallback 模块（后备模块）
 */
const WEBPACK_MODULE_TYPE_FALLBACK = "fallback-module";

/**
 * 用于 模块联邦 中的远程模块
 */
const WEBPACK_MODULE_TYPE_REMOTE = "remote-module";

/**
 * 用于 模块联邦 中的提供模块
 */
const WEBPACK_MODULE_TYPE_PROVIDE = "provide-module";

/**
 * 用于 模块联邦 中的共享模块
 */
const WEBPACK_MODULE_TYPE_CONSUME_SHARED_MODULE = "consume-shared-module";

/**
 * 用于懒加载编译代理模块，依赖 LazyCompilationPlugin
 */
const WEBPACK_MODULE_TYPE_LAZY_COMPILATION_PROXY = "lazy-compilation-proxy";

/** @typedef {"javascript/auto" | "javascript/dynamic" | "javascript/esm"} JavaScriptModuleTypes */
/** @typedef {"json"} JSONModuleType */
/** @typedef {"webassembly/async" | "webassembly/sync"} WebAssemblyModuleTypes */
/** @typedef {"css" | "css/global" | "css/module"} CSSModuleTypes */
/** @typedef {"asset" | "asset/inline" | "asset/resource" | "asset/source" | "asset/raw-data-url"} AssetModuleTypes */
/** @typedef {"runtime" | "fallback-module" | "remote-module" | "provide-module" | "consume-shared-module" | "lazy-compilation-proxy"} WebpackModuleTypes */
/** @typedef {string} UnknownModuleTypes */
/** @typedef {JavaScriptModuleTypes | JSONModuleType | WebAssemblyModuleTypes | CSSModuleTypes | AssetModuleTypes | WebpackModuleTypes | UnknownModuleTypes} ModuleTypes */

module.exports.ASSET_MODULE_TYPE = ASSET_MODULE_TYPE;
module.exports.ASSET_MODULE_TYPE_RAW_DATA_URL = ASSET_MODULE_TYPE_RAW_DATA_URL;
module.exports.ASSET_MODULE_TYPE_SOURCE = ASSET_MODULE_TYPE_SOURCE;
module.exports.ASSET_MODULE_TYPE_RESOURCE = ASSET_MODULE_TYPE_RESOURCE;
module.exports.ASSET_MODULE_TYPE_INLINE = ASSET_MODULE_TYPE_INLINE;
module.exports.JAVASCRIPT_MODULE_TYPE_AUTO = JAVASCRIPT_MODULE_TYPE_AUTO;
module.exports.JAVASCRIPT_MODULE_TYPE_DYNAMIC = JAVASCRIPT_MODULE_TYPE_DYNAMIC;
module.exports.JAVASCRIPT_MODULE_TYPE_ESM = JAVASCRIPT_MODULE_TYPE_ESM;
module.exports.JSON_MODULE_TYPE = JSON_MODULE_TYPE;
module.exports.WEBASSEMBLY_MODULE_TYPE_ASYNC = WEBASSEMBLY_MODULE_TYPE_ASYNC;
module.exports.WEBASSEMBLY_MODULE_TYPE_SYNC = WEBASSEMBLY_MODULE_TYPE_SYNC;
module.exports.CSS_MODULE_TYPE = CSS_MODULE_TYPE;
module.exports.CSS_MODULE_TYPE_GLOBAL = CSS_MODULE_TYPE_GLOBAL;
module.exports.CSS_MODULE_TYPE_MODULE = CSS_MODULE_TYPE_MODULE;
module.exports.CSS_MODULE_TYPE_AUTO = CSS_MODULE_TYPE_AUTO;
module.exports.WEBPACK_MODULE_TYPE_RUNTIME = WEBPACK_MODULE_TYPE_RUNTIME;
module.exports.WEBPACK_MODULE_TYPE_FALLBACK = WEBPACK_MODULE_TYPE_FALLBACK;
module.exports.WEBPACK_MODULE_TYPE_REMOTE = WEBPACK_MODULE_TYPE_REMOTE;
module.exports.WEBPACK_MODULE_TYPE_PROVIDE = WEBPACK_MODULE_TYPE_PROVIDE;
module.exports.WEBPACK_MODULE_TYPE_CONSUME_SHARED_MODULE =
  WEBPACK_MODULE_TYPE_CONSUME_SHARED_MODULE;
module.exports.WEBPACK_MODULE_TYPE_LAZY_COMPILATION_PROXY =
  WEBPACK_MODULE_TYPE_LAZY_COMPILATION_PROXY;
