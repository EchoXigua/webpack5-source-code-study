const {
  AsyncSeriesBailHook,
  SyncWaterfallHook,
  SyncBailHook,
  SyncHook,
  HookMap,
} = require("tapable");
const ModuleFactory = require("./ModuleFactory");
const RuleSetCompiler = require("./rules/RuleSetCompiler");
const BasicEffectRulePlugin = require("./rules/BasicEffectRulePlugin");
const BasicMatcherRulePlugin = require("./rules/BasicMatcherRulePlugin");
const ObjectMatcherRulePlugin = require("./rules/ObjectMatcherRulePlugin");
const UseEffectRulePlugin = require("./rules/UseEffectRulePlugin");

const {
  parseResource,
  parseResourceWithoutFragment,
} = require("./util/identifier");

const ruleSetCompiler = new RuleSetCompiler([
  new BasicMatcherRulePlugin("test", "resource"),
  new BasicMatcherRulePlugin("scheme"),
  new BasicMatcherRulePlugin("mimetype"),
  new BasicMatcherRulePlugin("dependency"),
  new BasicMatcherRulePlugin("include", "resource"),
  new BasicMatcherRulePlugin("exclude", "resource", true),
  new BasicMatcherRulePlugin("resource"),
  new BasicMatcherRulePlugin("resourceQuery"),
  new BasicMatcherRulePlugin("resourceFragment"),
  new BasicMatcherRulePlugin("realResource"),
  new BasicMatcherRulePlugin("issuer"),
  new BasicMatcherRulePlugin("compiler"),
  new BasicMatcherRulePlugin("issuerLayer"),
  new ObjectMatcherRulePlugin(
    "assert",
    "assertions",
    (value) => value && /** @type {any} */ (value)._isLegacyAssert !== undefined
  ),
  new ObjectMatcherRulePlugin(
    "with",
    "assertions",
    (value) => value && !(/** @type {any} */ (value)._isLegacyAssert)
  ),
  new ObjectMatcherRulePlugin("descriptionData"),
  new BasicEffectRulePlugin("type"),
  new BasicEffectRulePlugin("sideEffects"),
  new BasicEffectRulePlugin("parser"),
  new BasicEffectRulePlugin("resolve"),
  new BasicEffectRulePlugin("generator"),
  new BasicEffectRulePlugin("layer"),
  new UseEffectRulePlugin(),
]);
class NormalModuleFactory extends ModuleFactory {
  /**
   * @param {object} param params
   * @param {string=} param.context 模块解析的上下文目录
   * @param {InputFileSystem} param.fs 文件系统
   * @param {ResolverFactory} param.resolverFactory 解析器工厂
   * @param {ModuleOptions} param.options 模块配置选项
   * @param {object=} param.associatedObjectForCache 用于绑定缓存的对象
   * @param {boolean=} param.layers 启用层功能
   */
  constructor({
    context,
    fs,
    resolverFactory,
    options,
    associatedObjectForCache,
    layers = false,
  }) {
    super();

    // 将 this.hooks 冻结，确保钩子配置不可修改
    this.hooks = Object.freeze({
      // 异步串行钩子，当解析模块时触发
      resolve: new AsyncSeriesBailHook(["resolveData"]),
      //   处理不同 scheme 的资源解析
      resolveForScheme: new HookMap(
        () => new AsyncSeriesBailHook(["resourceData", "resolveData"])
      ),
      resolveInScheme: new HookMap(
        () => new AsyncSeriesBailHook(["resourceData", "resolveData"])
      ),
      // 异步串行钩子，专门用于模块因子化操作,factorize 一般是将解析后的资源转化为具体模块的过程
      factorize: new AsyncSeriesBailHook(["resolveData"]),

      // 异步串行钩子，分别在解析模块之前和之后执行，可用于在解析开始前准备数据或在解析后进行清理等
      beforeResolve: new AsyncSeriesBailHook(["resolveData"]),
      afterResolve: new AsyncSeriesBailHook(["resolveData"]),
      // 异步串行钩子，用于创建模块时触发
      createModule: new AsyncSeriesBailHook(["createData", "resolveData"]),
      // 同步瀑布钩子,会依次将返回结果传递给下一个注册的函数
      module: new SyncWaterfallHook(["module", "createData", "resolveData"]),
      // 用于创建解析器
      createParser: new HookMap(() => new SyncBailHook(["parserOptions"])),
      // 用于在解析器创建后，进一步配置或操作解析器实例
      parser: new HookMap(() => new SyncHook(["parser", "parserOptions"])),
      // 用于生成器（Generator）的创建过程
      createGenerator: new HookMap(
        () => new SyncBailHook(["generatorOptions"])
      ),
      // 用于生成器创建后进一步配置生成器，类似 parser 钩子
      generator: new HookMap(
        () => new SyncHook(["generator", "generatorOptions"])
      ),
      // 在模块类创建时触发
      createModuleClass: new HookMap(
        () => new SyncBailHook(["createData", "resolveData"])
      ),
    });

    this.resolverFactory = resolverFactory;

    this.ruleSet = ruleSetCompiler.compile([
      {
        rules: options.defaultRules,
      },
      {
        rules: options.rules,
      },
    ]);
    // 设置了当前编译的上下文路径，作为默认的模块查找路径
    // 如果没有传入值，则使用空字符串（根目录）作为上下文路径
    this.context = context || "";
    this.fs = fs;
    // 解析器，用于代码解析，如 JavaScript 代码的语法分析
    this._globalParserOptions = options.parser;
    // 生成器，用于代码生成，将模块转换成可以执行的格式
    this._globalGeneratorOptions = options.generator;
    /** 存储解析器实例 */
    this.parserCache = new Map();
    /** 存储生成器实例 */
    this.generatorCache = new Map();
    /**
     * 存储恢复的缓存条目，这些条目被标记为“不安全”
     * 在缓存模块的过程中，如果模块未能通过某些验证（例如文件被删除或内容发生更改），
     * 则会将该模块加入该集合，确保在不安全情况下重新生成该模块
     */
    this._restoredUnsafeCacheEntries = new Set();

    const cacheParseResource = parseResource.bindCache(
      associatedObjectForCache
    );
    const cachedParseResourceWithoutFragment =
      parseResourceWithoutFragment.bindCache(associatedObjectForCache);
    this._parseResourceWithoutFragment = cachedParseResourceWithoutFragment;

    // 注册了一个异步钩子，用于处理模块的“因子化”（factorize）
    // 用于将模块的依赖项转换为具体的模块实例
    // tapAsync 方法将 factorize 钩子注册为异步钩子
    this.hooks.factorize.tapAsync(
      {
        name: "NormalModuleFactory",
        stage: 100, // 设置了钩子的执行顺序，值越大优先级越高
      },
      (resolveData, callback) => {
        // 调用了 resolve 钩子，传入 resolveData 进行模块解析
        // resolve 钩子会在 Webpack 的模块依赖解析过程中被触发
        this.hooks.resolve.callAsync(resolveData, (err, result) => {
          if (err) return callback(err);

          // 表示当前模块被忽略，不需要进一步处理
          if (result === false) return callback();

          // 表示已经解析到了一个模块对象（Module 实例）,直接返回该模块
          if (result instanceof Module) return callback(null, result);

          // 解析结果是一个普通对象（而不是 Module）,则抛出错误。因为这里期望返回的应该是一个 Module 实例
          if (typeof result === "object")
            throw new Error(
              `${deprecationChangedHookMessage(
                "resolve",
                this.hooks.resolve
              )} Returning a Module object will result in this module used as result.`
            );

          // 继续调用 afterResolve 钩子，用于对 resolveData 做进一步处理
          // afterResolve 是 resolve 钩子的后续步骤，通常用于确保 resolveData 中的某些字段满足条件
          this.hooks.afterResolve.callAsync(resolveData, (err, result) => {
            if (err) return callback(err);

            // 解析结果为普通对象，抛错
            if (typeof result === "object")
              throw new Error(
                deprecationChangedHookMessage(
                  "afterResolve",
                  this.hooks.afterResolve
                )
              );

            // Ignored
            if (result === false) return callback();

            // 包含创建模块所需的基础数据
            const createData = resolveData.createData;

            // 这个钩子会使用 createData 和 resolveData 尝试创建模块实例
            this.hooks.createModule.callAsync(
              createData,
              resolveData,
              (err, createdModule) => {
                // 未能生成模块
                if (!createdModule) {
                  if (!resolveData.request) {
                    return callback(new Error("Empty dependency (no request)"));
                  }

                  // 根据模块类型尝试使用 createModuleClass 钩子生成
                  // TODO webpack 6 make it required and move javascript/wasm/asset properties to own module
                  createdModule = this.hooks.createModuleClass
                    .for(createData.settings.type)
                    .call(createData, resolveData);

                  // 如果生成失败，默认创建一个 NormalModule 实例
                  if (!createdModule) {
                    createdModule = new NormalModule(createData);
                  }
                }

                // 调用 module 钩子进行最终模块处理
                createdModule = this.hooks.module.call(
                  createdModule,
                  createData,
                  resolveData
                );

                // 最终，将模块作为参数传入 callback 返回给上级调用
                return callback(null, createdModule);
              }
            );
          });
        });
      }
    );
    this.hooks.resolve.tapAsync(
      {
        name: "NormalModuleFactory",
        stage: 100,
      },
      (data, callback) => {
        const {
          contextInfo,
          context,
          dependencies,
          dependencyType,
          request,
          assertions,
          resolveOptions,
          fileDependencies,
          missingDependencies,
          contextDependencies,
        } = data;
        const loaderResolver = this.getResolver("loader");

        /** @type {ResourceData | undefined} */
        let matchResourceData;
        /** @type {string} */
        let unresolvedResource;
        /** @type {ParsedLoaderRequest[]} */
        let elements;
        let noPreAutoLoaders = false;
        let noAutoLoaders = false;
        let noPrePostAutoLoaders = false;

        const contextScheme = getScheme(context);
        /** @type {string | undefined} */
        let scheme = getScheme(request);

        if (!scheme) {
          /** @type {string} */
          let requestWithoutMatchResource = request;
          const matchResourceMatch = MATCH_RESOURCE_REGEX.exec(request);
          if (matchResourceMatch) {
            let matchResource = matchResourceMatch[1];
            if (matchResource.charCodeAt(0) === 46) {
              // 46 === ".", 47 === "/"
              const secondChar = matchResource.charCodeAt(1);
              if (
                secondChar === 47 ||
                (secondChar === 46 && matchResource.charCodeAt(2) === 47)
              ) {
                // if matchResources startsWith ../ or ./
                matchResource = join(this.fs, context, matchResource);
              }
            }
            matchResourceData = {
              resource: matchResource,
              ...cacheParseResource(matchResource),
            };
            requestWithoutMatchResource = request.slice(
              matchResourceMatch[0].length
            );
          }

          scheme = getScheme(requestWithoutMatchResource);

          if (!scheme && !contextScheme) {
            const firstChar = requestWithoutMatchResource.charCodeAt(0);
            const secondChar = requestWithoutMatchResource.charCodeAt(1);
            noPreAutoLoaders = firstChar === 45 && secondChar === 33; // startsWith "-!"
            noAutoLoaders = noPreAutoLoaders || firstChar === 33; // startsWith "!"
            noPrePostAutoLoaders = firstChar === 33 && secondChar === 33; // startsWith "!!";
            const rawElements = requestWithoutMatchResource
              .slice(
                noPreAutoLoaders || noPrePostAutoLoaders
                  ? 2
                  : noAutoLoaders
                    ? 1
                    : 0
              )
              .split(/!+/);
            unresolvedResource = /** @type {string} */ (rawElements.pop());
            elements = rawElements.map((el) => {
              const { path, query } = cachedParseResourceWithoutFragment(el);
              return {
                loader: path,
                options: query ? query.slice(1) : undefined,
              };
            });
            scheme = getScheme(unresolvedResource);
          } else {
            unresolvedResource = requestWithoutMatchResource;
            elements = EMPTY_ELEMENTS;
          }
        } else {
          unresolvedResource = request;
          elements = EMPTY_ELEMENTS;
        }

        /** @type {ResolveContext} */
        const resolveContext = {
          fileDependencies,
          missingDependencies,
          contextDependencies,
        };

        /** @type {ResourceDataWithData} */
        let resourceData;

        /** @type {undefined | LoaderItem[]} */
        let loaders;

        const continueCallback = needCalls(2, (err) => {
          if (err) return callback(err);

          // translate option idents
          try {
            for (const item of /** @type {LoaderItem[]} */ (loaders)) {
              if (typeof item.options === "string" && item.options[0] === "?") {
                const ident = item.options.slice(1);
                if (ident === "[[missing ident]]") {
                  throw new Error(
                    "No ident is provided by referenced loader. " +
                      "When using a function for Rule.use in config you need to " +
                      "provide an 'ident' property for referenced loader options."
                  );
                }
                item.options = this.ruleSet.references.get(ident);
                if (item.options === undefined) {
                  throw new Error(
                    "Invalid ident is provided by referenced loader"
                  );
                }
                item.ident = ident;
              }
            }
          } catch (identErr) {
            return callback(/** @type {Error} */ (identErr));
          }

          if (!resourceData) {
            // ignored
            return callback(null, dependencies[0].createIgnoredModule(context));
          }

          const userRequest =
            (matchResourceData !== undefined
              ? `${matchResourceData.resource}!=!`
              : "") +
            stringifyLoadersAndResource(
              /** @type {LoaderItem[]} */ (loaders),
              resourceData.resource
            );

          /** @type {ModuleSettings} */
          const settings = {};
          const useLoadersPost = [];
          const useLoaders = [];
          const useLoadersPre = [];

          // handle .webpack[] suffix
          let resource;
          let match;
          if (
            matchResourceData &&
            typeof (resource = matchResourceData.resource) === "string" &&
            (match = /\.webpack\[([^\]]+)\]$/.exec(resource))
          ) {
            settings.type = match[1];
            matchResourceData.resource = matchResourceData.resource.slice(
              0,
              -settings.type.length - 10
            );
          } else {
            settings.type = JAVASCRIPT_MODULE_TYPE_AUTO;
            const resourceDataForRules = matchResourceData || resourceData;
            const result = this.ruleSet.exec({
              resource: resourceDataForRules.path,
              realResource: resourceData.path,
              resourceQuery: resourceDataForRules.query,
              resourceFragment: resourceDataForRules.fragment,
              scheme,
              assertions,
              mimetype: matchResourceData
                ? ""
                : resourceData.data.mimetype || "",
              dependency: dependencyType,
              descriptionData: matchResourceData
                ? undefined
                : resourceData.data.descriptionFileData,
              issuer: contextInfo.issuer,
              compiler: contextInfo.compiler,
              issuerLayer: contextInfo.issuerLayer || "",
            });
            for (const r of result) {
              // https://github.com/webpack/webpack/issues/16466
              // if a request exists PrePostAutoLoaders, should disable modifying Rule.type
              if (r.type === "type" && noPrePostAutoLoaders) {
                continue;
              }
              if (r.type === "use") {
                if (!noAutoLoaders && !noPrePostAutoLoaders) {
                  useLoaders.push(r.value);
                }
              } else if (r.type === "use-post") {
                if (!noPrePostAutoLoaders) {
                  useLoadersPost.push(r.value);
                }
              } else if (r.type === "use-pre") {
                if (!noPreAutoLoaders && !noPrePostAutoLoaders) {
                  useLoadersPre.push(r.value);
                }
              } else if (
                typeof r.value === "object" &&
                r.value !== null &&
                typeof settings[
                  /** @type {keyof ModuleSettings} */ (r.type)
                ] === "object" &&
                settings[/** @type {keyof ModuleSettings} */ (r.type)] !== null
              ) {
                settings[r.type] = cachedCleverMerge(
                  settings[/** @type {keyof ModuleSettings} */ (r.type)],
                  r.value
                );
              } else {
                settings[r.type] = r.value;
              }
            }
          }

          /** @type {undefined | LoaderItem[]} */
          let postLoaders;
          /** @type {undefined | LoaderItem[]} */
          let normalLoaders;
          /** @type {undefined | LoaderItem[]} */
          let preLoaders;

          const continueCallback = needCalls(3, (err) => {
            if (err) {
              return callback(err);
            }
            const allLoaders = /** @type {LoaderItem[]} */ (postLoaders);
            if (matchResourceData === undefined) {
              for (const loader of /** @type {LoaderItem[]} */ (loaders))
                allLoaders.push(loader);
              for (const loader of /** @type {LoaderItem[]} */ (normalLoaders))
                allLoaders.push(loader);
            } else {
              for (const loader of /** @type {LoaderItem[]} */ (normalLoaders))
                allLoaders.push(loader);
              for (const loader of /** @type {LoaderItem[]} */ (loaders))
                allLoaders.push(loader);
            }
            for (const loader of /** @type {LoaderItem[]} */ (preLoaders))
              allLoaders.push(loader);
            const type = /** @type {string} */ (settings.type);
            const resolveOptions = settings.resolve;
            const layer = settings.layer;
            if (layer !== undefined && !layers) {
              return callback(
                new Error(
                  "'Rule.layer' is only allowed when 'experiments.layers' is enabled"
                )
              );
            }
            try {
              Object.assign(data.createData, {
                layer:
                  layer === undefined ? contextInfo.issuerLayer || null : layer,
                request: stringifyLoadersAndResource(
                  allLoaders,
                  resourceData.resource
                ),
                userRequest,
                rawRequest: request,
                loaders: allLoaders,
                resource: resourceData.resource,
                context:
                  resourceData.context || getContext(resourceData.resource),
                matchResource: matchResourceData
                  ? matchResourceData.resource
                  : undefined,
                resourceResolveData: resourceData.data,
                settings,
                type,
                parser: this.getParser(type, settings.parser),
                parserOptions: settings.parser,
                generator: this.getGenerator(type, settings.generator),
                generatorOptions: settings.generator,
                resolveOptions,
              });
            } catch (createDataErr) {
              return callback(/** @type {Error} */ (createDataErr));
            }
            callback();
          });
          this.resolveRequestArray(
            contextInfo,
            this.context,
            useLoadersPost,
            loaderResolver,
            resolveContext,
            (err, result) => {
              postLoaders = result;
              continueCallback(err);
            }
          );
          this.resolveRequestArray(
            contextInfo,
            this.context,
            useLoaders,
            loaderResolver,
            resolveContext,
            (err, result) => {
              normalLoaders = result;
              continueCallback(err);
            }
          );
          this.resolveRequestArray(
            contextInfo,
            this.context,
            useLoadersPre,
            loaderResolver,
            resolveContext,
            (err, result) => {
              preLoaders = result;
              continueCallback(err);
            }
          );
        });

        this.resolveRequestArray(
          contextInfo,
          contextScheme ? this.context : context,
          /** @type {LoaderItem[]} */ (elements),
          loaderResolver,
          resolveContext,
          (err, result) => {
            if (err) return continueCallback(err);
            loaders = result;
            continueCallback();
          }
        );

        /**
         * @param {string} context context
         */
        const defaultResolve = (context) => {
          if (/^($|\?)/.test(unresolvedResource)) {
            resourceData = {
              resource: unresolvedResource,
              data: {},
              ...cacheParseResource(unresolvedResource),
            };
            continueCallback();
          }

          // resource without scheme and with path
          else {
            const normalResolver = this.getResolver(
              "normal",
              dependencyType
                ? cachedSetProperty(
                    resolveOptions || EMPTY_RESOLVE_OPTIONS,
                    "dependencyType",
                    dependencyType
                  )
                : resolveOptions
            );
            this.resolveResource(
              contextInfo,
              context,
              unresolvedResource,
              normalResolver,
              resolveContext,
              (err, _resolvedResource, resolvedResourceResolveData) => {
                if (err) return continueCallback(err);
                if (_resolvedResource !== false) {
                  const resolvedResource =
                    /** @type {string} */
                    (_resolvedResource);
                  resourceData = {
                    resource: resolvedResource,
                    data:
                      /** @type {ResolveRequest} */
                      (resolvedResourceResolveData),
                    ...cacheParseResource(resolvedResource),
                  };
                }
                continueCallback();
              }
            );
          }
        };

        // resource with scheme
        if (scheme) {
          resourceData = {
            resource: unresolvedResource,
            data: {},
            path: undefined,
            query: undefined,
            fragment: undefined,
            context: undefined,
          };
          this.hooks.resolveForScheme
            .for(scheme)
            .callAsync(resourceData, data, (err) => {
              if (err) return continueCallback(err);
              continueCallback();
            });
        }

        // resource within scheme
        else if (contextScheme) {
          resourceData = {
            resource: unresolvedResource,
            data: {},
            path: undefined,
            query: undefined,
            fragment: undefined,
            context: undefined,
          };
          this.hooks.resolveInScheme
            .for(contextScheme)
            .callAsync(resourceData, data, (err, handled) => {
              if (err) return continueCallback(err);
              if (!handled) return defaultResolve(this.context);
              continueCallback();
            });
        }

        // resource without scheme and without path
        else defaultResolve(context);
      }
    );
  }
}

module.exports = NormalModuleFactory;
