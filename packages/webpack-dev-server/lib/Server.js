const ipaddr = require("ipaddr.js");

const { validate } = require("schema-utils");
const schema = require("./options.json");

const memoize = (fn) => {
  let cache = false;
  let result;

  return () => {
    if (cache) {
      return result;
    }

    result = fn();
    cache = true;
    fn = undefined;

    return result;
  };
};

const getExpress = memoize(() => require("express"));

class Server {
  /**
   * @param {Configuration<A, S>} options 配置对象，用于自定义开发服务器的行为
   * @param {Compiler | MultiCompiler} compiler Webpack 编译器实例，用于与 Webpack 的编译过程进行交互
   */
  constructor(options = {}, compiler) {
    // 对 options 参数进行验证
    validate(schema, options, {
      name: "Dev Server",
      baseDataPath: "options",
    });

    // 保存编译器实例，已供后续使用
    this.compiler = compiler;
    // 日志初始化
    this.logger = this.compiler.getInfrastructureLogger("webpack-dev-server");
    this.options = options;
    /**
     * 用于存储 FSWatcher 实例，用于监视文件系统的更改，以便在静态文件发生变化时做出响应
     * @type {FSWatcher[]}
     */
    this.staticWatchers = [];
    /**
     * 用于存储事件监听器，
     * 每个监听器包含 name 和 listener，其中 name 是事件名称，listener 是监听函数
     * @private
     * @type {{ name: string | symbol, listener: (...args: any[]) => void}[] }}
     */
    this.listeners = [];
    // Keep track of websocket proxies for external websocket upgrade.
    /**
     * 用于存储 WebSocket 代理，用于在 WebSocket 升级过程中处理外部 WebSocket 代理的请求
     *
     * 热更新使用 websocket 实现
     * @private
     * @type {RequestHandler[]}
     */
    this.webSocketProxies = [];
    /**
     * 存储客户端的 WebSocket 连接
     * @type {Socket[]}
     */
    this.sockets = [];
    /**
     * 保存当前的编译哈希值，该哈希通常用于标识当前的编译版本
     * 利用此哈希检测文件是否变化，并触发客户端更新
     * @private
     * @type {string | undefined}
     */
    this.currentHash = undefined;
  }

  /**
   * 用于判断给定的 URL 字符串是否是绝对路径
   */
  static isAbsoluteURL(URL) {
    // 正则表达式检查是否符合 Windows 文件路径的格式，例如 C:\ 或 D:\
    // 如果是 Windows 文件路径格式，直接返回 false，因为这是一个本地路径而不是 URL
    if (/^[a-zA-Z]:\\/.test(URL)) {
      return false;
    }

    // Scheme: https://tools.ietf.org/html/rfc3986#section-3.1
    // Absolute URL: https://tools.ietf.org/html/rfc3986#section-4.3
    /**
     * 正则表达式匹配是否是 URL 的“协议”部分，即判断 URL 是否以 [协议名]: 开头
     */
    return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(URL);
  }

  /**
   * 用于查找或创建 webpack-dev-server 的缓存目录
   * @returns {string}
   */
  static findCacheDir() {
    // 获取当前的工作目录路径,即执行到这里代码的起始目录
    const cwd = process.cwd();

    /** 初始化 dir 为当前目录，后续用于循环递归查找 package.json 文件 */
    let dir = cwd;

    // 无限循环，递归向上查找
    for (;;) {
      try {
        if (fs.statSync(path.join(dir, "package.json")).isFile()) break;
        // eslint-disable-next-line no-empty
      } catch (e) {}

      const parent = path.dirname(dir);

      if (dir === parent) {
        // eslint-disable-next-line no-undefined
        dir = undefined;
        break;
      }

      dir = parent;
    }

    // 退出训话，要么是找到了，要么是找到了顶层目录（此时 dir 为 undefined）

    if (!dir) {
      // 这说明找到了顶层目录，在工作目录下面添加缓存目录
      return path.resolve(cwd, ".cache/webpack-dev-server");
    } else if (process.versions.pnp === "1") {
      // 这里都是找到了 缓存目录，只不过根据 yarn 的 pnp 版本的不同做不同的缓存目录处理
      return path.resolve(dir, ".pnp/.cache/webpack-dev-server");
    } else if (process.versions.pnp === "3") {
      return path.resolve(dir, ".yarn/.cache/webpack-dev-server");
    }

    // 如果都不满足，则缓存在 node_modules 下
    return path.resolve(dir, "node_modules/.cache/webpack-dev-server");
  }

  /**
   * 用于判断给定的 compiler（编译器）对象的编译目标是否为 Web 平台
   * @private
   * @param {Compiler} compiler
   * @returns bool
   */
  static isWebTarget(compiler) {
    // 编译器实例中明确定义了 web 且为true 则返回这个
    if (compiler.platform && compiler.platform.web) {
      return compiler.platform.web;
    }

    //  TODO改进下一个主要版本，只保留‘ webTargets ’回退到旧版本
    if (
      // 这说明已经明确配置为 web
      compiler.options.externalsPresets &&
      compiler.options.externalsPresets.web
    ) {
      return true;
    }

    if (
      // 包含浏览器，也说明是 web
      compiler.options.resolve.conditionNames &&
      compiler.options.resolve.conditionNames.includes("browser")
    ) {
      return true;
    }

    // 包含一些 Web 相关的编译目标
    const webTargets = [
      "web",
      "webworker",
      "electron-preload",
      "electron-renderer",
      "nwjs",
      "node-webkit",
      // eslint-disable-next-line no-undefined
      undefined,
      null,
    ];

    if (Array.isArray(compiler.options.target)) {
      return compiler.options.target.some((r) => webTargets.includes(r));
    }

    return webTargets.includes(compiler.options.target);
  }

  static get schema() {
    return schema;
  }

  /**
   * @returns {Promise<void>}
   */
  async start() {
    await this.normalizeOptions();

    if (this.options.ipc) {
      // ipc 启用
      await new Promise((resolve, reject) => {
        const net = require("net");
        // 创建 socket 实例，用于 IPC 连接
        const socket = new net.Socket();

        // 监听错误
        socket.on(
          "error",
          /**
           * @param {Error & { code?: string }} error
           */
          (error) => {
            if (error.code === "ECONNREFUSED") {
              // 错误代码是 ECONNREFUSED，说明没有其他服务器在该套接字路径上监听
              // 可以安全地删除。
              fs.unlinkSync(this.options.ipc);

              resolve();

              return;
            } else if (error.code === "ENOENT") {
              // 错误代码是 ENOENT，表示指定的套接字文件不存在
              resolve();

              return;
            }

            // 对于其他情况，标记为错误的promise，表示发生了意外
            reject(error);
          }
        );

        // 尝试连接指定路径的套接字
        socket.connect({ path: this.options.ipc }, () => {
          // 当连接成功时抛出一个错误，通知开发者或系统，指定的 IPC 套接字路径已经被其他进程使用
          // 为了防止多个进程同时使用同一个 IPC 套接字，从而避免数据冲突和不一致性
          throw new Error(`IPC "${this.options.ipc}" is already used`);
        });
      });
    } else {
      this.options.host = await Server.getHostname(this.options.host);
      this.options.port = await Server.getFreePort(
        this.options.port,
        this.options.host
      );
    }

    await this.initialize();

    // 如果 ipc 存在，则使用路径（用于 IPC 连接）
    // 如果不存在，则使用主机和端口（通常用于网络连接）
    const listenOptions = this.options.ipc
      ? { path: this.options.ipc }
      : { host: this.options.host, port: this.options.port };

    await new Promise((resolve) => {
      this.server.listen(listenOptions, () => {
        resolve();
      });
    });

    // 如果使用的是IPC，设置该 IPC 套接字的权限为 666（读写权限）
    if (this.options.ipc) {
      // chmod 666 (rw rw rw)
      const READ_WRITE = 438;

      await fs.promises.chmod(this.options.ipc, READ_WRITE);
    }

    // 如果配置了 webSocketServer 创建 WebSocket 服务器
    if (this.options.webSocketServer) {
      this.createWebSocketServer();
    }

    // 配置了 bonjour（广播）
    if (this.options.bonjour) {
      this.runBonjour();
    }

    // 调用 logStatus 方法以记录服务器的状态
    await this.logStatus();

    // 如果存在 onListening 且为函数，调用它
    // 让用户在服务器成功启动后执行自定义操作，例如更新 UI、发送通知等
    if (typeof this.options.onListening === "function") {
      this.options.onListening(this);
    }
  }

  /**
   * @param {(err?: Error) => void} [callback]
   */
  startCallback(callback = () => {}) {
    this.start()
      .then(() => callback(), callback)
      .catch(callback);
  }

