"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 这里是打包后的文件

const WEBPACK_PACKAGE = process.env.WEBPACK_PACKAGE || "webpack";
const WEBPACK_DEV_SERVER_PACKAGE =
  process.env.WEBPACK_DEV_SERVER_PACKAGE || "webpack-dev-server";
class ServeCommand {
  async apply(cli) {
    const loadDevServerOptions = () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const devServer = require(WEBPACK_DEV_SERVER_PACKAGE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options = cli.webpack.cli.getArguments(devServer.schema);
      // New options format
      // { flag1: {}, flag2: {} }
      return Object.keys(options).map((key) => {
        options[key].name = key;
        return options[key];
      });
    };
    await cli.makeCommand(
      {
        name: "serve [entries...]",
        alias: ["server", "s"],
        description:
          "Run the webpack dev server and watch for source file changes while serving.",
        usage: "[entries...] [options]",
        pkg: "@webpack-cli/serve",
        dependencies: [WEBPACK_PACKAGE, WEBPACK_DEV_SERVER_PACKAGE],
      },
      async () => {
        let devServerFlags = [];
        // 将webpack注册到webpack-cli中
        cli.webpack = await cli.loadWebpack();
        try {
          // 加载 webpack-dev-server 相关的选项
          devServerFlags = loadDevServerOptions();
        } catch (error) {
          cli.logger.error(
            `You need to install 'webpack-dev-server' for running 'webpack serve'.\n${error}`
          );
          process.exit(2);
        }
        // 获取webpack-cli 所有内置选项
        const builtInOptions = cli.getBuiltInOptions();

        // 合并cli 和 dev-server 的配置
        return [...builtInOptions, ...devServerFlags];
      },

      /**
       * 第二个参数、第三个参数，我们可以发现里面都去获取了cli配置以及dev-server 的配置
       * 看是有重复执行，实则两部分职责不同，都是必要的，无法合并成一个处理步骤
       *
       * - 第二个参数主要是用于命令注册，获取并合并 webpack 和 webpack-dev-server 的配置选项，供 CLI 工具识别
       * - 第三个参数主要是实际运行命令时，解析用户传入的选项，
       * 分别处理 webpack 和 devServer 的配置，确保正确启动 Webpack 和 webpack-dev-server
       */

      /**
       * 这哥函数为根据对应的命令触发响应的action
       * 这段代码是为 webpack-cli 中的 serve 命令提供的一个核心执行逻辑
       *
       * 主要负责处理命令行传入的选项 (entries 和 options)，创建 Webpack 编译器 (compiler)，并启动 webpack-dev-server
       * @returns
       */
      async (entries, options) => {
        // 获取 webpack-cli 内置的 CLI 选项
        const builtInOptions = cli.getBuiltInOptions();
        let devServerFlags = [];
        try {
          // 尝试加载 webpack-dev-server 的相关选项
          devServerFlags = loadDevServerOptions();
        } catch (error) {
          // Nothing, to prevent future updates
        }

        // 分类处理 CLI 选项

        /** 存放 Webpack 内置的 CLI 选项 */
        const webpackCLIOptions = {};
        /** 存放 webpack-dev-server 的选项 */
        const devServerCLIOptions = {};
        /** 存放需要额外处理的选项的处理器函数，这些处理器稍后会执行 */
        const processors = [];

        // 遍历选项进行分类处理
        for (const optionName in options) {
          // 驼峰转-连字符  为了与命令行参数保持一致
          const kebabedOption = cli.toKebabCase(optionName);
          const isBuiltInOption = builtInOptions.find(
            (builtInOption) => builtInOption.name === kebabedOption
          );
          // 找到说明是当前选项是webpack-cli 内置选项
          if (isBuiltInOption) {
            // 归类到 cli 选项中
            webpackCLIOptions[optionName] = options[optionName];
          } else {
            // 说明当前选项是 dev-server 中的

            // 找当当前选项且存在 processor 属性的
            const needToProcess = devServerFlags.find(
              (devServerOption) =>
                devServerOption.name === kebabedOption &&
                devServerOption.processor
            );

            // 如果找到需要额外处理的选项
            // 将 processor 函数添加到 processors 数组中，以便稍后调用处理选项
            if (needToProcess) {
              processors.push(needToProcess.processor);
            }

            // 归类到 dev-server 选项中
            devServerCLIOptions[optionName] = options[optionName];
          }
        }

        // 遍历所有的处理函数，依次调用每个处理函数并传入 dev-server 的配置
        for (const processor of processors) {
          processor(devServerCLIOptions);
        }

        // entries 是一个包含所有入口文件的数组
        // 如果传入了入口文件则合并现有的 entry 配置和新的 entries
        if (entries.length > 0) {
          webpackCLIOptions.entry = [
            ...entries,
            ...(webpackCLIOptions.entry || []),
          ];
        }

        // 将用户的 CLI 选项 options 和 options.env 中的环境变量合并到 webpackCLIOptions.argv 中
        webpackCLIOptions.argv = Object.assign(Object.assign({}, options), {
          // WEBPACK_SERVE 此选项明确表明当前环境是使用 webpack serve 命令运行的，便于后续配置和行为的调整。
          env: Object.assign({ WEBPACK_SERVE: true }, options.env),
        });
        // 告知 Webpack CLI，当前命令是一个“watching”命令，即需要监听文件变动并重新构建
        webpackCLIOptions.isWatchingLikeCommand = true;

        // 创建 Webpack 编译器（compiler）实例
        const compiler = await cli.createCompiler(webpackCLIOptions);
        // 如果 compiler 创建失败，则立即返回
        if (!compiler) {
          return;
        }

        /** 存储 devServer 实例 */
        const servers = [];

        /**
         * stdin 是 Node.js 中的一个标准输入流，即 process.stdin，通常用于接收用户在命令行中输入的数据
         * 例如，我们在命令行中输入字符、命令或通过管道传输的数据，都可以通过 stdin 读取
         * 在服务器环境中，stdin 通常会连接到控制台，允许监听用户的操作行为
         *
         * process.stdin.resume() 用来确保 stdin 可以开始监听和接收事件。
         * 没有这行代码，stdin 流默认会处于暂停状态，无法接收或处理事件。
         */
        // 检查是否需要监听 stdin 的 end 事件以关闭服务器
        // 特别是 CLI 工具或开发服务器，监听 stdin 的关闭可以让工具在接收到关闭指令时自动清理资源，
        // 确保不会有未关闭的服务器实例保持在后台运行。
        if (cli.needWatchStdin(compiler)) {
          process.stdin.on("end", () => {
            // 在用户关闭 stdin 时自动关闭所有运行中的服务器实例并退出程序
            Promise.all(
              servers.map((server) => {
                return server.stop();
              })
            ).then(() => {
              process.exit(0);
            });
          });
          // 激活 stdin 监听
          process.stdin.resume();
        }

        // 动态加载 webpack-dev-server 模块
        const DevServer = require(WEBPACK_DEV_SERVER_PACKAGE);
        try {
          // 读取 webpack-dev-server 的 package.json 中的 version，
          // 以确保 webpack-dev-server 已正确安装
          require(`${WEBPACK_DEV_SERVER_PACKAGE}/package.json`).version;
        } catch (err) {
          cli.logger.error(
            `You need to install 'webpack-dev-server' for running 'webpack serve'.\n${err}`
          );

          // 退出进程
          process.exit(2);
        }

        // 判断是否有多个编译器实例（适用于多配置场景），并将它们存储到 compilers 数组中
        const compilers = cli.isMultipleCompiler(compiler)
          ? compiler.compilers
          : [compiler];
        // 筛选出带 devServer 选项的编译器实例
        const possibleCompilers = compilers.filter(
          (compiler) => compiler.options.devServer
        );

        // 如果没有任何一个编译器带有 devServer 配置，则默认使用第一个编译器
        const compilersForDevServer =
          possibleCompilers.length > 0 ? possibleCompilers : [compilers[0]];

        // 跟踪已经使用的端口，确保多个服务器实例不重复占用同一端口
        const usedPorts = [];

        // 对所有带有 devServer配置的 编辑器实例 实例化一个 DevServer 并启动
        for (const compilerForDevServer of compilersForDevServer) {
          // args 构建 devServerFlags 是一个包含所有开发服务器选项标志的数组
          const args = devServerFlags.reduce((accumulator, flag) => {
            accumulator[flag.name] = flag;
            return accumulator;
          }, {});

          const values = Object.keys(devServerCLIOptions).reduce(
            (accumulator, name) => {
              // 将 dev-server 配置项的 key 转为 -连字符
              const kebabName = cli.toKebabCase(name);

              // 若转换后的名称存在于 args 中，意味着该选项是合法的开发服务器选项，
              if (args[kebabName]) {
                // 将其值存入 values，以供后续使用。
                accumulator[kebabName] = options[name];
              }
              return accumulator;
            },
            {}
          );

          // 将当前 编译器实例的 dev配置提取出来
          // 作为当前开发服务器实例的选项配置基础。
          const result = Object.assign(
            {},
            compilerForDevServer.options.devServer || {}
          );

          const problems = (
            cli.webpack.cli &&
            typeof cli.webpack.cli.processArguments === "function"
              ? cli.webpack.cli
              : DevServer.cli
          )
            // args 包含标志定义 result 是现有的 devServer 配置 values 是用户提供的选项
            // 调用 processArguments 方法解析并验证传入的选项
            // 若选项值不符合预期会被记录在 problems 中
            .processArguments(args, result, values);

          if (problems) {
            // 说明参数验证失败，需要输出错误并停止程序

            /**
             * 定义一个分组函数
             *
             *
             * @param {Array} xs
             * @param {String} key
             * @returns
             *
             * @example
             * groupBy([{path: 'a'}, {path: 'b'}, {path: 'a'}], 'path')
             * 返回 { a: [{path: 'a'}, {path: 'a'}], b: [{path: 'b'}] }
             */
            const groupBy = (xs, key) => {
              // 根据 key 对数组元素进行分组

              /**
               * (rv[x[key]] = rv[x[key]] || []).push(x);
               * 这行代码 先检查 rv[x[key]] 是否已存在
               * - 如果存在，使用现有的数组 rv[x[key]]
               * - 如果不存在，将 rv[x[key]] 设置为一个新的空数组 []
               * 将 x 推入 rv[x[key]]
               */
              return xs.reduce((rv, x) => {
                (rv[x[key]] = rv[x[key]] || []).push(x);
                return rv;
              }, {});
            };
            const problemsByPath = groupBy(problems, "path");

            // path 作为键，代表某个特定路径的所有问题
            // problems 是该路径下的所有问题数组，逐一遍历 problems 输出每个问题的详细信息
            for (const path in problemsByPath) {
              const problems = problemsByPath[path];
              for (const problem of problems) {
                cli.logger.error(
                  // 首字母大写
                  `${cli.capitalizeFirstLetter(
                    // 将问题类型中的连字符（例如 "invalid-value"）替换为空格，使之更具可读性
                    problem.type.replace(/-/g, " ")
                  )}${problem.value ? ` '${problem.value}'` : ""} for the '--${
                    // 标识出问题所在的参数，例如 --port
                    problem.argument
                  }' option${
                    // 若问题属于数组形式参数的某一项，显示其索引位置
                    problem.index ? ` by index '${problem.index}'` : ""
                  }`
                );
                // 若存在预期值，将此值输出，帮助用户理解参数要求
                if (problem.expected) {
                  cli.logger.error(`Expected: '${problem.expected}'`);
                }
              }
            }
            // 程序输出所有错误后，立即退出，返回状态码 2 表示异常终止
            process.exit(2);
          }

          // result 中已经包含了当前编译器的开发服务器配置，通过 devServerOptions 变量保存以供后续使用
          const devServerOptions = result;
          if (devServerOptions.port) {
            // 如果 devServerOptions 中设置了 port 属性，就会进行端口唯一性检查
            const portNumber = Number(devServerOptions.port);

            // 如果找到相同端口，抛出错误提示，告知用户必须为每个 devServer 实例指定独特的端口号
            if (usedPorts.find((port) => portNumber === port)) {
              throw new Error(
                "Unique ports must be specified for each devServer option in your webpack configuration. Alternatively, run only 1 devServer config using the --config-name flag to specify your desired config."
              );
            }

            // 通过检查 将端口号添加到 usedPorts 数组中，以便后续检查时避免重复使用该端口
            usedPorts.push(portNumber);
          }

          try {
            // 创建 devServer 实例
            // devServerOptions（当前编译器的开发服务器配置）和 compiler（webpack 编译器实例）
            const server = new DevServer(devServerOptions, compiler);
            // 启动 DevServer 实例，并使其开始监听指定端口并提供服务
            await server.start();

            // 将新启动的 server 实例添加到 servers 数组中
            // 在程序退出或需要手动关闭服务器时，可以批量处理所有服务器实例
            servers.push(server);
          } catch (error) {
            // 启动 DevServer 出现错误

            // 检查错误类型是否为参数校验错误
            if (cli.isValidationError(error)) {
              cli.logger.error(error.message);
            } else {
              // 将完整错误对象输出到日志中
              cli.logger.error(error);
            }

            // 退出进程
            process.exit(2);
          }
        }
      }
    );
  }
}
exports.default = ServeCommand;
