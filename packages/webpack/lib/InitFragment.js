/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Florent Cailhol @ooflorent
*/

"use strict";

const { ConcatSource } = require("webpack-sources");
const makeSerializable = require("./util/makeSerializable");

/**
 * 接收 fragment 和 index，将它们组合成一个 [fragment, index] 元组并返回。这个元组在后续排序中有重要作用
 */
const extractFragmentIndex = (fragment, index) => [fragment, index];

/**
 * 对两个 InitFragment 进行排序
 * 基于片段的阶段 (stage)、位置 (position) 和索引顺序 (index) 来排序，确保片段按正确的顺序执行
 */
const sortFragmentWithIndex = ([a, i], [b, j]) => {
  const stageCmp = a.stage - b.stage;
  if (stageCmp !== 0) return stageCmp;
  const positionCmp = a.position - b.position;
  if (positionCmp !== 0) return positionCmp;
  return i - j;
};

/**
 * 这个类是一个用于存储和管理初始化代码片段的类，主要应用于 Webpack 编译过程中模块代码的生成阶段
 * 在构建模块时，Webpack 需要在模块代码的开头或末尾插入特定的初始化代码，
 * 这些初始化代码片段通过 InitFragment 类的实例进行存储、排序、去重并最终合并为完整的输出代码。
 * @template GenerateContext
 */
class InitFragment {
  /**
   * @param {string | Source | undefined} content 这个片段的内容，将作为模块初始化代码的一部分
   * @param {number} stage 初始化代码片段的阶段，不同阶段的初始化代码会有不同的执行顺序，数值越低，优先级越高
   * @param {number} position 阶段内的排序优先级
   * @param {string=} key 唯一标识符，用于去重。带有相同 key 的 InitFragment 将只保留一个实例
   * @param {string | Source=} endContent 在模块末尾添加的内容（类似于 content，但作用于模块尾部）
   */
  constructor(content, stage, position, key, endContent) {
    this.content = content;
    this.stage = stage;
    this.position = position;
    this.key = key;
    this.endContent = endContent;
  }

  /**
   * 获取初始化代码内容，用于插入模块开头
   */
  getContent(context) {
    return this.content;
  }

  /**
   * 获取插入到模块末尾的内容
   */
  getEndContent(context) {
    return this.endContent;
  }

  /**
   * 类的静态方法，用于将多个初始化片段 initFragments 按顺序合并，并添加到主 source 中
   * 核心操作包括排序、去重、合并相同 key 的片段，以及最终组合代码内容
   * @param {Source} source 源代码对象，表示模块的主要内容
   * @param {InitFragment<T>[]} initFragments 初始化片段数组
   * @param {Context} context context
   * @returns {Source} source
   */
  static addToSource(source, initFragments, context) {
    if (initFragments.length > 0) {
      //  将 initFragments 转化为 [fragment, index] 的元组，index 是片段的初始位置，便于排序时使用
      const sortedFragments = initFragments
        .map(extractFragmentIndex)
        // 按 stage、position、index 排序，这样先执行低 stage 和低 position 的片段
        .sort(sortFragmentWithIndex);

      // 存储 keyedFragments，用于去重和合并相同 key 的片段
      const keyedFragments = new Map();
      for (const [fragment] of sortedFragments) {
        if (typeof fragment.mergeAll === "function") {
          if (!fragment.key) {
            throw new Error(
              `InitFragment with mergeAll function must have a valid key: ${fragment.constructor.name}`
            );
          }

          // 这些片段允许批量合并 若已有片段且 oldValue 是数组，则将当前片段加入数组。若 oldValue 不是数组，转为数组
          const oldValue = keyedFragments.get(fragment.key);
          if (oldValue === undefined) {
            keyedFragments.set(fragment.key, fragment);
          } else if (Array.isArray(oldValue)) {
            oldValue.push(fragment);
          } else {
            keyedFragments.set(fragment.key, [oldValue, fragment]);
          }
          continue;
        } else if (typeof fragment.merge === "function") {
          // 这些片段允许单独合并，若 oldValue 存在则直接调用 merge 函数合并
          const oldValue = keyedFragments.get(fragment.key);
          if (oldValue !== undefined) {
            keyedFragments.set(fragment.key, fragment.merge(oldValue));
            continue;
          }
        }

        // 没有 key 的片段：以 Symbol("fragment key") 作为键加入 Map，确保唯一
        keyedFragments.set(fragment.key || Symbol("fragment key"), fragment);
      }

      // 存储最终的合并代码
      const concatSource = new ConcatSource();
      const endContents = [];

      // 遍历去重、排序后的片段
      for (let fragment of keyedFragments.values()) {
        // 数组格式的片段，使用 mergeAll 合并
        if (Array.isArray(fragment)) {
          fragment = fragment[0].mergeAll(fragment);
        }
        //  将每个片段的代码内容添加到 concatSource
        concatSource.add(fragment.getContent(context));
        // 若片段包含 endContent，则将其添加到 endContents 数组中
        const endContent = fragment.getEndContent(context);
        if (endContent) {
          endContents.push(endContent);
        }
      }

      // 将 source 添加到 concatSource 中，作为模块的主要代码内容
      concatSource.add(source);

      // 遍历 endContents，并按倒序添加到 concatSource 尾部，以确保正确的顺序
      for (const content of endContents.reverse()) {
        concatSource.add(content);
      }
      return concatSource;
    }
    return source;
  }

