class HotModuleReplacementPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    console.log("应用 热更新替换插件");
  }
}

module.exports = HotModuleReplacementPlugin;
