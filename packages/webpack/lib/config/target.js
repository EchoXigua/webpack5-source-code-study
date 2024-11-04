const memoize = require("../util/memoize");

const getBrowserslistTargetHandler = memoize(() =>
  require("./browserslistTargetHandler")
);

const getDefaultTarget = (context) => {
  // 判断是否存在有效的 browserslist 配置
  const browsers = getBrowserslistTargetHandler().load(null, context);
  return browsers ? "browserslist" : "web";
};

module.exports.getDefaultTarget = getDefaultTarget;
