/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const { LogType } = require("./Logger");

/**
 * @param {FilterItemTypes} item an input item
 * @returns {FilterFunction | undefined} filter function
 */
const filterToFunction = (item) => {
  if (typeof item === "string") {
    const regExp = new RegExp(
      `[\\\\/]${item.replace(/[-[\]{}()*+?.\\^$|]/g, "\\$&")}([\\\\/]|$|!|\\?)`
    );
    return (ident) => regExp.test(ident);
  }
  if (item && typeof item === "object" && typeof item.test === "function") {
    return (ident) => item.test(ident);
  }
  if (typeof item === "function") {
    return item;
  }
  if (typeof item === "boolean") {
    return () => item;
  }
};

/**
 * @enum {number}
 */
const LogLevel = {
  none: 6,
  false: 6,
  error: 5,
  warn: 4,
  info: 3,
  log: 2,
  true: 2,
  verbose: 1,
};

/**
 * @param {LoggerOptions} options options object
 * @returns {LoggingFunction} logging function
 */
module.exports = ({ level = "info", debug = false, console }) => {
  const debugFilters =
    /** @type {FilterFunction[]} */
    (
      typeof debug === "boolean"
        ? [() => debug]
        : /** @type {FilterItemTypes[]} */ ([])
            .concat(debug)
            .map(filterToFunction)
    );
  /** @type {number} */
  const loglevel = LogLevel[`${level}`] || 0;

  /**
   * @param {string} name name of the logger
   * @param {LogTypeEnum} type type of the log entry
   * @param {any[]=} args arguments of the log entry
   * @returns {void}
   */
  const logger = (name, type, args) => {
    const labeledArgs = () => {
      if (Array.isArray(args)) {
        if (args.length > 0 && typeof args[0] === "string") {
          return [`[${name}] ${args[0]}`, ...args.slice(1)];
        }
        return [`[${name}]`, ...args];
      }
      return [];
    };
    const debug = debugFilters.some((f) => f(name));
    switch (type) {
      case LogType.debug:
        if (!debug) return;
        if (typeof console.debug === "function") {
          console.debug(...labeledArgs());
        } else {
          console.log(...labeledArgs());
        }
        break;
      case LogType.log:
        if (!debug && loglevel > LogLevel.log) return;
        console.log(...labeledArgs());
        break;
      case LogType.info:
        if (!debug && loglevel > LogLevel.info) return;
        console.info(...labeledArgs());
        break;
      case LogType.warn:
        if (!debug && loglevel > LogLevel.warn) return;
        console.warn(...labeledArgs());
        break;
      case LogType.error:
        if (!debug && loglevel > LogLevel.error) return;
        console.error(...labeledArgs());
        break;
      case LogType.trace:
        if (!debug) return;
        console.trace();
        break;
      case LogType.groupCollapsed:
        if (!debug && loglevel > LogLevel.log) return;
        if (!debug && loglevel > LogLevel.verbose) {
          if (typeof console.groupCollapsed === "function") {
            console.groupCollapsed(...labeledArgs());
          } else {
            console.log(...labeledArgs());
          }
          break;
        }
      // falls through
      case LogType.group:
        if (!debug && loglevel > LogLevel.log) return;
        if (typeof console.group === "function") {
          console.group(...labeledArgs());
        } else {
          console.log(...labeledArgs());
        }
        break;
      case LogType.groupEnd:
        if (!debug && loglevel > LogLevel.log) return;
        if (typeof console.groupEnd === "function") {
          console.groupEnd();
        }
        break;
      case LogType.time: {
        if (!debug && loglevel > LogLevel.log) return;
        const [label, start, end] =
          /** @type {[string, number, number]} */
          (args);
        const ms = start * 1000 + end / 1000000;
        const msg = `[${name}] ${label}: ${ms} ms`;
        if (typeof console.logTime === "function") {
          console.logTime(msg);
        } else {
          console.log(msg);
        }
        break;
      }
      case LogType.profile:
        if (typeof console.profile === "function") {
          console.profile(...labeledArgs());
        }
        break;
      case LogType.profileEnd:
        if (typeof console.profileEnd === "function") {
          console.profileEnd(...labeledArgs());
        }
        break;
      case LogType.clear:
        if (!debug && loglevel > LogLevel.log) return;
        if (typeof console.clear === "function") {
          console.clear();
        }
        break;
      case LogType.status:
        if (!debug && loglevel > LogLevel.info) return;
        if (typeof console.status === "function") {
          if (!args || args.length === 0) {
            console.status();
          } else {
            console.status(...labeledArgs());
          }
        } else if (args && args.length !== 0) {
          console.info(...labeledArgs());
        }
        break;
      default:
        throw new Error(`Unexpected LogType ${type}`);
    }
  };
  return logger;
};
