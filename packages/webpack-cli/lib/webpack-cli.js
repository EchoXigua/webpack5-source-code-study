"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const util = require("util");

// commander 用于构建命令行界面 (CLI) 工具，它提供了一种简便的方法来定义和解析命令行参数和选项
const { program, Option } = require("commander");

/**
 * 这段代码主要用于确定 Webpack 和 Webpack Dev Server 的包名称，
 * 特别是如果有自定义环境变量指定了这些包的名称时。
 * 它会使用环境变量来决定使用的包名，或者在没有自定义包名的情况下使用默认值。
 */
const WEBPACK_PACKAGE_IS_CUSTOM = !!process.env.WEBPACK_PACKAGE;
// 存在自定义包名则使用自定义的 否则使用默认的 webpack
const WEBPACK_PACKAGE = WEBPACK_PACKAGE_IS_CUSTOM
  ? process.env.WEBPACK_PACKAGE
  : "webpack";

// webpack-dev-server存在自定义包名则使用自定义的 否则使用默认的 webpack-dev-server
const WEBPACK_DEV_SERVER_PACKAGE_IS_CUSTOM =
  !!process.env.WEBPACK_DEV_SERVER_PACKAGE;
const WEBPACK_DEV_SERVER_PACKAGE = WEBPACK_DEV_SERVER_PACKAGE_IS_CUSTOM
  ? process.env.WEBPACK_DEV_SERVER_PACKAGE
  : "webpack-dev-server";