  /**
   * @param {ObjectSerializerContext} context context
   */
  serialize(context) {
    const { write } = context;

    write(this.content);
    write(this.stage);
    write(this.position);
    write(this.key);
    write(this.endContent);
  }

  /**
   * @param {ObjectDeserializerContext} context context
   */
  deserialize(context) {
    const { read } = context;

    this.content = read();
    this.stage = read();
    this.position = read();
    this.key = read();
    this.endContent = read();
  }
}

makeSerializable(InitFragment, "webpack/lib/InitFragment");

InitFragment.prototype.merge =
  /** @type {TODO} */
  (undefined);

/**
 * InitFragment 使用一组静态常量来定义不同的阶段。这些阶段决定了初始化片段的执行顺序
 *
 * 在 Webpack 中，"Harmony" 指的是 ECMAScript 模块化系统（也叫 ES Modules，简称 ESM）。
 * 这个术语来源于 "ECMAScript Harmony"， 即 ECMAScript 6（ES6）的开发代号。
 * ES6 是第一个原生支持模块系统的 JavaScript 版本，随后被称为 ES2015。
 *
 * 当 Webpack 识别到一个模块使用 ESM 语法时（如 import 或 export），
 * 它会自动将该模块标记为 "Harmony" 类型，并按 ESM 规范进行处理。
 *
 * - 静态分析：Webpack 能够通过静态分析依赖关系来实现摇树优化（Tree Shaking），仅打包实际用到的代码片段。
 * - 兼容性：Webpack 将 ESM 代码转化为兼容不同模块系统的代码，可以同时与 CommonJS、AMD 等模块兼容。
 * - 按需加载：Harmony 模块系统原生支持按需加载，提升了代码分割和性能优化的灵活性。
 */

/** 常量的初始化阶段 */
InitFragment.STAGE_CONSTANTS = 10;
/** 异步边界阶段 */
InitFragment.STAGE_ASYNC_BOUNDARY = 20;
/** Harmony 导出的初始化阶段 */
InitFragment.STAGE_HARMONY_EXPORTS = 30;
/** Harmony 导入的初始化阶段 */
InitFragment.STAGE_HARMONY_IMPORTS = 40;
/** 为依赖提供初始化的阶段 */
InitFragment.STAGE_PROVIDES = 50;
/** 异步依赖的初始化阶段 */
InitFragment.STAGE_ASYNC_DEPENDENCIES = 60;
/** 异步 Harmony 导入的初始化阶段 */
InitFragment.STAGE_ASYNC_HARMONY_IMPORTS = 70;

module.exports = InitFragment;
