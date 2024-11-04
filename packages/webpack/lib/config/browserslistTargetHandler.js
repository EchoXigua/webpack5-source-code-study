/**
 * browserslist 是一个库，主要用来根据浏览器版本设置来配置前端代码的编译目标（例如选择支持的浏览器）
 */
const browserslist = require("browserslist");
const path = require("path");

/**
 * 用于解析传入的 input 参数，格式可以是 [路径]:[环境]
 * - 匹配文件路径（如 C:/path/to/config 或 /path/to/config）
 * - 匹配环境标识（如 :production）
 *
 * @example
 * [[C:]/path/to/config][:env]
 */
const inputRx = /^(?:((?:[A-Z]:)?[/\\].*?))?(?::(.+?))?$/i;

/**
 * 解析 input 参数并返回其内容
 */
const parse = (input, context) => {
  if (!input) {
    return {};
  }

  // input 为绝对路径
  if (path.isAbsolute(input)) {
    const [, configPath, env] = inputRx.exec(input) || [];
    return { configPath, env };
  }

  const config = browserslist.findConfig(context);

  // input 是一个环境（如 production）且在 browserslist 配置文件中存在对应的环境
  if (config && Object.keys(config).includes(input)) {
    return { env: input };
  }

  // 将 input 当作查询字符串
  return { query: input };
};

/**
 * 根据 input 和 context 加载 browserslist 配置
 */
const load = (input, context) => {
  const { configPath, env, query } = parse(input, context);

  /**
   * 若存在 query，直接使用该查询字符串加载浏览器列表
   * 若存在 configPath，则根据该路径和环境加载配置
   * 否则，尝试从 context 的路径中查找配置文件
   */
  const config =
    query ||
    (configPath
      ? browserslist.loadConfig({
          config: configPath,
          env,
        })
      : browserslist.loadConfig({ path: context, env }));

  if (!config) return;
  return browserslist(config);
};

const resolve = () => {};

module.exports = {
  resolve,
  load,
};
