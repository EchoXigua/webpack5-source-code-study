const memoize = require("../util/memoize");

const getBrowserslistTargetHandler = memoize(() =>
  require("./browserslistTargetHandler")
);

const getDefaultTarget = (context) => {
  const browsers = getBrowserslistTargetHandler().load(null, context);
  return browsers ? "browserslist" : "web";
};

module.exports.getDefaultTarget = getDefaultTarget;
