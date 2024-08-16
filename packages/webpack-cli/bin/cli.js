#!/usr/bin/env node

"use strict";

const importLocal = require("import-local");
const runCLI = require("../lib/bootstrap");

// 这段代码的作用是在 Node.js 环境中运行 Webpack CLI
// 它的主要任务是优先使用本地安装的 webpack-cli,否则会执行 bootstrap 模块中的 runCLI 函数
if (!process.env.WEBPACK_CLI_SKIP_IMPORT_LOCAL) {
  // Prefer the local installation of `webpack-cli`
  // import-local 模块，它用于检查是否有本地安装的版本
  if (importLocal(__filename)) {
    // 本地导入webpack-cli 使用 本地的webpack-cli 启动
    return;
  }
}

process.title = "webpack";

runCLI(process.argv);
