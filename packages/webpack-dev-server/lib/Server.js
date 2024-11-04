const { validate } = require("schema-utils");
const schema = require("./options.json");

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
   * @returns {Promise<void>}
   */
  async start() {
    await this.normalizeOptions();

    if (this.options.ipc) {
      await new Promise((resolve, reject) => {
        const net = require("net");
        const socket = new net.Socket();

        socket.on(
          "error",
          /**
           * @param {Error & { code?: string }} error
           */
          (error) => {
            if (error.code === "ECONNREFUSED") {
              // No other server listening on this socket, so it can be safely removed
              fs.unlinkSync(/** @type {string} */ (this.options.ipc));

              resolve();

              return;
            } else if (error.code === "ENOENT") {
              resolve();

              return;
            }

            reject(error);
          }
        );

        socket.connect(
          { path: /** @type {string} */ (this.options.ipc) },
          () => {
            throw new Error(`IPC "${this.options.ipc}" is already used`);
          }
        );
      });
    } else {
      this.options.host = await Server.getHostname(this.options.host);
      this.options.port = await Server.getFreePort(
        this.options.port,
        this.options.host
      );
    }

    await this.initialize();

    const listenOptions = this.options.ipc
      ? { path: this.options.ipc }
      : { host: this.options.host, port: this.options.port };

    await new Promise((resolve) => {
      this.server.listen(listenOptions, () => {
        resolve();
      });
    });

    if (this.options.ipc) {
      // chmod 666 (rw rw rw)
      const READ_WRITE = 438;

      await fs.promises.chmod(this.options.ipc, READ_WRITE);
    }

    if (this.options.webSocketServer) {
      this.createWebSocketServer();
    }

    if (this.options.bonjour) {
      this.runBonjour();
    }

    await this.logStatus();

    if (typeof this.options.onListening === "function") {
      this.options.onListening(this);
    }
  }

  static get schema() {
    return schema;
  }
}

module.exports = Server;
