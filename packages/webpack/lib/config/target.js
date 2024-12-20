const memoize = require("../util/memoize");

const getBrowserslistTargetHandler = memoize(() =>
  require("./browserslistTargetHandler")
);

const getDefaultTarget = (context) => {
  // 判断是否存在有效的 browserslist 配置
  const browsers = getBrowserslistTargetHandler().load(null, context);
  return browsers ? "browserslist" : "web";
};

/**
 * 用于比较两个版本号的主版本（major）和次版本（minor），
 * 从而决定一个特定功能或代码是否在某个特定版本或更高版本中适用
 * @param {*} major
 * @param {*} minor
 * @returns
 */
const versionDependent = (major, minor) => {
  if (!major) {
    return () => undefined;
  }
  const nMajor = Number(major);
  const nMinor = minor ? Number(minor) : 0;
  return (vMajor, vMinor = 0) =>
    nMajor > vMajor || (nMajor === vMajor && nMinor >= vMinor);
};

const TARGETS = [
  [
    "browserslist / browserslist:env / browserslist:query / browserslist:path-to-config / browserslist:path-to-config:env",
    "Resolve features from browserslist. Will resolve browserslist config automatically. Only browser or node queries are supported (electron is not supported). Examples: 'browserslist:modern' to use 'modern' environment from browserslist config",
    /^browserslist(?::(.+))?$/,
    (rest, context) => {
      const browserslistTargetHandler = getBrowserslistTargetHandler();
      const browsers = browserslistTargetHandler.load(
        rest ? rest.trim() : null,
        context
      );
      if (!browsers) {
        throw new Error(`No browserslist config found to handle the 'browserslist' target.
See https://github.com/browserslist/browserslist#queries for possible ways to provide a config.
The recommended way is to add a 'browserslist' key to your package.json and list supported browsers (resp. node.js versions).
You can also more options via the 'target' option: 'browserslist' / 'browserslist:env' / 'browserslist:query' / 'browserslist:path-to-config' / 'browserslist:path-to-config:env'`);
      }

      return browserslistTargetHandler.resolve(browsers);
    },
  ],
  [
    "web",
    "Web browser.",
    /^web$/,
    () => ({
      web: true,
      browser: true,
      webworker: null,
      node: false,
      electron: false,
      nwjs: false,

      document: true,
      importScriptsInWorker: true,
      fetchWasm: true,
      nodeBuiltins: false,
      importScripts: false,
      require: false,
      global: false,
    }),
  ],
  [
    "webworker",
    "Web Worker, SharedWorker or Service Worker.",
    /^webworker$/,
    () => ({
      web: true,
      browser: true,
      webworker: true,
      node: false,
      electron: false,
      nwjs: false,

      importScripts: true,
      importScriptsInWorker: true,
      fetchWasm: true,
      nodeBuiltins: false,
      require: false,
      document: false,
      global: false,
    }),
  ],
  [
    "[async-]node[X[.Y]]",
    "Node.js in version X.Y. The 'async-' prefix will load chunks asynchronously via 'fs' and 'vm' instead of 'require()'. Examples: node14.5, async-node10.",
    /^(async-)?node((\d+)(?:\.(\d+))?)?$/,
    (asyncFlag, _, major, minor) => {
      const v = versionDependent(major, minor);
      // see https://node.green/
      return {
        node: true,
        electron: false,
        nwjs: false,
        web: false,
        webworker: false,
        browser: false,

        require: !asyncFlag,
        nodeBuiltins: true,
        // v16.0.0, v14.18.0
        nodePrefixForCoreModules: Number(major) < 15 ? v(14, 18) : v(16),
        global: true,
        document: false,
        fetchWasm: false,
        importScripts: false,
        importScriptsInWorker: false,

        globalThis: v(12),
        const: v(6),
        templateLiteral: v(4),
        optionalChaining: v(14),
        arrowFunction: v(6),
        asyncFunction: v(7, 6),
        forOf: v(5),
        destructuring: v(6),
        bigIntLiteral: v(10, 4),
        dynamicImport: v(12, 17),
        dynamicImportInWorker: major ? false : undefined,
        module: v(12, 17),
      };
    },
  ],
  [
    "electron[X[.Y]]-main/preload/renderer",
    "Electron in version X.Y. Script is running in main, preload resp. renderer context.",
    /^electron((\d+)(?:\.(\d+))?)?-(main|preload|renderer)$/,
    (_, major, minor, context) => {
      const v = versionDependent(major, minor);
      // see https://node.green/ + https://github.com/electron/releases
      return {
        node: true,
        electron: true,
        web: context !== "main",
        webworker: false,
        browser: false,
        nwjs: false,

        electronMain: context === "main",
        electronPreload: context === "preload",
        electronRenderer: context === "renderer",

        global: true,
        nodeBuiltins: true,
        // 15.0.0	- Node.js	v16.5
        // 14.0.0 - Mode.js v14.17, but prefixes only since v14.18
        nodePrefixForCoreModules: v(15),

        require: true,
        document: context === "renderer",
        fetchWasm: context === "renderer",
        importScripts: false,
        importScriptsInWorker: true,

        globalThis: v(5),
        const: v(1, 1),
        templateLiteral: v(1, 1),
        optionalChaining: v(8),
        arrowFunction: v(1, 1),
        asyncFunction: v(1, 7),
        forOf: v(0, 36),
        destructuring: v(1, 1),
        bigIntLiteral: v(4),
        dynamicImport: v(11),
        dynamicImportInWorker: major ? false : undefined,
        module: v(11),
      };
    },
  ],
  [
    "nwjs[X[.Y]] / node-webkit[X[.Y]]",
    "NW.js in version X.Y.",
    /^(?:nwjs|node-webkit)((\d+)(?:\.(\d+))?)?$/,
    (_, major, minor) => {
      const v = versionDependent(major, minor);
      // see https://node.green/ + https://github.com/nwjs/nw.js/blob/nw48/CHANGELOG.md
      return {
        node: true,
        web: true,
        nwjs: true,
        webworker: null,
        browser: false,
        electron: false,

        global: true,
        nodeBuiltins: true,
        document: false,
        importScriptsInWorker: false,
        fetchWasm: false,
        importScripts: false,
        require: false,

        globalThis: v(0, 43),
        const: v(0, 15),
        templateLiteral: v(0, 13),
        optionalChaining: v(0, 44),
        arrowFunction: v(0, 15),
        asyncFunction: v(0, 21),
        forOf: v(0, 13),
        destructuring: v(0, 15),
        bigIntLiteral: v(0, 32),
        dynamicImport: v(0, 43),
        dynamicImportInWorker: major ? false : undefined,
        module: v(0, 43),
      };
    },
  ],
  [
    "esX",
    "EcmaScript in this version. Examples: es2020, es5.",
    /^es(\d+)$/,
    (version) => {
      let v = Number(version);
      if (v < 1000) v = v + 2009;
      return {
        const: v >= 2015,
        templateLiteral: v >= 2015,
        optionalChaining: v >= 2020,
        arrowFunction: v >= 2015,
        forOf: v >= 2015,
        destructuring: v >= 2015,
        module: v >= 2015,
        asyncFunction: v >= 2017,
        globalThis: v >= 2020,
        bigIntLiteral: v >= 2020,
        dynamicImport: v >= 2020,
        dynamicImportInWorker: v >= 2020,
      };
    },
  ],
];

