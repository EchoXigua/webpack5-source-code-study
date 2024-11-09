/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

/**
 * 这个类主要用于从 Webpack 的 Compilation 实例中提取、格式化和输出统计信息。
 * 它包含生成的文件、编译时间、是否存在错误或警告等内容，并将这些信息按指定格式输出
 */
class Stats {
  /**
   * @param {Compilation} compilation webpack compilation
   */
  constructor(compilation) {
    this.compilation = compilation;
  }

  get hash() {
    return this.compilation.hash;
  }

  get startTime() {
    return this.compilation.startTime;
  }

  get endTime() {
    return this.compilation.endTime;
  }

  /**
   * 用于检查编译过程中是否存在警告
   * @returns {boolean} true if the compilation had a warning
   */
  hasWarnings() {
    return (
      this.compilation.getWarnings().length > 0 ||
      //   如果当前 compilation 没有警告，则检查其子 compilation（例如，分包、子项目）中是否包含警告
      this.compilation.children.some((child) => child.getStats().hasWarnings())
    );
  }

  /**
   * 用于检查编译过程中是否存在错误
   * @returns {boolean} true if the compilation encountered an error
   */
  hasErrors() {
    return (
      this.compilation.errors.length > 0 ||
      this.compilation.children.some((child) => child.getStats().hasErrors())
    );
  }

  /**
   * 将 Stats 转换为 JSON 格式
   * @param {(string | boolean | StatsOptions)=} options stats options
   * @returns {StatsCompilation} json output
   */
  toJson(options) {
    const normalizedOptions = this.compilation.createStatsOptions(options, {
      forToString: false,
    });

    const statsFactory = this.compilation.createStatsFactory(normalizedOptions);

    return statsFactory.create("compilation", this.compilation, {
      compilation: this.compilation,
    });
  }

  /**
   * 将 Stats 转换为字符串格式，通常用于控制台输出
   * @param {(string | boolean | StatsOptions)=} options stats options
   * @returns {string} string output
   */
  toString(options) {
    const normalizedOptions = this.compilation.createStatsOptions(options, {
      forToString: true,
    });

    const statsFactory = this.compilation.createStatsFactory(normalizedOptions);
    const statsPrinter = this.compilation.createStatsPrinter(normalizedOptions);

    const data = statsFactory.create("compilation", this.compilation, {
      compilation: this.compilation,
    });
    const result = statsPrinter.print("compilation", data);
    return result === undefined ? "" : result;
  }
}

module.exports = Stats;
