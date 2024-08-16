"use strict";

// 这行代码用于确保模块被标记为 ES6 模块。
Object.defineProperty(exports, "__esModule", { value: true });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebpackCLI = require("./webpack-cli");
const runCLI = async (args) => {
  // Create a new instance of the CLI object
  const cli = new WebpackCLI();
  try {
    // run 方法是 WebpackCLI 类中的一个核心方法，用于处理命令并执行 Webpack 构建
    await cli.run(args);
  } catch (error) {
    cli.logger.error(error);
    // 2 是一个常见的退出码，表示发生了错误
    process.exit(2);
  }
};
module.exports = runCLI;