  /**
   * 对传入的服务器配置选项options进行标准化和预处理，
   * 确保不同的配置选项格式或未定义的选项有合理的默认值，从而确保服务器的运行稳定性和兼容性
   * @private
   * @returns {Promise<void>}
   */
  async normalizeOptions() {
    // 提取用户配置
    const { options } = this;
    // 获取编译器相关的选项
    const compilerOptions = this.getCompilerOptions();
    // watch 配置
    const compilerWatchOptions = compilerOptions.watchOptions;
    /**
     * 用于生成watch配置，包含轮询频率、轮询方式、忽略选项等属性
     * 传递给 chokidar 用于文件变更监视
     */
    const getWatchOptions = (watchOptions = {}) => {
      // 确定是否启用轮询（polling）方式
      const getPolling = () => {
        // 配置项优先决定
        if (typeof watchOptions.usePolling !== "undefined") {
          return watchOptions.usePolling;
        }

        if (typeof watchOptions.poll !== "undefined") {
          return Boolean(watchOptions.poll);
        }

        // 编译器配置中的轮询
        if (typeof compilerWatchOptions.poll !== "undefined") {
          return Boolean(compilerWatchOptions.poll);
        }

        // 以上都不满足,默认不开启轮询
        return false;
      };

      // 获取轮询的时间间隔
      const getInterval = () => {
        if (typeof watchOptions.interval !== "undefined") {
          return watchOptions.interval;
        }

        if (typeof watchOptions.poll === "number") {
          return watchOptions.poll;
        }

        if (typeof compilerWatchOptions.poll === "number") {
          return compilerWatchOptions.poll;
        }

        // 如果没有设定，返回 undefined，表示不设置轮询间隔
      };

      const usePolling = getPolling();
      const interval = getInterval();
      const { poll, ...rest } = watchOptions;

      return {
        ignoreInitial: true,
        persistent: true, // 持续监视
        followSymlinks: false,
        atomic: false,
        alwaysStat: true,
        ignorePermissionErrors: true,
        // 是否开启轮询及轮询间隔
        usePolling,
        interval,
        ignored: watchOptions.ignored,
        // TODO: we respect these options for all watch options and allow developers to pass them to chokidar, but chokidar doesn't have these options maybe we need revisit that in future
        ...rest,
      };
    };
    /**
     * 生成静态资源服务的配置，主要用于处理静态资源的访问路径
     */
    const getStaticItem = (optionsForStatic) => {
      const getDefaultStaticOptions = () => {
        return {
          //  静态资源的目录，默认指向项目根目录下的 public 文件夹
          directory: path.join(process.cwd(), "public"),
          staticOptions: {}, // 静态资源的额外选项
          publicPath: ["/"], // 静态资源的公开路径，默认 "/"
          serveIndex: { icons: true }, // 是否显示文件目录，默认包含图标
          watch: getWatchOptions(), // 文件监视选项
        };
      };

      /** @type {NormalizedStatic} */
      let item;

      if (typeof optionsForStatic === "undefined") {
        // 返回默认静态资源配置
        item = getDefaultStaticOptions();
      } else if (typeof optionsForStatic === "string") {
        item = {
          ...getDefaultStaticOptions(),
          // 覆盖默认的目录
          directory: optionsForStatic,
        };
      } else {
        const def = getDefaultStaticOptions();

        item = {
          directory:
            typeof optionsForStatic.directory !== "undefined"
              ? optionsForStatic.directory
              : def.directory,
          staticOptions:
            typeof optionsForStatic.staticOptions !== "undefined"
              ? { ...def.staticOptions, ...optionsForStatic.staticOptions }
              : def.staticOptions,
          publicPath:
            // eslint-disable-next-line no-nested-ternary
            typeof optionsForStatic.publicPath !== "undefined"
              ? Array.isArray(optionsForStatic.publicPath)
                ? optionsForStatic.publicPath
                : [optionsForStatic.publicPath]
              : def.publicPath,
          serveIndex:
            // Check if 'serveIndex' property is defined in 'optionsForStatic'
            // If 'serveIndex' is a boolean and true, use default 'serveIndex'
            // If 'serveIndex' is an object, merge its properties with default 'serveIndex'
            // If 'serveIndex' is neither a boolean true nor an object, use it as-is
            // If 'serveIndex' is not defined in 'optionsForStatic', use default 'serveIndex'
            // eslint-disable-next-line no-nested-ternary
            typeof optionsForStatic.serveIndex !== "undefined"
              ? // eslint-disable-next-line no-nested-ternary
                typeof optionsForStatic.serveIndex === "boolean" &&
                optionsForStatic.serveIndex
                ? def.serveIndex
                : typeof optionsForStatic.serveIndex === "object"
                  ? { ...def.serveIndex, ...optionsForStatic.serveIndex }
                  : optionsForStatic.serveIndex
              : def.serveIndex,
          watch:
            // eslint-disable-next-line no-nested-ternary
            typeof optionsForStatic.watch !== "undefined"
              ? // eslint-disable-next-line no-nested-ternary
                typeof optionsForStatic.watch === "boolean"
                ? optionsForStatic.watch
                  ? def.watch
                  : false
                : getWatchOptions(optionsForStatic.watch)
              : def.watch,
        };
      }

      // 如果目录是 URL 格式，抛出错误，因为静态资源目录不支持使用 URL
      if (Server.isAbsoluteURL(item.directory)) {
        throw new Error("Using a URL as static.directory is not supported");
      }

      return item;
    };

    // 如果 allowedHosts 未定义，则默认设为 "auto"
    if (typeof options.allowedHosts === "undefined") {
      // AllowedHosts allows some default hosts picked from `options.host` or `webSocketURL.hostname` and `localhost`
      options.allowedHosts = "auto";
    }
    // We store allowedHosts as array when supplied as string
    else if (
      typeof options.allowedHosts === "string" &&
      options.allowedHosts !== "auto" &&
      options.allowedHosts !== "all"
    ) {
      options.allowedHosts = [options.allowedHosts];
    }
    // CLI pass options as array, we should normalize them
    else if (
      Array.isArray(options.allowedHosts) &&
      options.allowedHosts.includes("all")
    ) {
      options.allowedHosts = "all";
    }

    // bonjour 配置项,广播功能
    if (typeof options.bonjour === "undefined") {
      options.bonjour = false;
    } else if (typeof options.bonjour === "boolean") {
      options.bonjour = options.bonjour ? {} : false;
    }

    // client 配置项
    if (
      typeof options.client === "undefined" ||
      (typeof options.client === "object" && options.client !== null)
    ) {
      if (!options.client) {
        options.client = {};
      }

      if (typeof options.client.webSocketURL === "undefined") {
        options.client.webSocketURL = {};
      } else if (typeof options.client.webSocketURL === "string") {
        // WebSocket 配置

        const parsedURL = new URL(options.client.webSocketURL);

        options.client.webSocketURL = {
          protocol: parsedURL.protocol,
          hostname: parsedURL.hostname,
          port: parsedURL.port.length > 0 ? Number(parsedURL.port) : "",
          pathname: parsedURL.pathname,
          username: parsedURL.username,
          password: parsedURL.password,
        };
      } else if (typeof options.client.webSocketURL.port === "string") {
        options.client.webSocketURL.port = Number(
          options.client.webSocketURL.port
        );
      }

      // overlay 配置项.在客户端显示错误覆盖层
      if (typeof options.client.overlay === "undefined") {
        options.client.overlay = true;
      } else if (typeof options.client.overlay !== "boolean") {
        options.client.overlay = {
          errors: true,
          warnings: true,
          ...options.client.overlay,
        };
      }

      // reconnect 配置项,重连间隔
      if (typeof options.client.reconnect === "undefined") {
        options.client.reconnect = 10;
      } else if (options.client.reconnect === true) {
        // 无限重连
        options.client.reconnect = Infinity;
      } else if (options.client.reconnect === false) {
        // 禁用
        options.client.reconnect = 0;
      }

      // Respect infrastructureLogging.level
      if (typeof options.client.logging === "undefined") {
        options.client.logging = compilerOptions.infrastructureLogging
          ? compilerOptions.infrastructureLogging.level
          : "info";
      }
    }

    // compress 配置项,默认启用响应的压缩功能
    if (typeof options.compress === "undefined") {
      options.compress = true;
    }

    // 用于开发中间件的配置
    if (typeof options.devMiddleware === "undefined") {
      options.devMiddleware = {};
    }

    // 历史模式的回退功能
    if (typeof options.historyApiFallback === "undefined") {
      options.historyApiFallback = false;
    } else if (
      typeof options.historyApiFallback === "boolean" &&
      options.historyApiFallback
    ) {
      options.historyApiFallback = {};
    }

    // 热更新配置,默认是开启
    options.hot =
      typeof options.hot === "boolean" || options.hot === "only"
        ? options.hot
        : true;

    if (
      typeof options.server === "function" ||
      typeof options.server === "string"
    ) {
      options.server = {
        type: options.server,
        options: {},
      };
    } else {
      const serverOptions = options.server || {};

      options.server = {
        type: serverOptions.type || "http",
        options: { ...serverOptions.options },
      };
    }

    const serverOptions = /** @type {ServerOptions} */ (options.server.options);

    // server 配置项
    if (
      options.server.type === "spdy" &&
      typeof serverOptions.spdy === "undefined"
    ) {
      // 指定支持 HTTP/2 和 HTTP/1.1 协议
      serverOptions.spdy = { protocols: ["h2", "http/1.1"] };
    }

    if (
      // 检查服务器类型是否为 HTTPS、HTTP/2 或 SPDY（一个基于 HTTP/2 的协议）
      //  这些协议通常需要额外的 SSL/TLS 配置
      options.server.type === "https" ||
      options.server.type === "http2" ||
      options.server.type === "spdy"
    ) {
      // 控制服务器是否要求客户端提供 SSL 证书,默认不提供
      if (typeof serverOptions.requestCert === "undefined") {
        serverOptions.requestCert = false;
      }

      // 包含 HTTPS 服务器配置所需的 SSL/TLS 属性
      const httpsProperties = ["ca", "cert", "crl", "key", "pfx"];

      // 遍历定义的 SSL/TLS 属性，并检查它们是否已在 serverOptions 中定义
      for (const property of httpsProperties) {
        if (typeof serverOptions[property] === "undefined") {
          continue;
        }

        const value = serverOptions[property];

        // 用于读取 SSL/TLS 证书的文件内容
        const readFile = (item) => {
          if (
            // 如果提供的是 Buffer 或对象则直接返回
            Buffer.isBuffer(item) ||
            (typeof item === "object" && item !== null && !Array.isArray(item))
          ) {
            return item;
          }

          // 如果是路径字符串，则检查其是否为文件并读取
          if (item) {
            let stats = null;

            try {
              stats = fs.lstatSync(fs.realpathSync(item)).isFile();
            } catch (error) {
              // Ignore error
            }

            // It is a file
            return stats ? fs.readFileSync(item) : item;
          }
        };

        serverOptions[property] = Array.isArray(value)
          ? value.map((item) => readFile(item))
          : readFile(value);
      }

      /**
       * 存储生成的自签名 SSL 证书
       * 后续代码中会将生成的证书内容保存在这里，以便在没有提供证书的情况下使用
       */
      let fakeCert;

      // 检查是否提供了 SSL 证书 (key) 和私钥 (cert)，缺少一个就会生成证书
      if (!serverOptions.key || !serverOptions.cert) {
        // 获取存储 SSL 证书的目录路径
        const certificateDir = Server.findCacheDir();
        // 拼接出证书文件的完整路径，命名为 server.pem
        const certificatePath = path.join(certificateDir, "server.pem");

        // 用于标记证书文件是否存在
        let certificateExists;

        try {
          // 尝试获取证书文件的信息
          const certificate = await fs.promises.stat(certificatePath);
          certificateExists = certificate.isFile();
        } catch {
          certificateExists = false;
        }

        // 如果证书存在，定义证书的生存时间（TTL）
        if (certificateExists) {
          const certificateTtl = 1000 * 60 * 60 * 24; // 一天
          const certificateStat = await fs.promises.stat(certificatePath);
          // 获取当前时间的时间戳，以便与证书的创建时间进行比较
          const now = Number(new Date());

          // 如果证书文件的创建时间超过了 30 天，则将其删除
          if ((now - Number(certificateStat.ctime)) / certificateTtl > 30) {
            // 提示用户证书已过期并已被删除
            this.logger.info(
              "SSL certificate is more than 30 days old. Removing..."
            );

            await fs.promises.rm(certificatePath, { recursive: true });

            // 标记证书不存在
            certificateExists = false;
          }
        }

        // 如果证书不存在或者被删除，准备生成新的证书
        if (!certificateExists) {
          this.logger.info("Generating SSL certificate...");

          // 用于生成证书的库
          const selfsigned = require("selfsigned");
          // 定义证书的基本属性
          const attributes = [{ name: "commonName", value: "localhost" }];
          const pems = selfsigned.generate(attributes, {
            algorithm: "sha256", // 签名算法为 SHA-256
            days: 30, // 证书的有效期为 30 天
            keySize: 2048, // 密钥大小设置为 2048 位

            // 包含证书的扩展信息，如基本约束和密钥用法
            extensions: [
              {
                name: "basicConstraints",
                cA: true,
              },
              {
                name: "keyUsage",
                keyCertSign: true,
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true,
              },
              {
                name: "extKeyUsage",
                serverAuth: true,
                clientAuth: true,
                codeSigning: true,
                timeStamping: true,
              },
              {
                name: "subjectAltName",
                altNames: [
                  {
                    // type 2 is DNS
                    type: 2,
                    value: "localhost",
                  },
                  {
                    type: 2,
                    value: "localhost.localdomain",
                  },
                  {
                    type: 2,
                    value: "lvh.me",
                  },
                  {
                    type: 2,
                    value: "*.lvh.me",
                  },
                  {
                    type: 2,
                    value: "[::1]",
                  },
                  {
                    // type 7 is IP
                    type: 7,
                    ip: "127.0.0.1",
                  },
                  {
                    type: 7,
                    ip: "fe80::1",
                  },
                ],
              },
            ],
          });

          // 如果证书存储目录不存在，则创建该目录
          await fs.promises.mkdir(certificateDir, { recursive: true });

          // 将生成的私钥和证书写入到指定路径的文件中
          await fs.promises.writeFile(
            certificatePath,
            pems.private + pems.cert,
            {
              encoding: "utf8",
            }
          );
        }

        //  读取刚刚写入的证书文件内容
        fakeCert = await fs.promises.readFile(certificatePath);

        // 记录生成的证书文件的路径，以便于调试和日志跟踪
        this.logger.info(`SSL certificate: ${certificatePath}`);
      }

      // 如果用户没有提供 SSL 证书和私钥，则使用生成的 fakeCert 作为默认值
      serverOptions.key = serverOptions.key || fakeCert;
      serverOptions.cert = serverOptions.cert || fakeCert;
    }

    // 判断是否启用了进程间通信（IPC）
    // IPC 在 Node.js 中通常用于与其他进程或服务进行通信，适用于跨平台通信场景
    if (typeof options.ipc === "boolean") {
      const isWindows = process.platform === "win32";
      // 根据操作系统选择 IPC 通信的路径前缀
      // Windows 使用 \\\\.\\pipe\\ 作为管道的前缀，其他操作系统则使用临时目录 os.tmpdir()
      const pipePrefix = isWindows ? "\\\\.\\pipe\\" : os.tmpdir();

      // 指定管道文件的名称
      const pipeName = "webpack-dev-server.sock";

      // 转换为 IPC 通信所需的完整路径
      options.ipc = path.join(pipePrefix, pipeName);
    }

    // 控制是否启用 liveReload 功能，在文件更改时自动刷新浏览器，默认为 true
    options.liveReload =
      typeof options.liveReload !== "undefined" ? options.liveReload : true;

    // https://github.com/webpack/webpack-dev-server/issues/1990
    // 定义 open 配置的默认选项, wait: false 指定在启动服务器后不等待浏览器完全加载 URL
    const defaultOpenOptions = { wait: false };
    /**
     * 用于处理和格式化 open 配置项
     * @param {*} param.target 需要打开的 URL 或路径
     */
    const getOpenItemsFromObject = ({ target, ...rest }) => {
      // 合并配置项
      const normalizedOptions = { ...defaultOpenOptions, ...rest };

      // 如果 app 选项为字符串，则将其转换为对象格式
      if (typeof normalizedOptions.app === "string") {
        normalizedOptions.app = {
          name: normalizedOptions.app,
        };
      }

      // 如果 target 未定义则使用默认的占位符
      const normalizedTarget = typeof target === "undefined" ? "<url>" : target;

      // 为数组，表示有多个目标需要打开，遍历该数组并为每个目标创建一个配置项对象
      if (Array.isArray(normalizedTarget)) {
        return normalizedTarget.map((singleTarget) => {
          return { target: singleTarget, options: normalizedOptions };
        });
      }

      // 不是数组，返回一个包含单一目标的数组对象
      return [{ target: normalizedTarget, options: normalizedOptions }];
    };

    // open 未定义，则初始化空数组，不自动打开任何url
    if (typeof options.open === "undefined") {
      options.open = [];
    } else if (typeof options.open === "boolean") {
      // 设置为一个包含单个对象的数组
      options.open = options.open
        ? [
            {
              target: "<url>",
              options: defaultOpenOptions,
            },
          ]
        : [];
    } else if (typeof options.open === "string") {
      // 为字符串时，这里假设就是url
      options.open = [{ target: options.open, options: defaultOpenOptions }];
    } else if (Array.isArray(options.open)) {
      const result = [];

      for (const item of options.open) {
        if (typeof item === "string") {
          result.push({ target: item, options: defaultOpenOptions });
          continue;
        }

        // 处理对象
        result.push(...getOpenItemsFromObject(item));
      }

      options.open = result;
    } else {
      options.open = [...getOpenItemsFromObject(options.open)];
    }

    // 将端口号转为数字
    if (typeof options.port === "string" && options.port !== "auto") {
      options.port = Number(options.port);
    }

    /**
     * Assume a proxy configuration specified as:
     * proxy: {
     *   'context': { options }
     * }
     * OR
     * proxy: {
     *   'context': 'target'
     * }
     *
     * 配置 http 代理
     */
    if (typeof options.proxy !== "undefined") {
      // 为每个代理项设置日志级别
      options.proxy = options.proxy.map((item) => {
        if (typeof item === "function") {
          return item;
        }

        /**
         * @param {"info" | "warn" | "error" | "debug" | "silent" | undefined | "none" | "log" | "verbose"} level
         * @returns {"info" | "warn" | "error" | "debug" | "silent" | undefined}
         */
        const getLogLevelForProxy = (level) => {
          if (level === "none") {
            return "silent";
          }

          if (level === "log") {
            return "info";
          }

          if (level === "verbose") {
            return "debug";
          }

          return level;
        };

        if (typeof item.logLevel === "undefined") {
          item.logLevel = getLogLevelForProxy(
            compilerOptions.infrastructureLogging
              ? compilerOptions.infrastructureLogging.level
              : "info"
          );
        }

        if (typeof item.logProvider === "undefined") {
          item.logProvider = () => this.logger;
        }

        return item;
      });
    }

    // 指示是否在进程退出时自动清理资源 默认为 true
    if (typeof options.setupExitSignals === "undefined") {
      options.setupExitSignals = true;
    }

    // 静态文件服务 配置项
    if (typeof options.static === "undefined") {
      options.static = [getStaticItem()];
    } else if (typeof options.static === "boolean") {
      options.static = options.static ? [getStaticItem()] : false;
    } else if (typeof options.static === "string") {
      options.static = [getStaticItem(options.static)];
    } else if (Array.isArray(options.static)) {
      options.static = options.static.map((item) => getStaticItem(item));
    } else {
      options.static = [getStaticItem(options.static)];
    }

    // watchFiles 用于定义要监听的文件路径，监听到文件变更后会触发重新编译

    if (typeof options.watchFiles === "string") {
      options.watchFiles = [
        { paths: options.watchFiles, options: getWatchOptions() },
      ];
    } else if (
      // 为对象
      typeof options.watchFiles === "object" &&
      options.watchFiles !== null &&
      !Array.isArray(options.watchFiles)
    ) {
      options.watchFiles = [
        {
          paths: options.watchFiles.paths,
          options: getWatchOptions(options.watchFiles.options || {}),
        },
      ];
    } else if (Array.isArray(options.watchFiles)) {
      options.watchFiles = options.watchFiles.map((item) => {
        if (typeof item === "string") {
          return { paths: item, options: getWatchOptions() };
        }

        return {
          paths: item.paths,
          options: getWatchOptions(item.options || {}),
        };
      });
    } else {
      // 设置为空数组，表示不监听任何文件
      options.watchFiles = [];
    }

    // ws server 配置
    const defaultWebSocketServerType = "ws";
    const defaultWebSocketServerOptions = { path: "/ws" };

    if (typeof options.webSocketServer === "undefined") {
      options.webSocketServer = {
        type: defaultWebSocketServerType,
        options: defaultWebSocketServerOptions,
      };
    } else if (
      typeof options.webSocketServer === "boolean" &&
      !options.webSocketServer
    ) {
      // 不启用 WebSocket 服务器
      options.webSocketServer = false;
    } else if (
      typeof options.webSocketServer === "string" ||
      typeof options.webSocketServer === "function"
    ) {
      options.webSocketServer = {
        type: options.webSocketServer,
        options: defaultWebSocketServerOptions,
      };
    } else {
      options.webSocketServer = {
        type: options.webSocketServer.type || defaultWebSocketServerType,
        options: {
          ...defaultWebSocketServerOptions,
          .../** @type {WebSocketServerConfiguration} */
          (options.webSocketServer).options,
        },
      };

      const webSocketServer = options.webSocketServer;

      if (typeof webSocketServer.options.port === "string") {
        webSocketServer.options.port = Number(webSocketServer.options.port);
      }
    }
  }

