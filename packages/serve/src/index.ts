import { type Compiler, type cli } from "webpack";
import { type IWebpackCLI, type WebpackDevServerOptions } from "webpack-cli";

/**
 * 这两行代码定义了环境变量，用于动态设置 webpack 和 webpack-dev-server 包的名称
 * 如果环境变量不存在，默认使用 webpack 和 webpack-dev-server
 */
const WEBPACK_PACKAGE = process.env.WEBPACK_PACKAGE || "webpack";
const WEBPACK_DEV_SERVER_PACKAGE =
  process.env.WEBPACK_DEV_SERVER_PACKAGE || "webpack-dev-server";

type Problem = NonNullable<ReturnType<(typeof cli)["processArguments"]>>[0];

/**
 * 这个类是负责执行serve 命令的，通过 apply 方法用来启动开发服务器，并且处理一些参数
 */
class ServeCommand {
  /**
   * 用于启动 webpack-dev-server 并进行实时的开发和调试
   * 启动 Webpack 编译器和开发服务器，监听文件变化并热更新
   * @param cli webpack-cli 的实例
   */
  async apply(cli: IWebpackCLI): Promise<void> {
    /**
     * 这个函数负责加载 webpack-dev-server 的配置选项，并将其转换为 CLI 可以识别的格式
     * @returns
     */
    const loadDevServerOptions = () => {
      // 动态加载 webpack-dev-server 包
      const devServer = require(WEBPACK_DEV_SERVER_PACKAGE);
      /**
       * 从 webpack-dev-server 中提取其 schema 并将其转换为可供命令行工具使用的参数
       * devServer.schema 是 webpack-dev-server 预定义的 schema 文件，定义了可用的 CLI 参数的结构
       */
      const options: Record<string, any> = cli.webpack.cli.getArguments(
        devServer.schema
      );
      // New options format
      // { flag1: {}, flag2: {} }
      // 将 options 对象的键（即每个选项的名称）映射为 name 属性，
      // 这样在后续处理时可以更容易地进行 CLI 选项的识别
      return Object.keys(options).map((key) => {
        options[key].name = key;

        return options[key];
      });
    };

    await cli.makeCommand(
      // 创建一个名为 serve 的命令
      {
        name: "serve [entries...]",
        alias: ["server", "s"],
        description:
          "Run the webpack dev server and watch for source file changes while serving.",
        usage: "[entries...] [options]",
        pkg: "@webpack-cli/serve",
        dependencies: [WEBPACK_PACKAGE, WEBPACK_DEV_SERVER_PACKAGE],
      },
      // 异步函数获取选项
      async () => {
        // 存放开发服务器的选项
        let devServerFlags = [];

        // 加载 Webpack 配置
        cli.webpack = await cli.loadWebpack();

        try {
          // 尝试加载开发服务器的选项
          devServerFlags = loadDevServerOptions();
        } catch (error) {
          cli.logger.error(
            `You need to install 'webpack-dev-server' for running 'webpack serve'.\n${error}`
          );
          process.exit(2);
        }

        // 获取内置的命令选项
        const builtInOptions = cli.getBuiltInOptions();

        // 合并
        return [...builtInOptions, ...devServerFlags];
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (entries: string[], options: any) => {
        const builtInOptions = cli.getBuiltInOptions();
        let devServerFlags = [];

        try {
          devServerFlags = loadDevServerOptions();
        } catch (_err) {
          // Nothing, to prevent future updates
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const webpackCLIOptions: Record<string, any> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const devServerCLIOptions: Record<string, any> = {};

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const processors: Array<(opts: Record<string, any>) => void> = [];

        for (const optionName in options) {
          const kebabedOption = cli.toKebabCase(optionName);
          const isBuiltInOption = builtInOptions.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (builtInOption: any) => builtInOption.name === kebabedOption
          );

          if (isBuiltInOption) {
            webpackCLIOptions[optionName] = options[optionName];
          } else {
            const needToProcess = devServerFlags.find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (devServerOption: any) =>
                devServerOption.name === kebabedOption &&
                devServerOption.processor
            );

            if (needToProcess) {
              processors.push(needToProcess.processor);
            }

            devServerCLIOptions[optionName] = options[optionName];
          }
        }

        for (const processor of processors) {
          processor(devServerCLIOptions);
        }

        if (entries.length > 0) {
          webpackCLIOptions.entry = [
            ...entries,
            ...(webpackCLIOptions.entry || []),
          ];
        }

        webpackCLIOptions.argv = {
          ...options,
          env: { WEBPACK_SERVE: true, ...options.env },
        };

        webpackCLIOptions.isWatchingLikeCommand = true;

        const compiler = await cli.createCompiler(webpackCLIOptions);

        if (!compiler) {
          return;
        }

        const servers: (typeof DevServer)[] = [];

        if (cli.needWatchStdin(compiler)) {
          process.stdin.on("end", () => {
            Promise.all(
              servers.map((server) => {
                return server.stop();
              })
            ).then(() => {
              process.exit(0);
            });
          });
          process.stdin.resume();
        }

        const DevServer = require(WEBPACK_DEV_SERVER_PACKAGE);

        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          require(`${WEBPACK_DEV_SERVER_PACKAGE}/package.json`).version;
        } catch (err) {
          cli.logger.error(
            `You need to install 'webpack-dev-server' for running 'webpack serve'.\n${err}`
          );
          process.exit(2);
        }

        const compilers = cli.isMultipleCompiler(compiler)
          ? compiler.compilers
          : [compiler];
        const possibleCompilers = compilers.filter(
          (compiler: Compiler) => compiler.options.devServer
        );
        const compilersForDevServer =
          possibleCompilers.length > 0 ? possibleCompilers : [compilers[0]];
        const usedPorts: number[] = [];

        for (const compilerForDevServer of compilersForDevServer) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          if (compilerForDevServer.options.devServer === false) {
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = devServerFlags.reduce(
            (accumulator: Record<string, any>, flag: any) => {
              accumulator[flag.name] = flag;

              return accumulator;
            },
            {}
          );
          const values = Object.keys(devServerCLIOptions).reduce(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (accumulator: Record<string, any>, name: string) => {
              const kebabName = cli.toKebabCase(name);

              if (args[kebabName]) {
                accumulator[kebabName] = options[name];
              }

              return accumulator;
            },
            {}
          );
          const result = { ...(compilerForDevServer.options.devServer || {}) };
          const problems = (
            cli.webpack.cli &&
            typeof cli.webpack.cli.processArguments === "function"
              ? cli.webpack.cli
              : DevServer.cli
          ).processArguments(args, result, values);

          if (problems) {
            const groupBy = (xs: Problem[], key: keyof Problem) => {
              return xs.reduce(
                (rv: { [key: string]: Problem[] }, x: Problem) => {
                  (rv[x[key]] = rv[x[key]] || []).push(x);

                  return rv;
                },
                {}
              );
            };

            const problemsByPath = groupBy(problems, "path");

            for (const path in problemsByPath) {
              const problems = problemsByPath[path];

              for (const problem of problems) {
                cli.logger.error(
                  `${cli.capitalizeFirstLetter(
                    problem.type.replace(/-/g, " ")
                  )}${problem.value ? ` '${problem.value}'` : ""} for the '--${
                    problem.argument
                  }' option${
                    problem.index ? ` by index '${problem.index}'` : ""
                  }`
                );

                if (problem.expected) {
                  cli.logger.error(`Expected: '${problem.expected}'`);
                }
              }
            }

            process.exit(2);
          }

          const devServerOptions: WebpackDevServerOptions =
            result as WebpackDevServerOptions;

          if (devServerOptions.port) {
            const portNumber = Number(devServerOptions.port);

            if (usedPorts.find((port) => portNumber === port)) {
              throw new Error(
                "Unique ports must be specified for each devServer option in your webpack configuration. Alternatively, run only 1 devServer config using the --config-name flag to specify your desired config."
              );
            }

            usedPorts.push(portNumber);
          }

          try {
            const server = new DevServer(devServerOptions, compiler);

            await server.start();

            servers.push(server);
          } catch (error) {
            if (cli.isValidationError(error as Error)) {
              cli.logger.error((error as Error).message);
            } else {
              cli.logger.error(error);
            }

            process.exit(2);
          }
        }

        if (servers.length === 0) {
          cli.logger.error("No dev server configurations to run");
          process.exit(2);
        }
      }
    );
  }
}

export default ServeCommand;