const getTargetProperties = (target, context) => {
  for (const [, , regExp, handler] of TARGETS) {
    const match = regExp.exec(target);
    if (match) {
      const [, ...args] = match;
      const result = handler(...args, context);
      if (result) return /** @type {TargetProperties} */ (result);
    }
  }
  throw new Error(
    `Unknown target '${target}'. The following targets are supported:\n${TARGETS.map(
      ([name, description]) => `* ${name}: ${description}`
    ).join("\n")}`
  );
};

const mergeTargetProperties = (targetProperties) => {
  /** @type {Set<keyof TargetProperties>} */
  const keys = new Set();
  for (const tp of targetProperties) {
    for (const key of Object.keys(tp)) {
      keys.add(/** @type {keyof TargetProperties} */ (key));
    }
  }
  const result = {};
  for (const key of keys) {
    let hasTrue = false;
    let hasFalse = false;
    for (const tp of targetProperties) {
      const value = tp[key];
      switch (value) {
        case true:
          hasTrue = true;
          break;
        case false:
          hasFalse = true;
          break;
      }
    }
    if (hasTrue || hasFalse)
      result[key] = hasFalse && hasTrue ? null : Boolean(hasTrue);
  }
  return result;
};

const getTargetsProperties = (targets, context) =>
  mergeTargetProperties(targets.map((t) => getTargetProperties(t, context)));

module.exports.getDefaultTarget = getDefaultTarget;
module.exports.getTargetProperties = getTargetProperties;
module.exports.getTargetsProperties = getTargetsProperties;