  /**
   * 根据指定的条件找到本机的 IP 地址
   * @param {string} gatewayOrFamily IP 地址族（"v4" 或 "v6"）或者一个网关 IP
   * @param {boolean} [isInternal] 内部（true）还是外部（false） IP 地址
   * @returns {string | undefined}
   */
  static findIp(gatewayOrFamily, isInternal) {
    // ip 地址族
    if (gatewayOrFamily === "v4" || gatewayOrFamily === "v6") {
      let host;

      const networks = Object.values(os.networkInterfaces())
        .flatMap((networks) => networks ?? [])
        .filter((network) => {
          if (!network || !network.address) {
            return false;
          }

          if (network.family !== `IP${gatewayOrFamily}`) {
            return false;
          }

          if (
            typeof isInternal !== "undefined" &&
            network.internal !== isInternal
          ) {
            return false;
          }

          if (gatewayOrFamily === "v6") {
            const range = ipaddr.parse(network.address).range();

            if (
              range !== "ipv4Mapped" &&
              range !== "uniqueLocal" &&
              range !== "loopback"
            ) {
              return false;
            }
          }

          return network.address;
        });

      for (const network of networks) {
        host = network.address;

        if (host.includes(":")) {
          host = `[${host}]`;
        }
      }

      return host;
    }

    const gatewayIp = ipaddr.parse(gatewayOrFamily);

    // Look for the matching interface in all local interfaces.
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const { cidr } of /** @type {NetworkInterfaceInfo[]} */ (
        addresses
      )) {
        const net = ipaddr.parseCIDR(/** @type {string} */ (cidr));

        if (
          net[0] &&
          net[0].kind() === gatewayIp.kind() &&
          gatewayIp.match(net)
        ) {
          return net[0].toString();
        }
      }
    }
  }

  /**
   * 确定主机名
   * @param {Host} hostname
   * @returns {Promise<string>}
   */
  static async getHostname(hostname) {
    // 优先尝试查找本地 IPv4 地址，找不到则查找本地 IPv6 地址，"0.0.0.0"（表示使用所有可用网络接口）
    if (hostname === "local-ip") {
      return (
        Server.findIp("v4", false) || Server.findIp("v6", false) || "0.0.0.0"
      );
    } else if (hostname === "local-ipv4") {
      return Server.findIp("v4", false) || "0.0.0.0";
    } else if (hostname === "local-ipv6") {
      return Server.findIp("v6", false) || "::";
    }

    // 如果 hostname 是其他值，则直接返回该值
    return hostname;
  }

  /**
   * 查找可用端口
   * @param {Port} port
   * @param {string} host
   * @returns {Promise<number | string>}
   */
  static async getFreePort(port, host) {
    if (typeof port !== "undefined" && port !== null && port !== "auto") {
      // 直接返回该端口，表示使用用户指定的端口
      return port;
    }

    // 这里使用esm导入
    /**
     * p-retry 是一个用于在异步操作失败时进行重试的库，非常适用于处理网络请求或其他可能偶尔失败的任务
     * 这个库可以捕捉错误，并在设定的重试次数或时间限制内多次尝试执行指定的操作，以提高成功率
     */
    const pRetry = (await import("p-retry")).default;
    const getPort = require("./getPort");

    // 默认8080 如果 环境变量中有指定，则使用指定的
    const basePort =
      typeof process.env.WEBPACK_DEV_SERVER_BASE_PORT !== "undefined"
        ? parseInt(process.env.WEBPACK_DEV_SERVER_BASE_PORT, 10)
        : 8080;

    // 重试次数，默认3次
    const defaultPortRetry =
      typeof process.env.WEBPACK_DEV_SERVER_PORT_RETRY !== "undefined"
        ? parseInt(process.env.WEBPACK_DEV_SERVER_PORT_RETRY, 10)
        : 3;

    return pRetry(() => getPort(basePort, host), {
      retries: defaultPortRetry,
    });
  }

  /**
   * 负责初始化一个 Webpack 开发服务器
   * @private
   * @returns {Promise<void>}
   */
  async initialize() {
    // 注册钩子函数
    this.setupHooks();

    // 初始化
    await this.setupApp();
    // 启动一个 Web 服务器
    await this.createServer();

    // 设置 ws 服务器
    if (this.options.webSocketServer) {
      const compilers =
        /** @type {MultiCompiler} */
        (this.compiler).compilers || [this.compiler];

      for (const compiler of compilers) {
        if (compiler.options.devServer === false) {
          continue;
        }

        // 向编译器添加某些特定的条目（entry），如 HMR（热模块替换）客户端
        this.addAdditionalEntries(compiler);

        // 获取 Webpack 实例
        const webpack = compiler.webpack || require("webpack");

        // 应用 ProvidePlugin
        // 将 __webpack_dev_server_client__ 注入到每个模块中，
        // 以便在模块中使用 Webpack 开发服务器客户端
        new webpack.ProvidePlugin({
          __webpack_dev_server_client__: this.getClientTransport(),
        }).apply(compiler);

        // 开启了热更新
        if (this.options.hot) {
          // 检查编译器中是否已存在 HMR 插件
          const HMRPluginExists = compiler.options.plugins.find(
            (p) => p && p.constructor === webpack.HotModuleReplacementPlugin
          );

          // 如果存在，输出警告信息
          if (HMRPluginExists) {
            this.logger.warn(
              `"hot: true" automatically applies HMR plugin, you don't have to add it manually to your webpack configuration.`
            );
          } else {
            // 创建并应用 热更新插件
            const plugin = new webpack.HotModuleReplacementPlugin();

            plugin.apply(compiler);
          }
        }
      }

      if (
        // 如果存在客户端配置且启用了进度显示
        this.options.client &&
        this.options.client.progress
      ) {
        // 在编译时显示进度条
        this.setupProgressPlugin();
      }
    }

    // 监视源文件的变化
    this.setupWatchFiles();
    // 监视静态文件变化
    this.setupWatchStaticFiles();
    // 设置服务器中间件，处理请求和响应
    this.setupMiddlewares();

    // 注册对系统信号（如 SIGINT 和 SIGTERM）的监听器，以便在收到这些信号时优雅地关闭服务器
    if (this.options.setupExitSignals) {
      /**
       * 这里包含了两个常用的退出信号
       * - SIGINT：通常是 Ctrl + C 触发的中断信号
       * - SIGTERM：用于请求程序终止的信号
       */
      const signals = ["SIGINT", "SIGTERM"];

      /** 是否需要强制关闭 */
      let needForceShutdown = false;

      // 对每个信号注册一个监听器
      signals.forEach((signal) => {
        const listener = () => {
          // 强制关闭
          if (needForceShutdown) {
            process.exit();
          }

          // 记录日志，表示正在优雅地关闭服务器
          this.logger.info(
            "Gracefully shutting down. To force exit, press ^C again. Please wait..."
          );

          // 表明后续再收到信号就会强制退出
          needForceShutdown = true;

          this.stopCallback(() => {
            if (typeof this.compiler.close === "function") {
              // 关闭编译器，在编译器关闭的回调中退出进程
              this.compiler.close(() => {
                process.exit();
              });
            } else {
              // 直接退出进程
              process.exit();
            }
          });
        };

        // 存储到事件监听器数组中，以便后续可能的管理
        this.listeners.push({ name: signal, listener });

        // 注册信号监听器
        process.on(signal, listener);
      });
    }

    /**
     * 这里是在 WebSocket 的初始 HTTP 请求之外处理 WebSocket 升级
     * WebSocket 连接需要在 HTTP 连接基础上进行升级，使用 upgrade 事件
     *
     * https://github.com/chimurai/http-proxy-middleware#external-websocket-upgrade
     */

    // 一组处理 WebSocket 请求的代理
    const webSocketProxies = this.webSocketProxies;

    for (const webSocketProxy of webSocketProxies) {
      // 在服务器上注册 upgrade 事件监听器，调用代理的 upgrade 方法
      // 会处理 WebSocket 升级请求，将其转发到相应的 WebSocket 代理中
      this.server.on(
        "upgrade",
        /** @type {RequestHandler & { upgrade: NonNullable<RequestHandler["upgrade"]> }} */
        (webSocketProxy).upgrade
      );
    }
  }

  /**
   * 负责将 Webpack 编译过程中的一些钩子与 WebSocket 服务器的消息传递功能关联起来
   */
  setupHooks() {
    // 当 Webpack 编译过程中检测到文件无效触发
    this.compiler.hooks.invalid.tap("webpack-dev-server", () => {
      // 当文件无效时，检查是否存在 WebSocket 服务器
      if (this.webSocketServer) {
        // 发送一条消息给所有连接的 WebSocket 客户端
        // 告知客户端，当前的构建已经失效，需要重新获取新的构建结果
        this.sendMessage(this.webSocketServer.clients, "invalid");
      }
    });

    // 当 Webpack 编译完成时会触发
    this.compiler.hooks.done.tap(
      "webpack-dev-server",
      /**
       * @param {Stats | MultiStats} stats 表示编译的统计信息
       */
      (stats) => {
        if (this.webSocketServer) {
          // 将当前的构建统计信息发送给所有连接的 WebSocket 客户端
          // 使用 getStats(stats) 方法提取和格式化要发送的数据
          this.sendStats(this.webSocketServer.clients, this.getStats(stats));
        }

        /**
         * 将编译的统计信息保存到 this.stats 属性中，供后续使用
         * @private
         * @type {Stats | MultiStats}
         */
        this.stats = stats;
      }
    );
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async setupApp() {
    /** @type {A | undefined}*/
    this.app =
      typeof this.options.app === "function"
        ? await this.options.app()
        : getExpress()();
  }

  /**
   * 根据配置创建一个服务器实例(http、https)。它支持多种服务器类型，并且会在服务器启动时设置必要的事件监听器
   * @private
   * @returns {Promise<void>}
   */
  async createServer() {
    // 提取配置
    const { type, options } = this.options.server;

    if (typeof type === "function") {
      // 直接调用这个函数来创建服务器实例
      this.server = await type(options, this.app);
    } else {
      // 动态导入服务器模块
      // type为 http、http2
      const serverType = require(type);

      this.server =
        type === "http2"
          ? //  创建支持 HTTP/2 的安全服务器
            serverType.createSecureServer(
              // 支持 HTTP/1.x
              { ...options, allowHTTP1: true },
              this.app
            )
          : // 创建普通的 HTTP 服务器
            serverType.createServer(options, this.app);
    }

    // 检查创建的服务器是否支持 TLS（Transport Layer Security）
    /**
     * TLS 是一种加密协议，用于在网络通信中提供安全性，确保数据在传输过程中不被窃取或篡改
     * TLS 服务器通常用于实现 HTTPS（安全超文本传输协议），为 Web 应用程序提供安全的通信通道
     *
     * TLS 在三次握手的基础上 加了四次 tls 握手，用于加密
     * - TLS 使用对称加密和非对称加密技术来保护数据
     * - 而非对称加密用于在连接建立阶段交换密钥
     */
    this.isTlsServer = typeof this.server.setSecureContext !== "undefined";

    // 监听连接事件，当有新的客户端连接时触发回调
    this.server.on(
      "connection",
      /**
       * @param {Socket} socket
       */
      (socket) => {
        // 将新连接的 socket 添加到列表中，以便跟踪当前活动的连接
        this.sockets.push(socket);

        // 监听连接关闭事件，在关闭的时候，删除列表中对应的引用
        socket.once("close", () => {
          this.sockets.splice(this.sockets.indexOf(socket), 1);
        });
      }
    );

    // 监听错误事件
    this.server.on("error", (error) => {
      throw error;
    });
  }

  /**
   * 主要用于向 Webpack 编译器添加额外的入口
   * 重点关注如何构建 WebSocket 连接的 URL，以及如何根据配置动态调整入口
   * @private
   * @param {Compiler} compiler
   */
  addAdditionalEntries(compiler) {
    /**
     * 存储将要添加的入口字符串
     */
    const additionalEntries = [];
    // 判断当前编译器是否为 Web 目标
    const isWebTarget = Server.isWebTarget(compiler);

    // TODO maybe empty client
    // client 存在且目标是 Web
    if (this.options.client && isWebTarget) {
      let webSocketURLStr = "";

      if (this.options.webSocketServer) {
        // 获取url
        const webSocketURL = this.options.client.webSocketURL;
        const webSocketServer = this.options.webSocketServer;
        // 构建查询参数
        const searchParams = new URLSearchParams();

        /** 协议 */
        let protocol;

        /**
         * 如果 webSocketURL 中有定义的协议，则使用它；
         * 否则，根据当前是否是 TLS 服务器来决定使用 "wss:" 还是 "ws:"
         */

        if (typeof webSocketURL.protocol !== "undefined") {
          protocol = webSocketURL.protocol;
        } else {
          protocol = this.isTlsServer ? "wss:" : "ws:";
        }

        searchParams.set("protocol", protocol);

        // 如果 webSocketURL 中定义了用户名和密码，则将其添加到查询参数中
        if (typeof webSocketURL.username !== "undefined") {
          searchParams.set("username", webSocketURL.username);
        }

        if (typeof webSocketURL.password !== "undefined") {
          searchParams.set("password", webSocketURL.password);
        }

        /** 主机名 */
        let hostname;

        // SockJS不支持服务器模式，所以‘ hostname ’和‘ port ’不能指定，我们忽略它们
        // 检查当前 WebSocket 服务器类型是否为 sockjs
        const isSockJSType = webSocketServer.type === "sockjs";

        // 检查是否定义了主机和端口
        const isWebSocketServerHostDefined =
          typeof webSocketServer.options.host !== "undefined";
        const isWebSocketServerPortDefined =
          typeof webSocketServer.options.port !== "undefined";

        if (
          isSockJSType &&
          (isWebSocketServerHostDefined || isWebSocketServerPortDefined)
        ) {
          this.logger.warn(
            "SockJS only supports client mode and does not support custom hostname and port options. Please consider using 'ws' if you need to customize these options."
          );
        }

        /**
         * 按优先级选择主机名：
         * webSocketURL 中的主机名、WebSocket 服务器的主机名、配置中的主机名，最后默认为 "0.0.0.0"
         */

        if (typeof webSocketURL.hostname !== "undefined") {
          hostname = webSocketURL.hostname;
        } else if (isWebSocketServerHostDefined && !isSockJSType) {
          hostname = webSocketServer.options.host;
        } else if (typeof this.options.host !== "undefined") {
          hostname = this.options.host;
        } else {
          hostname = "0.0.0.0";
        }

        searchParams.set("hostname", hostname);

        /** 端口 */
        let port;

        /**
         * 类似于主机名的选择，
         * 依次检查 WebSocket URL、WebSocket 服务器、配置中的端口，默认设为 "0"
         */
        if (typeof webSocketURL.port !== "undefined") {
          port = webSocketURL.port;
        } else if (isWebSocketServerPortDefined && !isSockJSType) {
          port = webSocketServer.options.port;
        } else if (typeof this.options.port === "number") {
          port = this.options.port;
        } else if (
          typeof this.options.port === "string" &&
          this.options.port !== "auto"
        ) {
          port = Number(this.options.port);
        } else {
          port = "0";
        }

        searchParams.set("port", String(port));

        /** 路径 */
        let pathname = "";

        /**
         * 选择 WebSocket URL 中的路径，或者 WebSocket 服务器的前缀/路径
         */
        if (typeof webSocketURL.pathname !== "undefined") {
          pathname = webSocketURL.pathname;
        } else if (
          typeof webSocketServer.options.prefix !== "undefined" ||
          typeof webSocketServer.options.path !== "undefined"
        ) {
          pathname =
            webSocketServer.options.prefix || webSocketServer.options.path;
        }

        searchParams.set("pathname", pathname);

        /**
         * 进一步处理其他配置项（如 logging、progress、overlay、reconnect、hot 和 liveReload）并将其加入查询参数中
         */

        const client = this.options.client;

        if (typeof client.logging !== "undefined") {
          searchParams.set("logging", client.logging);
        }

        if (typeof client.progress !== "undefined") {
          searchParams.set("progress", String(client.progress));
        }

        if (typeof client.overlay !== "undefined") {
          const overlayString =
            typeof client.overlay === "boolean"
              ? String(client.overlay)
              : JSON.stringify({
                  ...client.overlay,
                  errors: encodeOverlaySettings(client.overlay.errors),
                  warnings: encodeOverlaySettings(client.overlay.warnings),
                  runtimeErrors: encodeOverlaySettings(
                    client.overlay.runtimeErrors
                  ),
                });

          searchParams.set("overlay", overlayString);
        }

        if (typeof client.reconnect !== "undefined") {
          searchParams.set(
            "reconnect",
            typeof client.reconnect === "number"
              ? String(client.reconnect)
              : "10"
          );
        }

        if (typeof this.options.hot !== "undefined") {
          searchParams.set("hot", String(this.options.hot));
        }

        if (typeof this.options.liveReload !== "undefined") {
          searchParams.set("live-reload", String(this.options.liveReload));
        }

        webSocketURLStr = searchParams.toString();
      }

      // 将构建好的 WebSocket URL 字符串与客户端入口路径结合，添加到 additionalEntries 数组中
      additionalEntries.push(`${this.getClientEntry()}?${webSocketURLStr}`);
    }

    // 如果有热重载的入口，则同样将其添加到
    const clientHotEntry = this.getClientHotEntry();
    if (clientHotEntry) {
      additionalEntries.push(clientHotEntry);
    }

    const webpack = compiler.webpack || require("webpack");

    for (const additionalEntry of additionalEntries) {
      // 使用 EntryPlugin 将每个入口注册到 Webpack 编译器中
      new webpack.EntryPlugin(compiler.context, additionalEntry, {
        name: undefined,
      }).apply(compiler);
    }
  }

  /**
   * 用于根据配置确定 WebSocket 客户端的实现方式
   * @private
   * @returns {string}
   */
  getClientTransport() {
    /** 存储客户端实现的路径或模块 */
    let clientImplementation;
    /** 标记客户端实现是否找到 */
    let clientImplementationFound = true;

    // 检查当前配置中是否指定了已知的 WebSocket 服务器类型（例如 ws 或 sockjs）
    const isKnownWebSocketServerImplementation =
      this.options.webSocketServer &&
      typeof this.options.webSocketServer.type === "string" &&
      (this.options.webSocketServer.type === "ws" ||
        this.options.webSocketServer.type === "sockjs");

    let clientTransport;

    if (this.options.client) {
      if (typeof this.options.client.webSocketTransport !== "undefined") {
        clientTransport = this.options.client.webSocketTransport;
      } else if (isKnownWebSocketServerImplementation) {
        clientTransport = this.options.webSocketServer.type;
      } else {
        clientTransport = "ws";
      }
    } else {
      clientTransport = "ws";
    }

    switch (typeof clientTransport) {
      case "string":
        // 可以是‘sockjs’， ‘ws’，或者需要的路径
        if (clientTransport === "sockjs") {
          clientImplementation = require.resolve(
            "../client/clients/SockJSClient"
          );
        } else if (clientTransport === "ws") {
          clientImplementation = require.resolve(
            "../client/clients/WebSocketClient"
          );
        } else {
          try {
            clientImplementation = require.resolve(clientTransport);
          } catch (e) {
            clientImplementationFound = false;
          }
        }
        break;
      default:
        clientImplementationFound = false;
    }

    // 如果没有找到实现的情况
    if (!clientImplementationFound) {
      // 抛出错误，提示用户必须显式指定
      // 错误信息解释了该配置的要求：它必须是已知的实现（如 sockjs 或 ws）或一个有效的 JS 文件路径
      throw new Error(
        `${
          !isKnownWebSocketServerImplementation
            ? "When you use custom web socket implementation you must explicitly specify client.webSocketTransport. "
            : ""
        }client.webSocketTransport must be a string denoting a default implementation (e.g. 'sockjs', 'ws') or a full path to a JS file via require.resolve(...) which exports a class `
      );
    }

    // 返回找到的客户端实现的路径
    return clientImplementation;
  }

  getClientEntry() {
    return require.resolve("../client/index.js");
  }

  /**
   * @returns {string | void}
   */
  getClientHotEntry() {
    if (this.options.hot === "only") {
      return require.resolve("webpack/hot/only-dev-server");
    } else if (this.options.hot) {
      return require.resolve("webpack/hot/dev-server");
    }
  }

  /**
   * 对路径的文件监听
   * @private
   * @returns {void}
   */
  setupWatchFiles() {
    const watchFiles = this.options.watchFiles;

    if (watchFiles.length > 0) {
      for (const item of watchFiles) {
        this.watchFiles(item.paths, item.options);
      }
    }
  }

  /**
   * 用于监控静态文件目录
   * @private
   * @returns {void}
   */
  setupWatchStaticFiles() {
    const watchFiles = this.options.static;

    if (watchFiles.length > 0) {
      for (const item of watchFiles) {
        if (item.watch) {
          this.watchFiles(item.directory, item.watch);
        }
      }
    }
  }

  /**
   * @private
   * @returns {void}
   */
  setupMiddlewares() {
    /**
     * 放中间件对象，每个中间件对象都包含 name 和 middleware 两个属性
     * - name：中间件的名称，方便标识
     * - middleware：中间件函数，用于处理请求
     */
    let middlewares = [];

    // 注册 host-header-check 这个中间件，
    // 主要用于检查请求的 Host 或 :authority（在 HTTP/2 中使用的头部字段）
    middlewares.push({
      name: "host-header-check",
      middleware: (req, res, next) => {
        const headers = req.headers;
        const headerName = headers[":authority"] ? ":authority" : "host";

        // 检查指定的头部是否有效
        if (this.checkHeader(headers, headerName)) {
          next();
          return;
        }

        // 终止响应，头部不合法
        res.statusCode = 403;
        res.end("Invalid Host header");
      },
    });

    const isHTTP2 =
      /** @type {ServerConfiguration<A, S>} */ (this.options.server).type ===
      "http2";

    // 检查当前服务器配置中的协议类型是否为 http2
    if (isHTTP2) {
      // TODO patch for https://github.com/pillarjs/finalhandler/pull/45, need remove then will be resolved
      // 对于 http2 需要进行额外的兼容性处理
      middlewares.push({
        name: "http2-status-message-patch",
        middleware: (_req, res, next) => {
          // 解决在 res.statusMessage 设置或获取时可能出现的问题
          Object.defineProperty(res, "statusMessage", {
            get() {
              return "";
            },
            set() {},
          });

          next();
        },
      });
    }

    // compress is placed last and uses unshift so that it will be the first middleware used
    // 压缩中间件
    if (this.options.compress && !isHTTP2) {
      const compression = require("compression");

      middlewares.push({ name: "compression", middleware: compression() });
    }

    // 设置响应头中间件
    if (typeof this.options.headers !== "undefined") {
      middlewares.push({
        name: "set-headers",
        // 动态设置请求的响应头
        middleware: this.setHeaders.bind(this),
      });
    }

    // 注册 webpack-dev-middleware 中间件，用于拦截和处理 Webpack 打包输出到内存中的资源请求
    // 使得打包后的文件在内存中快速读取，支持实时更新
    middlewares.push({
      name: "webpack-dev-middleware",
      middleware: this.middleware,
    });

    // 应该在‘ webpack-dev-middleware ’之后，否则其他中间件可能会重写响应
    // SockJS 客户端脚本传输中间件
    // 为 "/__webpack_dev_server__/sockjs.bundle.js" 路径上的请求提供 SockJS 客户端的 JavaScript 文件
    middlewares.push({
      name: "webpack-dev-server-sockjs-bundle",
      path: "/__webpack_dev_server__/sockjs.bundle.js",
      middleware: (req, res, next) => {
        // 通过 GET 或 HEAD 方法检查请求是否是用于获取资源
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }

        // 定义了 clientPath 路径指向 sockjs-client 的客户端文件
        const clientPath = path.join(
          __dirname,
          "..",
          "client/modules/sockjs-client/index.js"
        );

        // 默认情况下Express发送Etag和其他头文件，所以出于兼容性的考虑，我们保留它们
        if (typeof res.sendFile === "function") {
          // sendFile 方法可用，将这个文件发送给客户端
          res.sendFile(clientPath);
          return;
        }

        let stats;

        try {
          // TODO implement `inputFileSystem.createReadStream` in webpack
          // 获取文件 clientPath 的文件信息
          stats = fs.statSync(clientPath);
        } catch (err) {
          next();
          return;
        }

        // 设置响应头，表示返回的内容为 js 文件，浏览器会按照js 文件进行解析
        res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
        // 文件的字节大小
        res.setHeader("Content-Length", stats.size);

        // 请求方法是 HEAD（只请求头部信息，不需要具体内容），直接关闭请求
        if (req.method === "HEAD") {
          res.end();
          return;
        }

        // 创建一个只读的文件流，可以逐步读取文件内容，通过 pipe 管道将文件流直接传输给客户端
        fs.createReadStream(clientPath).pipe(res);

        /**
         * fs.createReadStream 是 Node.js 文件系统模块（fs）中的方法,用于创建一个文件读取流，逐步读取文件的内容
         * 避免将整个文件加载到内存中，非常适合大文件传输
         * pipe 是流对象上常用的方法，用于将一个流的输出直接传递到另一个流的输入
         *
         * res 是 HTTP 响应对象（也是一个流），表示客户端的请求响应通道
         *
         *
         * pipe(res) 会将读取到的内容逐步写入res，边读取文件内容边发送给客户端
         * 流在读取完成时会自动触发 end 事件，pipe 方法会监听 end 事件。
         * 当读取完文件数据后，pipe 会自动停止写入，连接也会随之关闭
         */
      },
    });

    // 这个中间件的主要功能是手动触发 Webpack 的重新编译，通常用于实时开发时的构建失效处理
    middlewares.push({
      name: "webpack-dev-server-invalidate",
      // 当请求这个路径时，会触发重新编译
      path: "/webpack-dev-server/invalidate",
      middleware: (req, res, next) => {
        // 仅接受 GET 或 HEAD 请求方法，其他请求直接进入下一个中间件
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }

        // 触发重新编译，这通常会让 Webpack 重新生成打包文件并发送更新内容到客户端
        this.invalidate();

        // 结束当前请求
        res.end();
      },
    });

    // 这个中间件允许开发者直接从浏览器中打开代码编辑器并跳转到指定的文件（例如错误的源文件），为快速定位和修复代码提供便利
    middlewares.push({
      name: "webpack-dev-server-open-editor",
      path: "/webpack-dev-server/open-editor",
      middleware: (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }

        if (!req.url) {
          next();
          return;
        }

        const resolveUrl = new URL(req.url, `http://${req.headers.host}`);
        const params = new URLSearchParams(resolveUrl.search);
        const fileName = params.get("fileName");

        if (typeof fileName === "string") {
          // @ts-ignore
          // launch-editor 是一个工具，用于在开发者的默认代码编辑器中打开指定文件
          const launchEditor = require("launch-editor");

          // 将启动开发者的默认编辑器并打开该文件
          launchEditor(fileName);
        }

        res.end();
      },
    });

    // 这个中间件目的是在 /webpack-dev-server 路径上生成一个包含构建资源信息的简单 HTML 页面。
    // 这通常用于开发环境下快速查看 Webpack 生成的文件列表和路径，便于开发者确认静态资源文件是否正确生成
    middlewares.push({
      name: "webpack-dev-server-assets",
      path: "/webpack-dev-server",
      middleware: (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }

        if (!this.middleware) {
          next();
          return;
        }

        // 确保构建完成后再生成 HTML 报告
        this.middleware.waitUntilValid((stats) => {
          // 声明返回内容是 UTF-8 编码的 HTML 页面
          res.setHeader("Content-Type", "text/html; charset=utf-8");

          // 对于 HEAD 请求，直接调用 res.end()，不返回任何内容
          if (req.method === "HEAD") {
            res.end();
            return;
          }

          // 写入 html 基础结构
          res.write(
            '<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>'
          );

          /**
           * 这块代码的目的是从 Webpack 的 stats 对象中获取编译后的静态资源信息，
           * 并将这些信息格式化成一个 HTML 页面内容，以供开发者查看 Webpack 构建输出的资源清单
           */

          // stats 对象包含 Webpack 构建的完整信息
          const statsForPrint =
            // stats.stats：如果存在，表示这是一个多编译（multi-compiler）模式的构建，即 Webpack 同时构建多个配置文件
            typeof stats.stats !== "undefined"
              ? // 在多编译模式中，children 包含了每个单独的编译配置的输出信息
                stats.toJson().children
              : // 是单一编译，则直接调用 toJson() 获取构建信息，并将其封装成数组，以便后续统一处理。
                [stats.toJson()];

          // 写入 HTML 标题，显示“Assets Report”，作为报告的标题
          res.write(`<h1>Assets Report:</h1>`);

          // 遍历每个编译配置的输出信息
          for (const [index, item] of statsForPrint.entries()) {
            res.write("<div>");

            const name =
              typeof item.name !== "undefined"
                ? item.name
                : stats.stats
                  ? `unnamed[${index}]`
                  : "unnamed";

            res.write(`<h2>Compilation: ${name}</h2>`);
            res.write("<ul>");

            const publicPath =
              item.publicPath === "auto" ? "" : item.publicPath;
            const assets = item.assets;

            for (const asset of assets) {
              const assetName = asset.name;
              const assetURL = `${publicPath}${assetName}`;

              res.write(
                `<li>
              <strong><a href="${assetURL}" target="_blank">${assetName}</a></strong>
            </li>`
              );
            }

            res.write("</ul>");
            res.write("</div>");
          }

          res.end("</body></html>");
        });
      },
    });

    // 对 proxy 的处理，主要是通过第三方库 http-proxy-middleware 来完成代理（请求转发）
    if (this.options.proxy) {
      const { createProxyMiddleware } = require("http-proxy-middleware");

      /**
       * 创建一个代理中间件，根据传入的配置来生成对应的代理中间件
       */
      const getProxyMiddleware = (proxyConfig) => {
        // 在没有 target 和 router 的情况下使用 bypass 是可能的，但是代理中间件在这种情况下没有且无法实例化
        // 如果有target 说明是要转发到其服务器地址上
        if (proxyConfig.target) {
          // 获取上下文信息
          const context = proxyConfig.context || proxyConfig.path;

          // 创建代理中间件
          return createProxyMiddleware(context, proxyConfig);
        }

        // 如果存在 router 也会创建代理中间件
        if (proxyConfig.router) {
          return createProxyMiddleware(proxyConfig);
        }

        // 如果配置中既没有 target 也没有 router，则认为配置有误，并发出弃用警告
        if (!proxyConfig.bypass) {
          util.deprecate(
            () => {},
            `Invalid proxy configuration:\n\n${JSON.stringify(proxyConfig, null, 2)}\n\nThe use of proxy object notation as proxy routes has been removed.\nPlease use the 'router' or 'context' options. Read more at https://github.com/chimurai/http-proxy-middleware/tree/v2.0.6#http-proxy-middleware-options`,
            "DEP_WEBPACK_DEV_SERVER_PROXY_ROUTES_ARGUMENT"
          )();
        }
      };

      /**
       * Assume a proxy configuration specified as:
       * proxy: [
       *   {
       *     context: "value",
       *     ...options,
       *   },
       *   // or:
       *   function() {
       *     return {
       *       context: "context",
       *       ...options,
       *     };
       *   }
       * ]
       *
       * 遍历 proxy 配置项
       */
      this.options.proxy.forEach((proxyConfigOrCallback) => {
        let proxyMiddleware;

        // 如果传入的配置是函数，则调用获取配置，否则直接使用其配置
        let proxyConfig =
          typeof proxyConfigOrCallback === "function"
            ? proxyConfigOrCallback()
            : proxyConfigOrCallback;

        // 创建代理中间件
        proxyMiddleware = getProxyMiddleware(proxyConfig);

        // 说明配置了 ws 代理
        if (proxyConfig.ws) {
          // 将这个中间件添加到 ws 代理数组中
          this.webSocketProxies.push(proxyMiddleware);
        }

        // 中间件中的处理函数
        const handler = async (req, res, next) => {
          // 如果传入的配置是函数，则每次请求时都会调用
          if (typeof proxyConfigOrCallback === "function") {
            const newProxyConfig = proxyConfigOrCallback(req, res, next);

            // 如果新配置与当前配置不同，则更新配置
            if (newProxyConfig !== proxyConfig) {
              proxyConfig = newProxyConfig;

              const socket = req.socket != null ? req.socket : req.connection;
              // @ts-ignore
              const server = socket != null ? socket.server : null;

              // 还会移除与 server 相关的所有事件监听器，以确保新的代理配置生效
              if (server) {
                server.removeAllListeners("close");
              }

              // 创建新的代理中间件
              proxyMiddleware = getProxyMiddleware(proxyConfig);
            }
          }

          // - Check if we have a bypass function defined
          // - In case the bypass function is defined we'll retrieve the
          // bypassUrl from it otherwise bypassUrl would be null
          // TODO remove in the next major in favor `context` and `router` options

          // 配置中定义了 bypass 函数（用于跳过代理）
          const isByPassFuncDefined = typeof proxyConfig.bypass === "function";
          if (isByPassFuncDefined) {
            util.deprecate(
              () => {},
              "Using the 'bypass' option is deprecated. Please use the 'router' or 'context' options. Read more at https://github.com/chimurai/http-proxy-middleware/tree/v2.0.6#http-proxy-middleware-options",
              "DEP_WEBPACK_DEV_SERVER_PROXY_BYPASS_ARGUMENT"
            )();
          }

          // 调用改函数
          const bypassUrl = isByPassFuncDefined
            ? await proxyConfig.bypass(req, res, proxyConfig)
            : null;

          if (typeof bypassUrl === "boolean") {
            // 如果返回 布尔值，会跳过代理并直接返回 404 响应
            res.statusCode = 404;
            req.url = "";
            next();
          } else if (typeof bypassUrl === "string") {
            // 返回一个字符串，会将请求重定向到该 URL
            req.url = bypassUrl;
            next();
          } else if (proxyMiddleware) {
            // 没有定义 bypass，且存在有效的代理中间件，则执行该中间件进行请求转发
            return proxyMiddleware(req, res, next);
          } else {
            next();
          }
        };

        //  将代理处理的中间件和错误处理的中间件加入到中间件队列中
        middlewares.push({
          name: "http-proxy-middleware",
          middleware: handler,
        });

        // Also forward error requests to the proxy so it can handle them.
        middlewares.push({
          name: "http-proxy-middleware-error-handler",
          middleware: (error, req, res, next) => handler(req, res, next),
        });
      });

      /**
       * 上面遍历的代码总的来说做了以下的一些事情：
       * 1. 根据配置动态生成代理中间件
       * 2. 支持 WebSocket 和普通 HTTP 请求的代理
       * 3. 支持 bypass 函数跳过代理请求或进行 URL 重定向
       * 4. 处理代理请求时动态更新配置，并且支持错误处理中间件
       * 5. 最后将 Webpack 开发中间件添加到中间件队列中，确保 Webpack 的资源能够正确地返回给客户端
       */

      // 添加 Webpack 开发中间件，用于处理 Webpack 编译后的资源
      middlewares.push({
        name: "webpack-dev-middleware",
        middleware: this.middleware,
      });
    }

    // 静态资源配置项
    const staticOptions = this.options.static;

    if (staticOptions.length > 0) {
      // 为每个 staticOption 配置项创建静态文件服务
      for (const staticOption of staticOptions) {
        for (const publicPath of staticOption.publicPath) {
          // 使用 express.static 中间件提供静态文件服务
          middlewares.push({
            name: "express-static",
            path: publicPath,
            middleware: getExpress().static(
              staticOption.directory,
              staticOption.staticOptions
            ),
          });
        }
      }
    }

    // 处理前端单页应用（SPA）路由，确保当路由不存在时，回退到 index.html 页面
    // 这对于 SPA 中使用 HTML5 的 history API 进行路由的应用非常重要
    if (this.options.historyApiFallback) {
      // 如果启用了回退，使用第三方库来完成
      const connectHistoryApiFallback = require("connect-history-api-fallback");
      const { historyApiFallback } = this.options;

      // 如果回退配置没有定义日志，则使用默认的日志
      if (
        typeof historyApiFallback.logger === "undefined" &&
        !historyApiFallback.verbose
      ) {
        // @ts-ignore
        historyApiFallback.logger = this.logger.log.bind(
          this.logger,
          "[connect-history-api-fallback]"
        );
      }

      // connect-history-api-fallback 会拦截请求，当没有找到匹配的文件时，
      // 会自动将请求重定向到 /index.html，以便 SPA 路由能够继续处理。
      middlewares.push({
        name: "connect-history-api-fallback",
        middleware: connectHistoryApiFallback(historyApiFallback),
      });

      // 它能够处理重定向后的‘/index.html’请求
      middlewares.push({
        name: "webpack-dev-middleware",
        middleware: this.middleware,
      });

      // 再次处理静态文件中间件（重复代码）
      // 为了确保在某些条件下能够再次添加静态文件服务
      if (staticOptions.length > 0) {
        for (const staticOption of staticOptions) {
          for (const publicPath of staticOption.publicPath) {
            middlewares.push({
              name: "express-static",
              path: publicPath,
              middleware: getExpress().static(
                staticOption.directory,
                staticOption.staticOptions
              ),
            });
          }
        }
      }
    }

    if (staticOptions.length > 0) {
      /**
       * serve-index 是一个用于生成目录索引的库，允许展示目录列表而不是直接返回文件。
       * 它通常用于文件浏览的场景，启用了 serveIndex，则创建一个中间件，
       * 拦截 GET 和 HEAD 请求，调用 serveIndex 来展示目录中的文件
       */
      const serveIndex = require("serve-index");

      for (const staticOption of staticOptions) {
        for (const publicPath of staticOption.publicPath) {
          // 配置了 serveIndex，则为静态文件目录生成一个索引页面，允许用户浏览目录中的文件
          if (staticOption.serveIndex) {
            middlewares.push({
              name: "serve-index",
              path: publicPath,
              middleware: (req, res, next) => {
                // serve-index doesn't fallthrough non-get/head request to next middleware
                if (req.method !== "GET" && req.method !== "HEAD") {
                  return next();
                }

                serveIndex(staticOption.directory, staticOption.serveIndex)(
                  req,
                  res,
                  next
                );
              },
            });
          }
        }
      }
    }

    // 将此中间件始终注册为最后一个中间件，以便仅在没有其他中间件响应时将其用作回退
    middlewares.push({
      name: "options-middleware",
      middleware: (req, res, next) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 204; // 表示没有返回内容
          res.setHeader("Content-Length", "0");
          res.end();
          return;
        }
        next();
      },
    });

    // 允许开发者在 Webpack Dev Server 配置中通过 setupMiddlewares 函数自定义中间件
    // 注入自定义的中间件，从而修改请求处理的流程或添加特定的功能
    if (typeof this.options.setupMiddlewares === "function") {
      middlewares = this.options.setupMiddlewares(middlewares, this);
    }

    // 延迟初始化 Webpack Dev Middleware，直到真正需要它时才进行初始化
    const lazyInitDevMiddleware = () => {
      // 检查中间件是否被初始化,没有的话则初始化
      if (!this.middleware) {
        const webpackDevMiddleware = require("webpack-dev-middleware");

        // 用于服务webpack bundle的中间件
        this.middleware = webpackDevMiddleware(
          this.compiler,
          this.options.devMiddleware
        );
      }

      return this.middleware;
    };

    for (const i of middlewares) {
      // 确保 webpack-dev-middleware 只会在第一次使用时进行初始化，避免重复初始化
      if (i.name === "webpack-dev-middleware") {
        const item = i;

        if (typeof item.middleware === "undefined") {
          item.middleware = lazyInitDevMiddleware();
        }
      }
    }

    // 注册所有的中间件
    for (const middleware of middlewares) {
      if (typeof middleware === "function") {
        this.app.use(middleware);
      } else if (typeof middleware.path !== "undefined") {
        this.app.use(middleware.path, middleware.middleware);
      } else {
        this.app.use(middleware.middleware);
      }
    }
  }

  /**
   * 核心的文件监控方法，用于根据路径和选项创建文件监听器。
   * 当监听到变化时，它可以发送 WebSocket 消息通知客户端
   * @param {string | string[]} watchPath
   * @param {WatchOptions} [watchOptions]
   */
  watchFiles(watchPath, watchOptions) {
    // 使用第三方库 chokidar 用于文件监听的流行库，支持高效的文件系统监听
    const chokidar = require("chokidar");
    const watcher = chokidar.watch(watchPath, watchOptions);

    // 在文件发生变化时，向 WebSocket 客户端发送消息
    if (this.options.liveReload) {
      watcher.on("change", (item) => {
        if (this.webSocketServer) {
          this.sendMessage(
            this.webSocketServer.clients,
            "static-changed",
            item
          );
        }
      });
    }

    // 将创建的 watcher 对象保存到 staticWatchers 数组中，以便后续控制或清理这些监听器
    this.staticWatchers.push(watcher);
  }

  /**
   * 向 WebSocket 客户端发送消息，用于实时通信，通常用于开发环境下的热更新服务
   * @param {*} clients 客户端连接列表
   * @param {*} type 消息类型，通常用于指示消息的目的
   * @param {*} data 发送的数据内容
   * @param {*} params 其他附加参数
   */
  sendMessage(clients, type, data, params) {
    // 遍历每个客户端对象
    for (const client of clients) {
      // sockjs 和 ws 都使用 1 来表示客户端准备就绪
      if (client.readyState === 1) {
        // readyState 为 1 表示连接已打开，客户端可以接收消息
        client.send(JSON.stringify({ type, data, params }));
      }
    }
  }

  // Send stats to a socket or multiple sockets
  /**
   * 向客户端发送构建统计信息，通常是 Webpack 的编译结果
   * @private
   * @param {ClientConnection[]} clients 客户端连接列表
   * @param {StatsCompilation} stats  Webpack 编译的统计信息对象
   * @param {boolean} [force] 是否强制发送信息
   */
  sendStats(clients, stats, force) {
    // 决定是否需要发送信息，force 为true，忽略此条件，强制发送消息
    const shouldEmit =
      !force &&
      stats &&
      (!stats.errors || stats.errors.length === 0) &&
      (!stats.warnings || stats.warnings.length === 0) &&
      this.currentHash === stats.hash;

    // 如果 shouldEmit 为 true，则表示构建没有变化且没有错误或警告，
    // 直接向客户端发送 "still-ok" 信息，并返回结束该方法
    if (shouldEmit) {
      this.sendMessage(clients, "still-ok");

      return;
    }

    // 更新哈希
    this.currentHash = stats.hash;
    // 将新哈希发送给所有客户端，以标识构建的版本变化
    this.sendMessage(clients, "hash", stats.hash);

    // 检查是否存在错误或警告信息
    if (stats.errors.length > 0 || stats.warnings.length > 0) {
      const hasErrors = stats.errors.length > 0;

      if (stats.warnings.length > 0) {
        let params;

        if (hasErrors) {
          params = { preventReloading: true };
        }

        this.sendMessage(clients, "warnings", stats.warnings, params);
      }

      if (stats.errors.length > 0) {
        this.sendMessage(clients, "errors", stats.errors);
      }
    } else {
      // 向客户端发送 "ok"，表明构建完成且没有问题
      this.sendMessage(clients, "ok");
    }
  }

  /**
   * @private
   * @param {{ [key: string]: string | undefined }} headers
   * @param {string} headerToCheck
   * @returns {boolean}
   */
  checkHeader(headers, headerToCheck) {
    // allow user to opt out of this security check, at their own risk
    // by explicitly enabling allowedHosts
    if (this.options.allowedHosts === "all") {
      return true;
    }

    // get the Host header and extract hostname
    // we don't care about port not matching
    const hostHeader = headers[headerToCheck];

    if (!hostHeader) {
      return false;
    }

    if (/^(file|.+-extension):/i.test(hostHeader)) {
      return true;
    }

    // use the node url-parser to retrieve the hostname from the host-header.
    const hostname = url.parse(
      // if hostHeader doesn't have scheme, add // for parsing.
      /^(.+:)?\/\//.test(hostHeader) ? hostHeader : `//${hostHeader}`,
      false,
      true
    ).hostname;

    // always allow requests with explicit IPv4 or IPv6-address.
    // A note on IPv6 addresses:
    // hostHeader will always contain the brackets denoting
    // an IPv6-address in URLs,
    // these are removed from the hostname in url.parse(),
    // so we have the pure IPv6-address in hostname.
    // For convenience, always allow localhost (hostname === 'localhost')
    // and its subdomains (hostname.endsWith(".localhost")).
    // allow hostname of listening address  (hostname === this.options.host)
    const isValidHostname =
      (hostname !== null && ipaddr.IPv4.isValid(hostname)) ||
      (hostname !== null && ipaddr.IPv6.isValid(hostname)) ||
      hostname === "localhost" ||
      (hostname !== null && hostname.endsWith(".localhost")) ||
      hostname === this.options.host;

    if (isValidHostname) {
      return true;
    }

    const { allowedHosts } = this.options;

    // always allow localhost host, for convenience
    // allow if hostname is in allowedHosts
    if (Array.isArray(allowedHosts) && allowedHosts.length > 0) {
      for (let hostIdx = 0; hostIdx < allowedHosts.length; hostIdx++) {
        /** @type {string} */
        const allowedHost = allowedHosts[hostIdx];

        if (allowedHost === hostname) {
          return true;
        }

        // support "." as a subdomain wildcard
        // e.g. ".example.com" will allow "example.com", "www.example.com", "subdomain.example.com", etc
        if (allowedHost[0] === ".") {
          // "example.com"  (hostname === allowedHost.substring(1))
          // "*.example.com"  (hostname.endsWith(allowedHost))
          if (
            hostname === allowedHost.substring(1) ||
            /** @type {string} */ (hostname).endsWith(allowedHost)
          ) {
            return true;
          }
        }
      }
    }

    // Also allow if `client.webSocketURL.hostname` provided
    if (
      this.options.client &&
      typeof (
        /** @type {ClientConfiguration} */ (this.options.client).webSocketURL
      ) !== "undefined"
    ) {
      return (
        /** @type {WebSocketURL} */
        (/** @type {ClientConfiguration} */ (this.options.client).webSocketURL)
          .hostname === hostname
      );
    }

    // disallow
    return false;
  }
}

module.exports = Server;
