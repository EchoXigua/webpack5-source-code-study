/** 小写字母 'a' 的 ASCII 码，用于定义字母范围的起始点 */
const START_LOWERCASE_ALPHABET_CODE = "a".charCodeAt(0);
/** 大写字母 'A' 的 ASCII 码 */
const START_UPPERCASE_ALPHABET_CODE = "A".charCodeAt(0);

/** 从 'a' 到 'z' 的字符数,用 'z' 的 ASCII 码减去 'a' 的 ASCII 码并加 1，结果是 26 */
const DELTA_A_TO_Z = "z".charCodeAt(0) - START_LOWERCASE_ALPHABET_CODE + 1;

/**
 * 为标识符起始字符的数量,包括小写字母（a-z）、大写字母（A-Z）、下划线（_）和美元符号（$）
 * 26 + 26 + 1 + 1 = 54
 */
const NUMBER_OF_IDENTIFIER_START_CHARS = DELTA_A_TO_Z * 2 + 2; // a-z A-Z _ $
/**
 * 标识符非起始位置的字符数量,在起始字符的基础上加上 10个数字（0-9）
 */
const NUMBER_OF_IDENTIFIER_CONTINUATION_CHARS =
  NUMBER_OF_IDENTIFIER_START_CHARS + 10; // a-z A-Z _ $ 0-9

/**
 * 用于检查字符串首字符是否是非字母、非下划线和非 $
 */
const IDENTIFIER_NAME_REPLACE_REGEX = /^([^a-zA-Z$_])/;

/**
 * 用于将字符串中所有非字母、非数字和非 $ 的字符替换为下划线 _
 * 保证了字符串符合 JavaScript 标识符的命名规则
 */
const IDENTIFIER_ALPHA_NUMERIC_NAME_REPLACE_REGEX = /[^a-zA-Z0-9$]+/g;

class Template {
  /**
   * 用于将任意字符串 str 转换为合法的 JavaScript 标识符
   */
  static toIdentifier(str) {
    if (typeof str !== "string") return "";
    return (
      str
        /**
         * 替换字符串首字符
         *
         * - _ 是一个固定的字符，用来作为替换后的前缀
         * - $1 是一个反向引用，指的是正则表达式中第一个捕获组的内容
         * @example
         * 将 1abc 替换为 _1abc
         */
        .replace(IDENTIFIER_NAME_REPLACE_REGEX, "_$1")
        // 将字符串中的非法字符（非字母、非数字、非 $）替换为下划线
        .replace(IDENTIFIER_ALPHA_NUMERIC_NAME_REPLACE_REGEX, "_")
    );
  }
}

module.exports = Template;

module.exports.NUMBER_OF_IDENTIFIER_START_CHARS =
  NUMBER_OF_IDENTIFIER_START_CHARS;
module.exports.NUMBER_OF_IDENTIFIER_CONTINUATION_CHARS =
  NUMBER_OF_IDENTIFIER_CONTINUATION_CHARS;
