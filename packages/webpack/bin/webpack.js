#!/usr/bin/env node

/**
 *  用来检测一个指定的 npm 包是否已经安装在当前环境中
 * @param {*} packageName
 * @returns {boolean}
 */
function isInstalled(packageName) {
  //  如果环境是使用 Yarn PnP，函数立即返回 true，不进行进一步检查
  //  因为 PnP 不使用 node_modules 来管理依赖
  if (process.versions.pnp) {
    return true;
  }

  const path = require("path");
  const fs = require("graceful-fs");

  /**获取当前文件所在的目录路径 */
  let dir = __dirname;
  console.log("dir", dir);

  // 从当前目录一直往上递归，直到文件系统的根目录
  do {
    try {
      if (
        // 在每一层目录中，函数都会检查 node_modules 目录下是否存在指定的 packageName 文件夹
        // 如果存在并且是一个目录，则返回 true，表示该包已安装
        fs.statSync(path.join(dir, "node_modules", packageName)).isDirectory()
      ) {
        return true;
      }
    } catch (error) {}
  } while (dir !== (dir = path.dirname(dir)));

  // 如果上述步骤未找到包，函数还会检查 require("module").globalPaths 中的全局路径
  // 这里就是在检查全局安装的包里面是否存在需要查找的包
  for (const internalPath of require("module").globalPaths) {
    try {
      if (fs.statSync(path.join(internalPath, packageName)).isDirectory()) {
        return true;
      }
    } catch (_error) {
      // Nothing
    }
  }
  // 所有步骤都未能找到该包，则最终返回 false，表示该包未安装
  return false;
}

/**
 * 用于在 Node.js 中执行一个命令行命令，并且返回一个 Promise，以便异步处理
 * @param {*} command
 * @param {*} args
 * @returns
 */
const runCommand = (command, args) => {
  // Node.js 的内置模块，用于创建子进程
  const cp = require("child_process");
  return new Promise((resolve, reject) => {
    // spawn 方法用于创建一个新进程来执行指定的命令
    const executedCommand = cp.spawn(command, args, {
      // inherit 表示子进程将继承当前进程的标准输入/输出/错误流
      // 这意味着子进程的输出会直接显示在当前进程的控制台上。
      stdio: "inherit",
      // 在 shell 中运行命令，这样可以使用 shell 特性，如命令别名、环境变量
      shell: true,
    });

    executedCommand.on("error", (error) => {
      reject(error);
    });

    // 监听 exit 事件。当子进程完成执行并退出时，触发这个事件
    executedCommand.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject();
      }
    });
  });
};

/**
 * 这个函数用于运行 CLI，它根据给定的 cli 对象来决定如何加载并执行对应的 CLI 工具
 * @param {*} cli
 */
const runCli = (cli) => {
  const path = require("path");
  // 用于找到模块文件的绝对路径
  //  @example: /path/project/node_modules/webpack-cli/package.json
  const pkgPath = require.resolve(`${cli.package}/package.json`);
  const pkg = require(pkgPath);

  // 根据模块类型的不同，使用不同的方式加载并执行 CLI 工具：
  if (pkg.type === "module" || /\.mjs/i.test(pkg.bin[cli.binName])) {
    // esm
    // 构造出 CLI 工具的主文件的绝对路径，并将其传递给 import() 进行加载。
    // 这里将 包的目录与bin 进行拼接，得到执行文件的绝对路径
    /**
     * @example
     *  path/project/node_modules/webpack-cli  ./bin/cli.js 最终拼接拼接
     */
    import(path.resolve(path.dirname(pkgPath), pkg.bin[cli.binName])).catch(
      (err) => {
        console.error(err);
        process.exitCode = 1;
      }
    );
  } else {
    // cjs
    require(path.resolve(path.dirname(pkgPath), pkg.bin[cli.binName]));
  }

  // 注意：当你 require 或 import 一个模块时，模块会自动执行其顶级代码
  // 所以这里就相当于运行了这个文件
};

const cli = {
  name: "webpack-cli",
  package: "webpack-cli",
  binName: "webpack-cli",
  installed: isInstalled("webpack-cli"),
  url: "https://github.com/webpack/webpack-cli",
};

if (!cli.installed) {
  const path = require("path");
  // 使用 graceful-fs 替代 fs，以提供更好的错误处理和兼容性
  const fs = require("graceful-fs");
  /**用于创建命令行界面的输入输出 */
  const readLine = require("readline");

  const notify = `CLI for webpack must be installed.\n  ${cli.name} (${cli.url})\n`;
  console.error(notify);

  let packageManager;

  // 根据当前工作目录中是否存在 yarn.lock 或 pnpm-lock.yaml 文件来检测使用的包管理器（yarn、pnpm 或 npm）
  if (fs.existsSync(path.resolve(process.cwd(), "yarn.lock"))) {
    packageManager = "yarn";
  } else if (fs.existsSync(path.resolve(process.cwd(), "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else {
    packageManager = "npm";
  }

  const installOptions = [packageManager === "yarn" ? "add" : "install", "-D"];

  console.error(
    `We will use "${packageManager}" to install the CLI via "${packageManager} ${installOptions.join(
      " "
    )} ${cli.package}".`
  );

  const question = "Do you want to install 'webpack-cli' (yes/no): ";

  // 创建一个命令行接口，等待用户输入是否需要安装 webpack-cli。
  const questionInterface = readLine.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  // 预先设置 process.exitCode = 1; 作为默认退出码
  // 如果用户选择安装 webpack-cli 并成功安装，退出码会被重置为 0，表示成功
  process.exitCode = 1;

  questionInterface.question(question, (answer) => {
    // 在用户输入答案后，关闭命令行接口，停止接受更多输入
    questionInterface.close();

    // 输入的内容转换为小写
    const normalizedAnswer = answer.toLowerCase().startsWith("y");

    if (!normalizedAnswer) {
      // 提示用户需要手动安装 webpack-cli，然后直接返回，退出安装过程
      console.error(
        "You need to install 'webpack-cli' to use webpack via CLI.\n" +
          "You can also install the CLI manually."
      );
      return;
    }

    // 用户同意安装 webpack-cli，将退出码设置为 0，表示安装过程将正常进行
    process.exitCode = 0;

    console.log(
      `Installing '${
        cli.package
      }' (running '${packageManager} ${installOptions.join(" ")} ${
        cli.package
      }')...`
    );

    runCommand(
      /** @type {string} */ (packageManager),
      installOptions.concat(cli.package)
    )
      .then(() => {
        runCli(cli);
      })
      .catch((err) => {
        // 安装过程中发生错误，将退出码设置为 1，表示操作失败
        console.error(err);
        process.exitCode = 1;
      });
  });
} else {
  runCli(cli);
}