class WebpackCLI {
  constructor() {
    // 处理颜色
    this.colors = this.createColors();
    // 处理日志
    this.logger = this.getLogger();
    // Initialize program
    this.program = program;
    this.program.name("webpack");

    // 配置 program 对象的输出行为，用于定制错误输出的格式和处理方式
    this.program.configureOutput({
      writeErr: this.logger.error,
      outputError: (str, write) =>
        write(
          `Error: ${this.capitalizeFirstLetter(
            str.replace(/^error:/, "").trim()
          )}`
        ),
    });
  }
  isMultipleCompiler(compiler) {
    return compiler.compilers;
  }
  isPromise(value) {
    return typeof value.then === "function";
  }
  isFunction(value) {
    return typeof value === "function";
  }
  capitalizeFirstLetter(str) {
    if (typeof str !== "string") {
      return "";
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  /**
   * 将一个字符串转换为 kebab-case 格式，将驼峰转为连字符
   *
   * @example
   * 输入 "camelCase"
   * 正则表达式会匹配 "mC"，替换为 "m-C",通过转小写
   * 最终输出为 "camel-case"
   * @returns
   */
  toKebabCase(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  }
  createColors(useColor) {
    /**
     * colorette 是一个用于在终端中处理颜色的库
     * isColorSupported, 用于检测终端是否支持颜色的函数
     */
    const { createColors, isColorSupported } = require("colorette");
    let shouldUseColor;
    if (useColor) {
      shouldUseColor = useColor;
    } else {
      shouldUseColor = isColorSupported;
    }
    return Object.assign(
      Object.assign({}, createColors({ useColor: shouldUseColor })),
      { isColorSupported: shouldUseColor }
    );
  }
  getLogger() {
    return {
      error: (val) =>
        console.error(`[webpack-cli] ${this.colors.red(util.format(val))}`),
      warn: (val) => console.warn(`[webpack-cli] ${this.colors.yellow(val)}`),
      info: (val) => console.info(`[webpack-cli] ${this.colors.cyan(val)}`),
      success: (val) => console.log(`[webpack-cli] ${this.colors.green(val)}`),
      log: (val) => console.log(`[webpack-cli] ${val}`),
      raw: (val) => console.log(val),
    };
  }
  checkPackageExists(packageName) {
    if (process.versions.pnp) {
      return true;
    }
    let dir = __dirname;
    do {
      try {
        if (
          fs.statSync(path.join(dir, "node_modules", packageName)).isDirectory()
        ) {
          return true;
        }
      } catch (_error) {
        // Nothing
      }
    } while (dir !== (dir = path.dirname(dir)));
    // https://github.com/nodejs/node/blob/v18.9.1/lib/internal/modules/cjs/loader.js#L1274
    for (const internalPath of require("module").globalPaths) {
      try {
        if (fs.statSync(path.join(internalPath, packageName)).isDirectory()) {
          return true;
        }
      } catch (_error) {
        // Nothing
      }
    }
    return false;
  }
  getAvailablePackageManagers() {
    const { sync } = require("cross-spawn");
    const installers = ["npm", "yarn", "pnpm"];
    const hasPackageManagerInstalled = (packageManager) => {
      try {
        sync(packageManager, ["--version"]);
        return packageManager;
      } catch (err) {
        return false;
      }
    };
    const availableInstallers = installers.filter((installer) =>
      hasPackageManagerInstalled(installer)
    );
    if (!availableInstallers.length) {
      this.logger.error("No package manager found.");
      process.exit(2);
    }
    return availableInstallers;
  }
  getDefaultPackageManager() {
    const { sync } = require("cross-spawn");
    const hasLocalNpm = fs.existsSync(
      path.resolve(process.cwd(), "package-lock.json")
    );
    if (hasLocalNpm) {
      return "npm";
    }
    const hasLocalYarn = fs.existsSync(
      path.resolve(process.cwd(), "yarn.lock")
    );
    if (hasLocalYarn) {
      return "yarn";
    }
    const hasLocalPnpm = fs.existsSync(
      path.resolve(process.cwd(), "pnpm-lock.yaml")
    );
    if (hasLocalPnpm) {
      return "pnpm";
    }
    try {
      // the sync function below will fail if npm is not installed,
      // an error will be thrown
      if (sync("npm", ["--version"])) {
        return "npm";
      }
    } catch (e) {
      // Nothing
    }
    try {
      // the sync function below will fail if yarn is not installed,
      // an error will be thrown
      if (sync("yarn", ["--version"])) {
        return "yarn";
      }
    } catch (e) {
      // Nothing
    }
    try {
      // the sync function below will fail if pnpm is not installed,
      // an error will be thrown
      if (sync("pnpm", ["--version"])) {
        return "pnpm";
      }
    } catch (e) {
      this.logger.error("No package manager found.");
      process.exit(2);
    }
  }
  async doInstall(packageName, options = {}) {
    const packageManager = this.getDefaultPackageManager();
    if (!packageManager) {
      this.logger.error("Can't find package manager");
      process.exit(2);
    }
    if (options.preMessage) {
      options.preMessage();
    }
    const prompt = ({ message, defaultResponse, stream }) => {
      const readline = require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: stream,
      });
      return new Promise((resolve) => {
        rl.question(`${message} `, (answer) => {
          // Close the stream
          rl.close();
          const response = (answer || defaultResponse).toLowerCase();
          // Resolve with the input response
          if (response === "y" || response === "yes") {
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
    };
    // yarn uses 'add' command, rest npm and pnpm both use 'install'
    const commandArguments = [
      packageManager === "yarn" ? "add" : "install",
      "-D",
      packageName,
    ];
    const commandToBeRun = `${packageManager} ${commandArguments.join(" ")}`;
    let needInstall;
    try {
      needInstall = await prompt({
        message: `[webpack-cli] Would you like to install '${this.colors.green(
          packageName
        )}' package? (That will run '${this.colors.green(
          commandToBeRun
        )}') (${this.colors.yellow("Y/n")})`,
        defaultResponse: "Y",
        stream: process.stderr,
      });
    } catch (error) {
      this.logger.error(error);
      process.exit(error);
    }
    if (needInstall) {
      const { sync } = require("cross-spawn");
      try {
        sync(packageManager, commandArguments, { stdio: "inherit" });
      } catch (error) {
        this.logger.error(error);
        process.exit(2);
      }
      return packageName;
    }
    process.exit(2);
  }
  async tryRequireThenImport(
    module,
    handleError = true,
    moduleType = "unknown"
  ) {
    let result;
    switch (moduleType) {
      case "unknown": {
        try {
          result = require(module);
        } catch (error) {
          const dynamicImportLoader =
            require("./utils/dynamic-import-loader")();
          if (
            (error.code === "ERR_REQUIRE_ESM" ||
              process.env.WEBPACK_CLI_FORCE_LOAD_ESM_CONFIG) &&
            pathToFileURL &&
            dynamicImportLoader
          ) {
            const urlForConfig = pathToFileURL(module);
            result = await dynamicImportLoader(urlForConfig);
            result = result.default;
            return result;
          }
          if (handleError) {
            this.logger.error(error);
            process.exit(2);
          } else {
            throw error;
          }
        }
        break;
      }
      case "commonjs": {
        try {
          result = require(module);
        } catch (error) {
          if (handleError) {
            this.logger.error(error);
            process.exit(2);
          } else {
            throw error;
          }
        }
        break;
      }
      case "esm": {
        try {
          const dynamicImportLoader =
            require("./utils/dynamic-import-loader")();
          if (pathToFileURL && dynamicImportLoader) {
            const urlForConfig = pathToFileURL(module);
            result = await dynamicImportLoader(urlForConfig);
            result = result.default;
            return result;
          }
        } catch (error) {
          if (handleError) {
            this.logger.error(error);
            process.exit(2);
          } else {
            throw error;
          }
        }
        break;
      }
    }
    // For babel and other, only commonjs
    if (result && typeof result === "object" && "default" in result) {
      result = result.default || {};
    }
    return result || {};
  }
  loadJSONFile(pathToFile, handleError = true) {
    let result;
    try {
      result = require(pathToFile);
    } catch (error) {
      if (handleError) {
        this.logger.error(error);
        process.exit(2);
      } else {
        throw error;
      }
    }
    return result;
  }
  getInfoOptions() {
    return [
      {
        name: "output",
        alias: "o",
        configs: [
          {
            type: "string",
          },
        ],
        description:
          "To get the output in a specified format ( accept json or markdown )",
        helpLevel: "minimum",
      },
      {
        name: "additional-package",
        alias: "a",
        configs: [{ type: "string" }],
        multiple: true,
        description: "Adds additional packages to the output",
        helpLevel: "minimum",
      },
    ];
  }
  async getInfoOutput(options) {
    let { output } = options;
    const envinfoConfig = {};
    if (output) {
      // Remove quotes if exist
      output = output.replace(/['"]+/g, "");
      switch (output) {
        case "markdown":
          envinfoConfig["markdown"] = true;
          break;
        case "json":
          envinfoConfig["json"] = true;
          break;
        default:
          this.logger.error(`'${output}' is not a valid value for output`);
          process.exit(2);
      }
    }
    const defaultInformation = {
      Binaries: ["Node", "Yarn", "npm"],
      Browsers: [
        "Brave Browser",
        "Chrome",
        "Chrome Canary",
        "Edge",
        "Firefox",
        "Firefox Developer Edition",
        "Firefox Nightly",
        "Internet Explorer",
        "Safari",
        "Safari Technology Preview",
      ],
      Monorepos: ["Yarn Workspaces", "Lerna"],
      System: ["OS", "CPU", "Memory"],
      npmGlobalPackages: ["webpack", "webpack-cli", "webpack-dev-server"],
    };
    let defaultPackages = ["webpack", "loader", "@webpack-cli/"];
    if (typeof options.additionalPackage !== "undefined") {
      defaultPackages = [...defaultPackages, ...options.additionalPackage];
    }
    defaultInformation.npmPackages = `{${defaultPackages
      .map((item) => `*${item}*`)
      .join(",")}}`;
    const envinfo = await this.tryRequireThenImport("envinfo", false);
    let info = await envinfo.run(defaultInformation, envinfoConfig);
    info = info.replace(/npmPackages/g, "Packages");
    info = info.replace(/npmGlobalPackages/g, "Global Packages");
    return info;
  }

  /**
   * 用于在命令行界面中创建命令的方法，主要用于配置和初始化新的命令
   * 主要功能是检查和安装依赖、设置命令选项和描述、以及定义命令执行时的行为
   *
   * @param {*} commandOptions
   * @param {*} options
   * @param {*} action
   * @returns
   */
  async makeCommand(commandOptions, options, action) {
    // 检查命令是否已经加载
    const alreadyLoaded = this.program.commands.find(
      (command) =>
        command.name() === commandOptions.name.split(" ")[0] ||
        command.aliases().includes(commandOptions.alias)
    );
    if (alreadyLoaded) {
      return;
    }

    // 创建一个新的命令，并传入命令的名称和一些选项
    const command = this.program.command(commandOptions.name, {
      hidden: commandOptions.hidden,
      isDefault: commandOptions.isDefault,
    });

    //  设置命令的描述和用法
    if (commandOptions.description) {
      command.description(
        commandOptions.description,
        commandOptions.argsDescription
      );
    }
    if (commandOptions.usage) {
      command.usage(commandOptions.usage);
    }
    // 设置命令的别名
    if (Array.isArray(commandOptions.alias)) {
      command.aliases(commandOptions.alias);
    } else {
      command.alias(commandOptions.alias);
    }
    // 设置命令的包信息，不存在默认为 webpack-cli
    if (commandOptions.pkg) {
      command.pkg = commandOptions.pkg;
    } else {
      command.pkg = "webpack-cli";
    }

    // 当前是否处于帮助模式
    const { forHelp } = this.program;
    // 默认所有的依赖已经安装
    let allDependenciesInstalled = true;
    if (commandOptions.dependencies && commandOptions.dependencies.length > 0) {
      // 遍历所有的依赖，检查每个依赖是否安装
      // 如果依赖不存在且处于帮助模式，设置为 allDependenciesInstalled 为 false，表示不是所有依赖都已安装
      for (const dependency of commandOptions.dependencies) {
        // 检查包是否存在
        const isPkgExist = this.checkPackageExists(dependency);
        if (isPkgExist) {
          continue;
        } else if (!isPkgExist && forHelp) {
          allDependenciesInstalled = false;
          continue;
        }

        // 判断是否需要跳过安装当前依赖
        let skipInstallation = false;

        /**
         * 有两个条件决定是否跳过安装：
         */
        // Allow to use `./path/to/webpack.js` outside `node_modules`
        if (dependency === WEBPACK_PACKAGE && WEBPACK_PACKAGE_IS_CUSTOM) {
          skipInstallation = true;
        }
        // Allow to use `./path/to/webpack-dev-server.js` outside `node_modules`
        if (
          dependency === WEBPACK_DEV_SERVER_PACKAGE &&
          WEBPACK_DEV_SERVER_PACKAGE_IS_CUSTOM
        ) {
          skipInstallation = true;
        }
        if (skipInstallation) {
          continue;
        }

        // 安装确实的依赖
        await this.doInstall(dependency, {
          // 在安装前打印出错误信息，提示用户需要安装哪个包
          preMessage: () => {
            this.logger.error(
              `For using '${this.colors.green(
                commandOptions.name.split(" ")[0]
              )}' command you need to install: '${this.colors.green(
                dependency
              )}' package.`
            );
          },
        });
      }
    }

    // 这段代码主要处理命令行工具中与选项相关的逻辑
    if (options) {
      // 处理配置项为函数的清空
      if (typeof options === "function") {
        if (
          forHelp &&
          !allDependenciesInstalled &&
          commandOptions.dependencies
        ) {
          // 帮助模式下
          // 告知用户需要安装哪些依赖才能看到所有可用选项
          command.description(
            `${
              commandOptions.description
            } To see all available options you need to install ${commandOptions.dependencies
              .map((dependency) => `'${dependency}'`)
              .join(", ")}.`
          );
          // 设置为一个空数组，以避免后续的选项处理
          options = [];
        } else {
          options = await options();
        }
      }

      // 处理选项数组
      for (const option of options) {
        // 注册这些选项到命令中
        this.makeOption(command, option);
      }
    }

    // 将用户提供的 action 函数绑定到该命令上
    // 这意味着当用户在命令行中执行该命令时，将会调用 action 函数
    command.action(action);
    return command;
  }
  makeOption(command, option) {
    let mainOption;
    let negativeOption;
    const flagsWithAlias = ["devtool", "output-path", "target", "watch"];
    if (flagsWithAlias.includes(option.name)) {
      option.alias = option.name[0];
    }
    if (option.configs) {
      let needNegativeOption = false;
      let negatedDescription;
      const mainOptionType = new Set();
      for (const config of option.configs) {
        switch (config.type) {
          case "reset":
            mainOptionType.add(Boolean);
            break;
          case "boolean":
            if (!needNegativeOption) {
              needNegativeOption = true;
              negatedDescription = config.negatedDescription;
            }
            mainOptionType.add(Boolean);
            break;
          case "number":
            mainOptionType.add(Number);
            break;
          case "string":
          case "path":
          case "RegExp":
            mainOptionType.add(String);
            break;
          case "enum": {
            let hasFalseEnum = false;
            for (const value of config.values || []) {
              switch (typeof value) {
                case "string":
                  mainOptionType.add(String);
                  break;
                case "number":
                  mainOptionType.add(Number);
                  break;
                case "boolean":
                  if (!hasFalseEnum && value === false) {
                    hasFalseEnum = true;
                    break;
                  }
                  mainOptionType.add(Boolean);
                  break;
              }
            }
            if (!needNegativeOption) {
              needNegativeOption = hasFalseEnum;
              negatedDescription = config.negatedDescription;
            }
          }
        }
      }
      mainOption = {
        flags: option.alias
          ? `-${option.alias}, --${option.name}`
          : `--${option.name}`,
        valueName: option.valueName || "value",
        description: option.description || "",
        type: mainOptionType,
        multiple: option.multiple,
        defaultValue: option.defaultValue,
      };
      if (needNegativeOption) {
        negativeOption = {
          flags: `--no-${option.name}`,
          description:
            negatedDescription ||
            option.negatedDescription ||
            `Negative '${option.name}' option.`,
        };
      }
    } else {
      mainOption = {
        flags: option.alias
          ? `-${option.alias}, --${option.name}`
          : `--${option.name}`,
        valueName: option.valueName || "value",
        description: option.description || "",
        type: option.type
          ? new Set(Array.isArray(option.type) ? option.type : [option.type])
          : new Set([Boolean]),
        multiple: option.multiple,
        defaultValue: option.defaultValue,
      };
      if (option.negative) {
        negativeOption = {
          flags: `--no-${option.name}`,
          description: option.negatedDescription
            ? option.negatedDescription
            : `Negative '${option.name}' option.`,
        };
      }
    }
    if (mainOption.type.size > 1 && mainOption.type.has(Boolean)) {
      mainOption.flags = `${mainOption.flags} [${
        mainOption.valueName || "value"
      }${mainOption.multiple ? "..." : ""}]`;
    } else if (mainOption.type.size > 0 && !mainOption.type.has(Boolean)) {
      mainOption.flags = `${mainOption.flags} <${
        mainOption.valueName || "value"
      }${mainOption.multiple ? "..." : ""}>`;
    }
    if (mainOption.type.size === 1) {
      if (mainOption.type.has(Number)) {
        let skipDefault = true;
        const optionForCommand = new Option(
          mainOption.flags,
          mainOption.description
        )
          .argParser((value, prev = []) => {
            if (mainOption.defaultValue && mainOption.multiple && skipDefault) {
              prev = [];
              skipDefault = false;
            }
            return mainOption.multiple
              ? [].concat(prev).concat(Number(value))
              : Number(value);
          })
          .default(mainOption.defaultValue);
        optionForCommand.helpLevel = option.helpLevel;
        command.addOption(optionForCommand);
      } else if (mainOption.type.has(String)) {
        let skipDefault = true;
        const optionForCommand = new Option(
          mainOption.flags,
          mainOption.description
        )
          .argParser((value, prev = []) => {
            if (mainOption.defaultValue && mainOption.multiple && skipDefault) {
              prev = [];
              skipDefault = false;
            }
            return mainOption.multiple ? [].concat(prev).concat(value) : value;
          })
          .default(mainOption.defaultValue);
        optionForCommand.helpLevel = option.helpLevel;
        command.addOption(optionForCommand);
      } else if (mainOption.type.has(Boolean)) {
        const optionForCommand = new Option(
          mainOption.flags,
          mainOption.description
        ).default(mainOption.defaultValue);
        optionForCommand.helpLevel = option.helpLevel;
        command.addOption(optionForCommand);
      } else {
        const optionForCommand = new Option(
          mainOption.flags,
          mainOption.description
        )
          .argParser(Array.from(mainOption.type)[0])
          .default(mainOption.defaultValue);
        optionForCommand.helpLevel = option.helpLevel;
        command.addOption(optionForCommand);
      }
    } else if (mainOption.type.size > 1) {
      let skipDefault = true;
      const optionForCommand = new Option(
        mainOption.flags,
        mainOption.description,
        mainOption.defaultValue
      )
        .argParser((value, prev = []) => {
          if (mainOption.defaultValue && mainOption.multiple && skipDefault) {
            prev = [];
            skipDefault = false;
          }
          if (mainOption.type.has(Number)) {
            const numberValue = Number(value);
            if (!isNaN(numberValue)) {
              return mainOption.multiple
                ? [].concat(prev).concat(numberValue)
                : numberValue;
            }
          }
          if (mainOption.type.has(String)) {
            return mainOption.multiple ? [].concat(prev).concat(value) : value;
          }
          return value;
        })
        .default(mainOption.defaultValue);
      optionForCommand.helpLevel = option.helpLevel;
      command.addOption(optionForCommand);
    } else if (mainOption.type.size === 0 && negativeOption) {
      const optionForCommand = new Option(
        mainOption.flags,
        mainOption.description
      );
      // Hide stub option
      optionForCommand.hideHelp();
      optionForCommand.helpLevel = option.helpLevel;
      command.addOption(optionForCommand);
    }
    if (negativeOption) {
      const optionForCommand = new Option(
        negativeOption.flags,
        negativeOption.description
      );
      optionForCommand.helpLevel = option.helpLevel;
      command.addOption(optionForCommand);
    }
  }

  /**
   * 这个函数返回 webpack CLI 支持的所有内建选项
   * 包括配置文件路径、环境变量设置、进度指示等
   * @returns
   */
  getBuiltInOptions() {
    // 如果已存在，直接返回缓存的选项列表
    if (this.builtInOptionsCache) {
      return this.builtInOptionsCache;
    }

    // 定义了一系列 webpack CLI 的内建选项
    /**
     * 每个 flag 的配置结构如下：
     * - name：参数名称，用户可以通过命令行使用
     * - alias：参数别名，如 config 的别名是 c
     * - configs：定义参数类型及其有效值（例如 type: "string" 或 type: "enum"）
     * - multiple：如果为 true，则允许传递多个值
     * - valueName：显示在帮助信息中的参数名
     * - description：描述该选项的作用
     * - helpLevel：帮助级别，指示该选项在什么情况下显示帮助信息
     *
     *
     * env 选项用于解析环境变量，并将其作为键值对传递给配置函数
     * myvar=myval 会被解析为 { myvar: "myval" }，
     * 而没有值的 myvar 会被解析为 { myvar: true }
     *
     *
     * flags 允许用户通过命令行对 Webpack 的构建过程进行细粒度的控制
     * flags 是用户在终端中传递给 CLI 的参数或选项，用于改变其默认行为
     * 如：
     * - webpack --mode production --watch
     * - webpack --entry ./src/index.js --output-path ./dist
     * - webpack --analyze
     */
    const builtInFlags = [
      // For configs
      {
        name: "config",
        alias: "c",
        configs: [
          {
            type: "string",
          },
        ],
        multiple: true,
        valueName: "pathToConfigFile",
        description:
          'Provide path to one or more webpack configuration files to process, e.g. "./webpack.config.js".',
        helpLevel: "minimum",
      },
      {
        name: "config-name",
        configs: [
          {
            type: "string",
          },
        ],
        multiple: true,
        valueName: "name",
        description:
          "Name(s) of particular configuration(s) to use if configuration file exports an array of multiple configurations.",
        helpLevel: "minimum",
      },
      {
        name: "merge",
        alias: "m",
        configs: [
          {
            type: "enum",
            values: [true],
          },
        ],
        description: "Merge two or more configurations using 'webpack-merge'.",
        helpLevel: "minimum",
      },
      {
        name: "disable-interpret",
        configs: [
          {
            type: "enum",
            values: [true],
          },
        ],
        description: "Disable interpret for loading the config file.",
        helpLevel: "minimum",
      },
      // Complex configs
      {
        name: "env",
        type: (value, previous = {}) => {
          // This ensures we're only splitting by the first `=`
          const [allKeys, val] = value.split(/=(.+)/, 2);
          const splitKeys = allKeys.split(/\.(?!$)/);
          let prevRef = previous;
          splitKeys.forEach((someKey, index) => {
            // https://github.com/webpack/webpack-cli/issues/3284
            if (someKey.endsWith("=")) {
              // remove '=' from key
              someKey = someKey.slice(0, -1);
              // @ts-expect-error we explicitly want to set it to undefined
              prevRef[someKey] = undefined;
              return;
            }
            if (!prevRef[someKey]) {
              prevRef[someKey] = {};
            }
            if (typeof prevRef[someKey] === "string") {
              prevRef[someKey] = {};
            }
            if (index === splitKeys.length - 1) {
              if (typeof val === "string") {
                prevRef[someKey] = val;
              } else {
                prevRef[someKey] = true;
              }
            }
            prevRef = prevRef[someKey];
          });
          return previous;
        },
        multiple: true,
        description:
          'Environment variables passed to the configuration when it is a function, e.g. "myvar" or "myvar=myval".',
        helpLevel: "minimum",
      },
      {
        name: "node-env",
        configs: [
          {
            type: "string",
          },
        ],
        multiple: false,
        description: "Sets process.env.NODE_ENV to the specified value.",
        helpLevel: "minimum",
      },
      {
        name: "define-process-env-node-env",
        configs: [
          {
            type: "string",
          },
        ],
        multiple: false,
        description:
          "Sets process.env.NODE_ENV to the specified value. (Currently an alias for `--node-env`).",
        helpLevel: "verbose",
      },
      // Adding more plugins
      {
        name: "analyze",
        configs: [
          {
            type: "enum",
            values: [true],
          },
        ],
        multiple: false,
        description:
          "It invokes webpack-bundle-analyzer plugin to get bundle information.",
        helpLevel: "minimum",
      },
      {
        name: "progress",
        configs: [
          {
            type: "string",
          },
          {
            type: "enum",
            values: [true],
          },
        ],
        description: "Print compilation progress during build.",
        helpLevel: "minimum",
      },
      // Output options
      {
        name: "json",
        configs: [
          {
            type: "string",
          },
          {
            type: "enum",
            values: [true],
          },
        ],
        alias: "j",
        valueName: "pathToJsonFile",
        description: "Prints result as JSON or store it in a file.",
        helpLevel: "minimum",
      },
      {
        name: "fail-on-warnings",
        configs: [
          {
            type: "enum",
            values: [true],
          },
        ],
        description:
          "Stop webpack-cli process with non-zero exit code on warnings from webpack.",
        helpLevel: "minimum",
      },
      // TODO remove this in the next major release, because not all webpack versions have this flag in CLI options
      {
        name: "extends",
        alias: "e",
        configs: [
          {
            type: "string",
          },
        ],
        multiple: true,
        description:
          "Path to the configuration to be extended (only works when using webpack-cli).",
        helpLevel: "minimum",
      },
    ];

    // 定义了一些核心选项的名称，如 mode、watch、stats，这些选项在 webpack CLI 的文档中有较高优先级
    const minimumHelpFlags = [
      "mode",
      "watch",
      "watch-options-stdin",
      "stats",
      "devtool",
      "entry",
      "target",
      "name",
      "output-path",
      "extends",
    ];
    // 这个链接保存了 webpack CLI 所生成的 flags 列表https://github.com/webpack/webpack/blob/main/test/__snapshots__/Cli.basictest.js.snap
    const options = builtInFlags.concat(
      // 从 webpack 核心 CLI 获取并合并所有内建选项
      Object.entries(this.webpack.cli.getArguments()).map(([name, meta]) => {
        return Object.assign(Object.assign({}, meta), {
          name,
          group: "core",
          helpLevel: minimumHelpFlags.includes(name) ? "minimum" : "verbose",
        });
      })
    );

    // 将生成的选项列表缓存,以便后续快速访问
    this.builtInOptionsCache = options;
    return options;
  }
  async loadWebpack(handleError = true) {
    return this.tryRequireThenImport(WEBPACK_PACKAGE, handleError);
  }
  async run(args, parseOptions) {
    // Built-in internal commands
    // 下面代码定义了一些命令行工具的内置命令选项
    const buildCommandOptions = {
      name: "build [entries...]",
      alias: ["bundle", "b"],
      description: "Run webpack (default command, can be omitted).",
      usage: "[entries...] [options]",
      dependencies: [WEBPACK_PACKAGE],
    };
    const watchCommandOptions = {
      name: "watch [entries...]",
      alias: "w",
      description: "Run webpack and watch for files changes.",
      usage: "[entries...] [options]",
      dependencies: [WEBPACK_PACKAGE],
    };
    const versionCommandOptions = {
      name: "version",
      alias: "v",
      usage: "[options]",
      description:
        "Output the version number of 'webpack', 'webpack-cli' and 'webpack-dev-server' and commands.",
    };
    const helpCommandOptions = {
      name: "help [command] [option]",
      alias: "h",
      description: "Display help for commands and options.",
    };
    // Built-in external commands
    // 这段代码定义了一些命令行工具的外部内置命令
    const externalBuiltInCommandsInfo = [
      {
        name: "serve [entries...]",
        alias: ["server", "s"],
        pkg: "@webpack-cli/serve",
      },
      {
        name: "info",
        alias: "i",
        pkg: "@webpack-cli/info",
      },
      {
        name: "init",
        alias: ["create", "new", "c", "n"],
        pkg: "@webpack-cli/generators",
      },
      {
        name: "loader",
        alias: "l",
        pkg: "@webpack-cli/generators",
      },
      {
        name: "plugin",
        alias: "p",
        pkg: "@webpack-cli/generators",
      },
      {
        name: "configtest [config-path]",
        alias: "t",
        pkg: "@webpack-cli/configtest",
      },
    ];
    const knownCommands = [
      buildCommandOptions,
      watchCommandOptions,
      versionCommandOptions,
      helpCommandOptions,
      ...externalBuiltInCommandsInfo,
    ];
    const getCommandName = (name) => name.split(" ")[0];
    const isKnownCommand = (name) =>
      knownCommands.find(
        (command) =>
          getCommandName(command.name) === name ||
          (Array.isArray(command.alias)
            ? command.alias.includes(name)
            : command.alias === name)
      );
    const isCommand = (input, commandOptions) => {
      const longName = getCommandName(commandOptions.name);
      if (input === longName) {
        return true;
      }
      if (commandOptions.alias) {
        if (Array.isArray(commandOptions.alias)) {
          return commandOptions.alias.includes(input);
        } else {
          return commandOptions.alias === input;
        }
      }
      return false;
    };
    const findCommandByName = (name) =>
      this.program.commands.find(
        (command) => name === command.name() || command.aliases().includes(name)
      );
    const isOption = (value) => value.startsWith("-");
    const isGlobalOption = (value) =>
      value === "--color" ||
      value === "--no-color" ||
      value === "-v" ||
      value === "--version" ||
      value === "-h" ||
      value === "--help";

    /**
     * 处理了根据用户输入的命令名称加载并执行相应的命令
     * @param {*} commandName 用户输入的命令名称
     * @param {*} allowToInstall  true 允许尝试安装缺失的包
     * @returns
     */
    const loadCommandByName = async (commandName, allowToInstall = false) => {
      const isBuildCommandUsed = isCommand(commandName, buildCommandOptions);
      const isWatchCommandUsed = isCommand(commandName, watchCommandOptions);

      // 检查是否是 build watch
      if (isBuildCommandUsed || isWatchCommandUsed) {
        await this.makeCommand(
          isBuildCommandUsed ? buildCommandOptions : watchCommandOptions,
          async () => {
            this.webpack = await this.loadWebpack();
            return this.getBuiltInOptions();
          },
          async (entries, options) => {
            if (entries.length > 0) {
              options.entry = [...entries, ...(options.entry || [])];
            }
            await this.runWebpack(options, isWatchCommandUsed);
          }
        );
      } else if (isCommand(commandName, helpCommandOptions)) {
        // help 命令
        // Stub for the `help` command
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        this.makeCommand(helpCommandOptions, [], () => {});
      } else if (isCommand(commandName, versionCommandOptions)) {
        // 版本 命令
        // Stub for the `version` command
        this.makeCommand(
          versionCommandOptions,
          this.getInfoOptions(),
          async (options) => {
            const info = await cli.getInfoOutput(options);
            cli.logger.raw(info);
          }
        );
      } else {
        // 命令不是内置命令，查找是否为外部命令（如 @webpack-cli/serve）

        // 尝试在 externalBuiltInCommandsInfo 中查找与 commandName 匹配的命令
        // 这里的匹配逻辑不仅检查命令名称是否相同，还会检查命令的别名（alias）
        const builtInExternalCommandInfo = externalBuiltInCommandsInfo.find(
          (externalBuiltInCommandInfo) =>
            getCommandName(externalBuiltInCommandInfo.name) === commandName ||
            (Array.isArray(externalBuiltInCommandInfo.alias)
              ? externalBuiltInCommandInfo.alias.includes(commandName)
              : externalBuiltInCommandInfo.alias === commandName)
        );

        // 确定要使用的包名
        let pkg;
        // 如果找到了相应的外部命令信息，则从中提取 pkg（包名）
        if (builtInExternalCommandInfo) {
          ({ pkg } = builtInExternalCommandInfo);
        } else {
          // 没有找到匹配的内置外部命令，则假设 commandName 就是包名
          pkg = commandName;
        }

        // 首先，排除 webpack-cli，因为这是 CLI 的核心包，必然存在
        // 检查该包是否已经安装
        if (pkg !== "webpack-cli" && !this.checkPackageExists(pkg)) {
          if (!allowToInstall) {
            return;
          }

          // 安装这个包，安装前会输出一条提示信息，告知用户需要安装该包才能使用此命令。
          pkg = await this.doInstall(pkg, {
            preMessage: () => {
              this.logger.error(
                `For using this command you need to install: '${this.colors.green(
                  pkg
                )}' package.`
              );
            },
          });
        }

        // 尝试加载命令
        let loadedCommand;
        try {
          // 通过 require 或 import 动态加载命令模块
          loadedCommand = await this.tryRequireThenImport(pkg, false);
        } catch (error) {
          // Ignore, command is not installed
          // 如果加载失败，忽略该命令
          return;
        }

        // 实例化并执行命令
        let command;
        try {
          command = new loadedCommand();
          await command.apply(this);
        } catch (error) {
          this.logger.error(`Unable to load '${pkg}' command`);
          this.logger.error(error);
          process.exit(2);
        }
      }
    };
    // Register own exit
    // exitOverride 方法可以覆盖默认的退出处理方式，执行自定义的逻辑
    this.program.exitOverride(async (error) => {
      var _a;
      if (error.exitCode === 0) {
        // 正常退出
        process.exit(0);
      }
      if (error.code === "executeSubCommandAsync") {
        // 子命令执行出现问题
        process.exit(2);
      }
      if (error.code === "commander.help") {
        // 用户请求了帮助信息，正常退出
        process.exit(0);
      }
      if (error.code === "commander.unknownOption") {
        // 处理未知选项错误
        let name = error.message.match(/'(.+)'/);
        if (name) {
          // 提取出选项名称，并去掉前缀的 --
          name = name[1].slice(2);
          if (name.includes("=")) {
            name = name.split("=")[0];
          }

          // 解析命令行参数，从而提取出命令的操作数（operands）
          const { operands } = this.program.parseOptions(this.program.args);
          const operand =
            typeof operands[0] !== "undefined"
              ? operands[0]
              : // 使用默认的 build 命令名称
                getCommandName(buildCommandOptions.name);
          if (operand) {
            // 根据操作数查找命令
            const command = findCommandByName(operand);
            if (!command) {
              this.logger.error(`Can't find and load command '${operand}'`);
              this.logger.error(
                "Run 'webpack --help' to see available commands and options"
              );
              process.exit(2);
            }

            // fastest-levenshtein 库来计算用户输入的选项与命令可用选项之间的 Levenshtein 距离
            // （用于计算两个字符串之间的差异）
            const levenshtein = require("fastest-levenshtein");
            for (const option of command.options) {
              if (
                !option.hidden &&
                // 如果找到类似的选项且拼写错误小于 3（即用户可能拼错了选项），输出提示信息，告诉用户是否要使用正确的选项。
                levenshtein.distance(
                  name,
                  (_a = option.long) === null || _a === void 0
                    ? void 0
                    : _a.slice(2)
                ) < 3
              ) {
                this.logger.error(`Did you mean '--${option.name()}'?`);
              }
            }
          }
        }
      }
      // Codes:
      // - commander.unknownCommand
      // - commander.missingArgument
      // - commander.missingMandatoryOptionValue
      // - commander.optionMissingArgument
      this.logger.error(
        "Run 'webpack --help' to see available commands and options"
      );
      process.exit(2);
    });
    // Default `--color` and `--no-color` options
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const cli = this;
    this.program.option("--color", "Enable colors on console.");
    this.program.on("option:color", function () {
      // @ts-expect-error shadowing 'this' is intended
      const { color } = this.opts();
      cli.isColorSupportChanged = color;
      cli.colors = cli.createColors(color);
    });
    this.program.option("--no-color", "Disable colors on console.");
    this.program.on("option:no-color", function () {
      // @ts-expect-error shadowing 'this' is intended
      const { color } = this.opts();
      cli.isColorSupportChanged = color;
      cli.colors = cli.createColors(color);
    });
    this.program.option(
      "-v, --version",
      "Output the version number of 'webpack', 'webpack-cli' and 'webpack-dev-server' and commands."
    );
    // webpack-cli has it's own logic for showing suggestions
    this.program.showSuggestionAfterError(false);
    const outputHelp = async (
      options,
      isVerbose,
      isHelpCommandSyntax,
      program
    ) => {
      const { bold } = this.colors;
      const outputIncorrectUsageOfHelp = () => {
        this.logger.error("Incorrect use of help");
        this.logger.error(
          "Please use: 'webpack help [command] [option]' | 'webpack [command] --help'"
        );
        this.logger.error(
          "Run 'webpack --help' to see available commands and options"
        );
        process.exit(2);
      };
      const isGlobalHelp = options.length === 0;
      const isCommandHelp = options.length === 1 && !isOption(options[0]);
      if (isGlobalHelp || isCommandHelp) {
        program.configureHelp({
          sortSubcommands: true,
          // Support multiple aliases
          commandUsage: (command) => {
            let parentCmdNames = "";
            for (
              let parentCmd = command.parent;
              parentCmd;
              parentCmd = parentCmd.parent
            ) {
              parentCmdNames = `${parentCmd.name()} ${parentCmdNames}`;
            }
            if (isGlobalHelp) {
              return `${parentCmdNames}${command.usage()}\n${bold(
                "Alternative usage to run commands:"
              )} ${parentCmdNames}[command] [options]`;
            }
            return `${parentCmdNames}${command.name()}|${command
              .aliases()
              .join("|")} ${command.usage()}`;
          },
          // Support multiple aliases
          subcommandTerm: (command) => {
            const humanReadableArgumentName = (argument) => {
              const nameOutput =
                argument.name() + (argument.variadic ? "..." : "");
              return argument.required
                ? "<" + nameOutput + ">"
                : "[" + nameOutput + "]";
            };
            const args = command._args
              .map((arg) => humanReadableArgumentName(arg))
              .join(" ");
            return `${command.name()}|${command.aliases().join("|")}${
              args ? ` ${args}` : ""
            }${command.options.length > 0 ? " [options]" : ""}`;
          },
          visibleOptions: function visibleOptions(command) {
            return command.options.filter((option) => {
              if (option.hidden) {
                return false;
              }
              // Hide `--watch` option when developer use `webpack watch --help`
              if (
                (options[0] === "w" || options[0] === "watch") &&
                (option.name() === "watch" || option.name() === "no-watch")
              ) {
                return false;
              }
              switch (option.helpLevel) {
                case "verbose":
                  return isVerbose;
                case "minimum":
                default:
                  return true;
              }
            });
          },
          padWidth(command, helper) {
            return Math.max(
              helper.longestArgumentTermLength(command, helper),
              helper.longestOptionTermLength(command, helper),
              // For global options
              helper.longestOptionTermLength(program, helper),
              helper.longestSubcommandTermLength(
                isGlobalHelp ? program : command,
                helper
              )
            );
          },
          formatHelp: (command, helper) => {
            const termWidth = helper.padWidth(command, helper);
            const helpWidth =
              helper.helpWidth || process.env.WEBPACK_CLI_HELP_WIDTH || 80;
            const itemIndentWidth = 2;
            const itemSeparatorWidth = 2; // between term and description
            const formatItem = (term, description) => {
              if (description) {
                const fullText = `${term.padEnd(
                  termWidth + itemSeparatorWidth
                )}${description}`;
                return helper.wrap(
                  fullText,
                  helpWidth - itemIndentWidth,
                  termWidth + itemSeparatorWidth
                );
              }
              return term;
            };
            const formatList = (textArray) =>
              textArray.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));
            // Usage
            let output = [
              `${bold("Usage:")} ${helper.commandUsage(command)}`,
              "",
            ];
            // Description
            const commandDescription = isGlobalHelp
              ? "The build tool for modern web applications."
              : helper.commandDescription(command);
            if (commandDescription.length > 0) {
              output = output.concat([commandDescription, ""]);
            }
            // Arguments
            const argumentList = helper
              .visibleArguments(command)
              .map((argument) =>
                formatItem(argument.name(), argument.description)
              );
            if (argumentList.length > 0) {
              output = output.concat([
                bold("Arguments:"),
                formatList(argumentList),
                "",
              ]);
            }
            // Options
            const optionList = helper
              .visibleOptions(command)
              .map((option) =>
                formatItem(
                  helper.optionTerm(option),
                  helper.optionDescription(option)
                )
              );
            if (optionList.length > 0) {
              output = output.concat([
                bold("Options:"),
                formatList(optionList),
                "",
              ]);
            }
            // Global options
            const globalOptionList = program.options.map((option) =>
              formatItem(
                helper.optionTerm(option),
                helper.optionDescription(option)
              )
            );
            if (globalOptionList.length > 0) {
              output = output.concat([
                bold("Global options:"),
                formatList(globalOptionList),
                "",
              ]);
            }
            // Commands
            const commandList = helper
              .visibleCommands(isGlobalHelp ? program : command)
              .map((command) =>
                formatItem(
                  helper.subcommandTerm(command),
                  helper.subcommandDescription(command)
                )
              );
            if (commandList.length > 0) {
              output = output.concat([
                bold("Commands:"),
                formatList(commandList),
                "",
              ]);
            }
            return output.join("\n");
          },
        });
        if (isGlobalHelp) {
          await Promise.all(
            knownCommands.map((knownCommand) => {
              return loadCommandByName(getCommandName(knownCommand.name));
            })
          );
          const buildCommand = findCommandByName(
            getCommandName(buildCommandOptions.name)
          );
          buildCommand && this.logger.raw(buildCommand.helpInformation());
        } else {
          const name = options[0];
          await loadCommandByName(name);
          const command = findCommandByName(name);
          if (!command) {
            const builtInCommandUsed = externalBuiltInCommandsInfo.find(
              (command) => command.name.includes(name) || name === command.alias
            );
            if (typeof builtInCommandUsed !== "undefined") {
              this.logger.error(
                `For using '${name}' command you need to install '${builtInCommandUsed.pkg}' package.`
              );
            } else {
              this.logger.error(`Can't find and load command '${name}'`);
              this.logger.error(
                "Run 'webpack --help' to see available commands and options."
              );
            }
            process.exit(2);
          }
          this.logger.raw(command.helpInformation());
        }
      } else if (isHelpCommandSyntax) {
        let isCommandSpecified = false;
        let commandName = getCommandName(buildCommandOptions.name);
        let optionName = "";
        if (options.length === 1) {
          optionName = options[0];
        } else if (options.length === 2) {
          isCommandSpecified = true;
          commandName = options[0];
          optionName = options[1];
          if (isOption(commandName)) {
            outputIncorrectUsageOfHelp();
          }
        } else {
          outputIncorrectUsageOfHelp();
        }
        await loadCommandByName(commandName);
        const command = isGlobalOption(optionName)
          ? program
          : findCommandByName(commandName);
        if (!command) {
          this.logger.error(`Can't find and load command '${commandName}'`);
          this.logger.error(
            "Run 'webpack --help' to see available commands and options"
          );
          process.exit(2);
        }
        const option = command.options.find(
          (option) => option.short === optionName || option.long === optionName
        );
        if (!option) {
          this.logger.error(`Unknown option '${optionName}'`);
          this.logger.error(
            "Run 'webpack --help' to see available commands and options"
          );
          process.exit(2);
        }
        const nameOutput =
          option.flags.replace(/^.+[[<]/, "").replace(/(\.\.\.)?[\]>].*$/, "") +
          (option.variadic === true ? "..." : "");
        const value = option.required
          ? "<" + nameOutput + ">"
          : option.optional
            ? "[" + nameOutput + "]"
            : "";
        this.logger.raw(
          `${bold("Usage")}: webpack${
            isCommandSpecified ? ` ${commandName}` : ""
          } ${option.long}${value ? ` ${value}` : ""}`
        );
        if (option.short) {
          this.logger.raw(
            `${bold("Short:")} webpack${
              isCommandSpecified ? ` ${commandName}` : ""
            } ${option.short}${value ? ` ${value}` : ""}`
          );
        }
        if (option.description) {
          this.logger.raw(`${bold("Description:")} ${option.description}`);
        }
        if (!option.negate && option.defaultValue) {
          this.logger.raw(
            `${bold("Default value:")} ${JSON.stringify(option.defaultValue)}`
          );
        }
        const flag = this.getBuiltInOptions().find(
          (flag) => option.long === `--${flag.name}`
        );
        if (flag && flag.configs) {
          const possibleValues = flag.configs.reduce(
            (accumulator, currentValue) => {
              if (currentValue.values) {
                return accumulator.concat(currentValue.values);
              } else {
                return accumulator;
              }
            },
            []
          );
          if (possibleValues.length > 0) {
            this.logger.raw(
              `${bold("Possible values:")} ${JSON.stringify(
                possibleValues.join(" | ")
              )}`
            );
          }
        }
        this.logger.raw("");
        // TODO implement this after refactor cli arguments
        // logger.raw('Documentation: https://webpack.js.org/option/name/');
      } else {
        outputIncorrectUsageOfHelp();
      }
      this.logger.raw(
        "To see list of all supported commands and options run 'webpack --help=verbose'.\n"
      );
      this.logger.raw(
        `${bold("Webpack documentation:")} https://webpack.js.org/.`
      );
      this.logger.raw(
        `${bold("CLI documentation:")} https://webpack.js.org/api/cli/.`
      );
      this.logger.raw(`${bold("Made with ♥ by the webpack team")}.`);
      process.exit(0);
    };
    this.program.helpOption(false);
    // 禁用默认选项添加一个 -h, --help 选项，这里使用自定义的
    this.program.addHelpCommand(false);
    this.program.option(
      "-h, --help [verbose]",
      "Display help for commands and options."
    );

    /**检查内部动作是否已经被调用，如果是第一次调用则设置为true */
    let isInternalActionCalled = false;
    // Default action
    // 设置命令行工具的使用说明，即 usage 信息
    this.program.usage("[options]");
    // 允许命令行工具接受未知的选项，而不会报错
    this.program.allowUnknownOption(true);
    // Basic command for lazy loading other commands
    this.program.action(async (options, program) => {
      if (!isInternalActionCalled) {
        // 防止命令行工具在同一个命令中多次执行操作（例如重复调用默认动作）
        isInternalActionCalled = true;
      } else {
        // 显示错误信息并退出程序
        this.logger.error("No commands found to run");
        process.exit(2);
      }
      // 解析传入的命令行参数
      const { operands, unknown } = this.program.parseOptions(program.args);
      /**获取默认要执行的命令名称，默认命令为 build */
      const defaultCommandToRun = getCommandName(buildCommandOptions.name);
      const hasOperand = typeof operands[0] !== "undefined";
      const operand = hasOperand ? operands[0] : defaultCommandToRun;
      /**检查用户是否请求帮助 */
      const isHelpOption = typeof options.help !== "undefined";
      const isHelpCommandSyntax = isCommand(operand, helpCommandOptions);
      if (isHelpOption || isHelpCommandSyntax) {
        let isVerbose = false;
        if (isHelpOption) {
          if (typeof options.help === "string") {
            if (options.help !== "verbose") {
              this.logger.error(
                "Unknown value for '--help' option, please use '--help=verbose'"
              );
              process.exit(2);
            }
            isVerbose = true;
          }
        }
        this.program.forHelp = true;
        const optionsForHelp = []
          .concat(isHelpOption && hasOperand ? [operand] : [])
          // Syntax `webpack help [command]`
          .concat(operands.slice(1))
          // Syntax `webpack help [option]`
          .concat(unknown)
          .concat(
            isHelpCommandSyntax && typeof options.color !== "undefined"
              ? [options.color ? "--color" : "--no-color"]
              : []
          )
          .concat(
            isHelpCommandSyntax && typeof options.version !== "undefined"
              ? ["--version"]
              : []
          );
        await outputHelp(
          optionsForHelp,
          isVerbose,
          isHelpCommandSyntax,
          program
        );
      }

      // 检查用户是否请求版本信息
      const isVersionOption = typeof options.version !== "undefined";
      if (isVersionOption) {
        const info = await this.getInfoOutput({
          output: "",
          additionalPackage: [],
        });
        this.logger.raw(info);
        process.exit(0);
      }

      // 初始化要执行的命令，默认情况下为用户输入的操作数
      // 这段代码是webpack cli 处理用户输入命令的核心逻辑
      let commandToRun = operand;
      // 除去命令的参数部分
      let commandOperands = operands.slice(1);

      // 检查 commandToRun 是否是已知命令
      if (isKnownCommand(commandToRun)) {
        // 加载并执行这个命令
        await loadCommandByName(commandToRun, true);
      } else {
        //  检查 operand 是否是一个有效的文件路径
        const isEntrySyntax = fs.existsSync(operand);
        if (isEntrySyntax) {
          // 如果是文件路径，则使用默认命令处理
          commandToRun = defaultCommandToRun;
          commandOperands = operands;
          await loadCommandByName(commandToRun);
        } else {
          // 输出未知命令的错误信息，并使用 fastest-levenshtein 来进行模糊匹配，给出可能的拼写建议
          this.logger.error(`Unknown command or entry '${operand}'`);
          const levenshtein = require("fastest-levenshtein");
          const found = knownCommands.find(
            (commandOptions) =>
              levenshtein.distance(
                operand,
                getCommandName(commandOptions.name)
              ) < 3
          );
          if (found) {
            this.logger.error(
              `Did you mean '${getCommandName(found.name)}' (alias '${
                Array.isArray(found.alias)
                  ? found.alias.join(", ")
                  : found.alias
              }')?`
            );
          }
          this.logger.error(
            "Run 'webpack --help' to see available commands and options"
          );
          process.exit(2);
        }
      }

      // parseAsync 方法会解析整个参数数组，确定要执行的命令并解析相关的选项
      // 解析完成后，commander 库会自动执行与命令对应的函数
      await this.program.parseAsync(
        [commandToRun, ...commandOperands, ...unknown],
        {
          from: "user",
        }
      );
    });
    await this.program.parseAsync(args, parseOptions);
  }

  /**
   * 方法负责加载 Webpack 配置文件并处理配置的合并、解析、继承等操作
   * 此方法旨在灵活支持多种配置格式（如 .js、.ts 等）、递归合并多个配置文件，并处理配置文件中的 extends 字段
   * @param {*} options
   * @returns
   */
  async loadConfig(options) {
    const disableInterpret =
      typeof options.disableInterpret !== "undefined" &&
      options.disableInterpret;
    const interpret = require("interpret");
    const loadConfigByPath = async (configPath, argv = {}) => {
      const ext = path.extname(configPath).toLowerCase();
      let interpreted = Object.keys(interpret.jsVariants).find(
        (variant) => variant === ext
      );
      // Fallback `.cts` to `.ts`
      // TODO implement good `.mts` support after https://github.com/gulpjs/rechoir/issues/43
      // For ESM and `.mts` you need to use: 'NODE_OPTIONS="--loader ts-node/esm" webpack-cli --config ./webpack.config.mts'
      if (!interpreted && /\.cts$/.test(ext)) {
        interpreted = interpret.jsVariants[".ts"];
      }
      if (interpreted && !disableInterpret) {
        const rechoir = require("rechoir");
        try {
          rechoir.prepare(interpret.extensions, configPath);
        } catch (error) {
          if (error === null || error === void 0 ? void 0 : error.failures) {
            this.logger.error(`Unable load '${configPath}'`);
            this.logger.error(error.message);
            for (const failure of error.failures) {
              this.logger.error(failure.error.message);
            }
            this.logger.error("Please install one of them");
            process.exit(2);
          }
          this.logger.error(error);
          process.exit(2);
        }
      }
      let options;
      let moduleType = "unknown";
      switch (ext) {
        case ".cjs":
        case ".cts":
          moduleType = "commonjs";
          break;
        case ".mjs":
        case ".mts":
          moduleType = "esm";
          break;
      }
      try {
        options = await this.tryRequireThenImport(
          configPath,
          false,
          moduleType
        );
        // @ts-expect-error error type assertion
      } catch (error) {
        this.logger.error(`Failed to load '${configPath}' config`);
        if (this.isValidationError(error)) {
          this.logger.error(error.message);
        } else {
          this.logger.error(error);
        }
        process.exit(2);
      }
      if (!options) {
        this.logger.error(
          `Failed to load '${configPath}' config. Unable to find default export.`
        );
        process.exit(2);
      }
      if (Array.isArray(options)) {
        // reassign the value to assert type
        const optionsArray = options;
        await Promise.all(
          optionsArray.map(async (_, i) => {
            if (this.isPromise(optionsArray[i])) {
              optionsArray[i] = await optionsArray[i];
            }
            // `Promise` may return `Function`
            if (this.isFunction(optionsArray[i])) {
              // when config is a function, pass the env from args to the config function
              optionsArray[i] = await optionsArray[i](argv.env, argv);
            }
          })
        );
        options = optionsArray;
      } else {
        if (this.isPromise(options)) {
          options = await options;
        }
        // `Promise` may return `Function`
        if (this.isFunction(options)) {
          // when config is a function, pass the env from args to the config function
          options = await options(argv.env, argv);
        }
      }
      const isObject = (value) => typeof value === "object" && value !== null;
      if (!isObject(options) && !Array.isArray(options)) {
        this.logger.error(`Invalid configuration in '${configPath}'`);
        process.exit(2);
      }
      return { options, path: configPath };
    };
    const config = {
      options: {},
      path: new WeakMap(),
    };
    if (options.config && options.config.length > 0) {
      const loadedConfigs = await Promise.all(
        options.config.map((configPath) =>
          loadConfigByPath(path.resolve(configPath), options.argv)
        )
      );
      config.options = [];
      loadedConfigs.forEach((loadedConfig) => {
        const isArray = Array.isArray(loadedConfig.options);
        // TODO we should run webpack multiple times when the `--config` options have multiple values with `--merge`, need to solve for the next major release
        if (config.options.length === 0) {
          config.options = loadedConfig.options;
        } else {
          if (!Array.isArray(config.options)) {
            config.options = [config.options];
          }
          if (isArray) {
            for (const item of loadedConfig.options) {
              config.options.push(item);
            }
          } else {
            config.options.push(loadedConfig.options);
          }
        }
        if (isArray) {
          for (const options of loadedConfig.options) {
            config.path.set(options, [loadedConfig.path]);
          }
        } else {
          config.path.set(loadedConfig.options, [loadedConfig.path]);
        }
      });
      config.options =
        config.options.length === 1 ? config.options[0] : config.options;
    } else {
      // TODO ".mts" is not supported by `interpret`, need to add it
      // Prioritize popular extensions first to avoid unnecessary fs calls
      const extensions = [
        ".js",
        ".mjs",
        ".cjs",
        ".ts",
        ".cts",
        ".mts",
        ...Object.keys(interpret.extensions),
      ];
      // Order defines the priority, in decreasing order
      const defaultConfigFiles = new Set(
        [
          "webpack.config",
          ".webpack/webpack.config",
          ".webpack/webpackfile",
        ].flatMap((filename) =>
          extensions.map((ext) => path.resolve(filename + ext))
        )
      );
      let foundDefaultConfigFile;
      for (const defaultConfigFile of defaultConfigFiles) {
        if (!fs.existsSync(defaultConfigFile)) {
          continue;
        }
        foundDefaultConfigFile = defaultConfigFile;
        break;
      }
      if (foundDefaultConfigFile) {
        const loadedConfig = await loadConfigByPath(
          foundDefaultConfigFile,
          options.argv
        );
        config.options = loadedConfig.options;
        if (Array.isArray(config.options)) {
          for (const item of config.options) {
            config.path.set(item, [loadedConfig.path]);
          }
        } else {
          config.path.set(loadedConfig.options, [loadedConfig.path]);
        }
      }
    }
    if (options.configName) {
      const notFoundConfigNames = [];
      config.options = options.configName.map((configName) => {
        let found;
        if (Array.isArray(config.options)) {
          found = config.options.find((options) => options.name === configName);
        } else {
          found =
            config.options.name === configName ? config.options : undefined;
        }
        if (!found) {
          notFoundConfigNames.push(configName);
        }
        return found;
      });
      if (notFoundConfigNames.length > 0) {
        this.logger.error(
          notFoundConfigNames
            .map(
              (configName) =>
                `Configuration with the name "${configName}" was not found.`
            )
            .join(" ")
        );
        process.exit(2);
      }
    }
    const resolveExtends = async (config, configPaths, extendsPaths) => {
      delete config.extends;
      const loadedConfigs = await Promise.all(
        extendsPaths.map((extendsPath) =>
          loadConfigByPath(path.resolve(extendsPath), options.argv)
        )
      );
      const merge = await this.tryRequireThenImport("webpack-merge");
      const loadedOptions = loadedConfigs.flatMap((config) => config.options);
      if (loadedOptions.length > 0) {
        const prevPaths = configPaths.get(config);
        const loadedPaths = loadedConfigs.flatMap((config) => config.path);
        if (prevPaths) {
          const intersection = loadedPaths.filter((element) =>
            prevPaths.includes(element)
          );
          if (intersection.length > 0) {
            this.logger.error(`Recursive configuration detected, exiting.`);
            process.exit(2);
          }
        }
        config = merge(...loadedOptions, config);
        if (prevPaths) {
          configPaths.set(config, [...prevPaths, ...loadedPaths]);
        }
      }
      if (config.extends) {
        const extendsPaths =
          typeof config.extends === "string"
            ? [config.extends]
            : config.extends;
        config = await resolveExtends(config, configPaths, extendsPaths);
      }
      return config;
    };
    // The `extends` param in CLI gets priority over extends in config file
    if (options.extends && options.extends.length > 0) {
      const extendsPaths = options.extends;
      if (Array.isArray(config.options)) {
        config.options = await Promise.all(
          config.options.map((options) =>
            resolveExtends(options, config.path, extendsPaths)
          )
        );
      } else {
        // load the config from the extends option
        config.options = await resolveExtends(
          config.options,
          config.path,
          extendsPaths
        );
      }
    }
    // if no extends option is passed, check if the config file has extends
    else if (
      Array.isArray(config.options) &&
      config.options.some((options) => options.extends)
    ) {
      config.options = await Promise.all(
        config.options.map((options) => {
          if (options.extends) {
            return resolveExtends(
              options,
              config.path,
              typeof options.extends === "string"
                ? [options.extends]
                : options.extends
            );
          } else {
            return options;
          }
        })
      );
    } else if (!Array.isArray(config.options) && config.options.extends) {
      config.options = await resolveExtends(
        config.options,
        config.path,
        typeof config.options.extends === "string"
          ? [config.options.extends]
          : config.options.extends
      );
    }
    if (options.merge) {
      const merge = await this.tryRequireThenImport("webpack-merge");
      // we can only merge when there are multiple configurations
      // either by passing multiple configs by flags or passing a
      // single config exporting an array
      if (!Array.isArray(config.options) || config.options.length <= 1) {
        this.logger.error(
          "At least two configurations are required for merge."
        );
        process.exit(2);
      }
      const mergedConfigPaths = [];
      config.options = config.options.reduce((accumulator, options) => {
        const configPath = config.path.get(options);
        const mergedOptions = merge(accumulator, options);
        if (configPath) {
          mergedConfigPaths.push(...configPath);
        }
        return mergedOptions;
      }, {});
      config.path.set(config.options, mergedConfigPaths);
    }
    return config;
  }
  async buildConfig(config, options) {
    if (options.analyze) {
      if (!this.checkPackageExists("webpack-bundle-analyzer")) {
        await this.doInstall("webpack-bundle-analyzer", {
          preMessage: () => {
            this.logger.error(
              `It looks like ${this.colors.yellow(
                "webpack-bundle-analyzer"
              )} is not installed.`
            );
          },
        });
        this.logger.success(
          `${this.colors.yellow(
            "webpack-bundle-analyzer"
          )} was installed successfully.`
        );
      }
    }
    if (
      typeof options.progress === "string" &&
      options.progress !== "profile"
    ) {
      this.logger.error(
        `'${options.progress}' is an invalid value for the --progress option. Only 'profile' is allowed.`
      );
      process.exit(2);
    }
    const CLIPlugin = await this.tryRequireThenImport("./plugins/cli-plugin");
    const internalBuildConfig = (item) => {
      const originalWatchValue = item.watch;
      // Apply options
      const args = this.getBuiltInOptions().reduce((accumulator, flag) => {
        if (flag.group === "core") {
          accumulator[flag.name] = flag;
        }
        return accumulator;
      }, {});
      const values = Object.keys(options).reduce((accumulator, name) => {
        if (name === "argv") {
          return accumulator;
        }
        const kebabName = this.toKebabCase(name);
        if (args[kebabName]) {
          accumulator[kebabName] = options[name];
        }
        return accumulator;
      }, {});
      if (Object.keys(values).length > 0) {
        const problems = this.webpack.cli.processArguments(args, item, values);
        if (problems) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const groupBy = (xs, key) => {
            return xs.reduce((rv, x) => {
              (rv[x[key]] = rv[x[key]] || []).push(x);
              return rv;
            }, {});
          };
          const problemsByPath = groupBy(problems, "path");
          for (const path in problemsByPath) {
            const problems = problemsByPath[path];
            for (const problem of problems) {
              this.logger.error(
                `${this.capitalizeFirstLetter(
                  problem.type.replace(/-/g, " ")
                )}${problem.value ? ` '${problem.value}'` : ""} for the '--${
                  problem.argument
                }' option${problem.index ? ` by index '${problem.index}'` : ""}`
              );
              if (problem.expected) {
                this.logger.error(`Expected: '${problem.expected}'`);
              }
            }
          }
          process.exit(2);
        }
      }
      // Output warnings
      if (
        options.isWatchingLikeCommand &&
        options.argv &&
        options.argv.env &&
        (typeof originalWatchValue !== "undefined" ||
          typeof options.argv.watch !== "undefined")
      ) {
        this.logger.warn(
          `No need to use the '${
            options.argv.env["WEBPACK_WATCH"] ? "watch" : "serve"
          }' command together with '{ watch: true | false }' or '--watch'/'--no-watch' configuration, it does not make sense.`
        );
        if (options.argv.env["WEBPACK_SERVE"]) {
          item.watch = false;
        }
      }
      const isFileSystemCacheOptions = (config) => {
        return Boolean(config.cache) && config.cache.type === "filesystem";
      };
      // Setup default cache options
      if (isFileSystemCacheOptions(item)) {
        const configPath = config.path.get(item);
        if (configPath) {
          if (!item.cache.buildDependencies) {
            item.cache.buildDependencies = {};
          }
          if (!item.cache.buildDependencies.defaultConfig) {
            item.cache.buildDependencies.defaultConfig = [];
          }
          if (Array.isArray(configPath)) {
            for (const oneOfConfigPath of configPath) {
              item.cache.buildDependencies.defaultConfig.push(oneOfConfigPath);
            }
          } else {
            item.cache.buildDependencies.defaultConfig.push(configPath);
          }
        }
      }
      // Respect `process.env.NODE_ENV`
      if (
        !item.mode &&
        process.env &&
        process.env.NODE_ENV &&
        (process.env.NODE_ENV === "development" ||
          process.env.NODE_ENV === "production" ||
          process.env.NODE_ENV === "none")
      ) {
        item.mode = process.env.NODE_ENV;
      }
      // Setup stats
      if (typeof item.stats === "undefined") {
        item.stats = { preset: "normal" };
      } else if (typeof item.stats === "boolean") {
        item.stats = item.stats ? { preset: "normal" } : { preset: "none" };
      } else if (typeof item.stats === "string") {
        item.stats = { preset: item.stats };
      }
      let colors;
      // From arguments
      if (typeof this.isColorSupportChanged !== "undefined") {
        colors = Boolean(this.isColorSupportChanged);
      }
      // From stats
      else if (typeof item.stats.colors !== "undefined") {
        colors = item.stats.colors;
      }
      // Default
      else {
        colors = Boolean(this.colors.isColorSupported);
      }
      item.stats.colors = colors;
      // Apply CLI plugin
      if (!item.plugins) {
        item.plugins = [];
      }
      item.plugins.unshift(
        new CLIPlugin({
          configPath: config.path.get(item),
          helpfulOutput: !options.json,
          progress: options.progress,
          analyze: options.analyze,
          isMultiCompiler: Array.isArray(config.options),
        })
      );
    };
    if (Array.isArray(config.options)) {
      for (const item of config.options) {
        internalBuildConfig(item);
      }
    } else {
      internalBuildConfig(config.options);
    }
    return config;
  }

  /**
   * 检查传入的 error 是否是 Webpack 配置或选项的验证错误
   * 此类错误通常源于配置选项不符合 Webpack 的期望，例如提供了无效的配置值
   */
  isValidationError(error) {
    return (
      error instanceof this.webpack.ValidationError ||
      error.name === "ValidationError"
    );
  }
  /**
   * 用于创建并配置 Webpack 编译器实例
   * 它通过 options 来加载和生成配置，创建编译器实例，并处理可能发生的错误
   *
   * @param {*} options
   * @param {*} callback
   * @returns
   */
  async createCompiler(options, callback) {
    // 这里在配置环境变量
    if (typeof options.defineProcessEnvNodeEnv === "string") {
      // TODO 注释：标记一个未来的改进。当前 NODE_ENV 被设置在整个配置生命周期中，
      // 而注释建议仅在运行时设置它，以避免影响 Webpack 配置中的环境判断。
      process.env.NODE_ENV = options.defineProcessEnvNodeEnv;
    } else if (typeof options.nodeEnv === "string") {
      process.env.NODE_ENV = options.nodeEnv;
    }

    // 加载基础 Webpack 配置
    let config = await this.loadConfig(options);

    // 构建最终的 Webpack 配置
    config = await this.buildConfig(config, options);
    let compiler;
    try {
      // 创建webpack 编译器
      // 这个this.webpack 会在 this.loadWebpack 被调用的加载
      // 如果是build watch 会在当前webpack-cli 中调用 loadWebpack
      // 如果是serve 则会在加载 @webpack-cli/serve这个包中 调用 apply 方法中调用 loadWebpack
      compiler = this.webpack(
        config.options,

        // 当传入 callback 函数时，通过包装函数来处理编译器的回调
        callback
          ? (error, stats) => {
              // 如果编译过程中遇到错误，且是验证错误
              // 记录错误消息，并通过 process.exit(2) 退出进程
              if (error && this.isValidationError(error)) {
                this.logger.error(error.message);
                process.exit(2);
              }

              // 否则直接调用 callback 并传递 error 和 stats，将错误或结果传给外部代码
              callback(error, stats);
            }
          : callback
      );
      // @ts-expect-error error type assertion
    } catch (error) {
      // 捕获创建编译器时的所有错误

      // 如果错误是由参数或配置无效引发，则记录错误信息
      if (this.isValidationError(error)) {
        this.logger.error(error.message);
      } else {
        // 如果错误是其他类型，则直接记录整个错误对象
        this.logger.error(error);
      }

      // 退出进程
      process.exit(2);
    }
    return compiler;
  }

  /**
   * 判断当前 Webpack 编译器（compiler）是否需要监视标准输入（stdin）
   * 以支持热更新或开发中的自动重启等功能
   */
  needWatchStdin(compiler) {
    // 检查是否为多编译器模式
    if (this.isMultipleCompiler(compiler)) {
      // 这种模式下 compiler.compilers 是一个编译器数组
      return Boolean(
        // 遍历其 compilers 数组，逐个检查每个编译器的 watchOptions 设置
        // 只要有一个编译器实例的 watchOptions.stdin 为 true，
        // 整个 needWatchStdin 方法就会返回 true，表示需要监视 stdin
        compiler.compilers.some(
          (compiler) =>
            compiler.options.watchOptions && compiler.options.watchOptions.stdin
        )
      );
    }

    // 单编译器情况
    // 直接检查 compiler.options.watchOptions.stdin
    return Boolean(
      compiler.options.watchOptions && compiler.options.watchOptions.stdin
    );
  }
  async runWebpack(options, isWatchCommand) {
    // eslint-disable-next-line prefer-const
    let compiler;
    let createJsonStringifyStream;
    if (options.json) {
      const jsonExt = await this.tryRequireThenImport("@discoveryjs/json-ext");
      createJsonStringifyStream = jsonExt.stringifyStream;
    }
    const callback = (error, stats) => {
      if (error) {
        this.logger.error(error);
        process.exit(2);
      }
      if (
        stats &&
        (stats.hasErrors() || (options.failOnWarnings && stats.hasWarnings()))
      ) {
        process.exitCode = 1;
      }
      if (!compiler || !stats) {
        return;
      }
      const statsOptions = this.isMultipleCompiler(compiler)
        ? {
            children: compiler.compilers.map((compiler) =>
              compiler.options ? compiler.options.stats : undefined
            ),
          }
        : compiler.options
          ? compiler.options.stats
          : undefined;
      if (options.json && createJsonStringifyStream) {
        const handleWriteError = (error) => {
          this.logger.error(error);
          process.exit(2);
        };
        if (options.json === true) {
          createJsonStringifyStream(stats.toJson(statsOptions))
            .on("error", handleWriteError)
            .pipe(process.stdout)
            .on("error", handleWriteError)
            .on("close", () => process.stdout.write("\n"));
        } else {
          createJsonStringifyStream(stats.toJson(statsOptions))
            .on("error", handleWriteError)
            .pipe(fs.createWriteStream(options.json))
            .on("error", handleWriteError)
            // Use stderr to logging
            .on("close", () => {
              process.stderr.write(
                `[webpack-cli] ${this.colors.green(
                  `stats are successfully stored as json to ${options.json}`
                )}\n`
              );
            });
        }
      } else {
        const printedStats = stats.toString(statsOptions);
        // Avoid extra empty line when `stats: 'none'`
        if (printedStats) {
          this.logger.raw(printedStats);
        }
      }
    };
    const env =
      isWatchCommand || options.watch
        ? Object.assign({ WEBPACK_WATCH: true }, options.env)
        : Object.assign(
            { WEBPACK_BUNDLE: true, WEBPACK_BUILD: true },
            options.env
          );
    options.argv = Object.assign(Object.assign({}, options), { env });
    if (isWatchCommand) {
      options.watch = true;
      options.isWatchingLikeCommand = true;
    }
    compiler = await this.createCompiler(options, callback);
    if (!compiler) {
      return;
    }
    const isWatch = (compiler) =>
      Boolean(
        this.isMultipleCompiler(compiler)
          ? compiler.compilers.some((compiler) => compiler.options.watch)
          : compiler.options.watch
      );
    if (isWatch(compiler) && this.needWatchStdin(compiler)) {
      process.stdin.on("end", () => {
        process.exit(0);
      });
      process.stdin.resume();
    }
  }
}
module.exports = WebpackCLI;
