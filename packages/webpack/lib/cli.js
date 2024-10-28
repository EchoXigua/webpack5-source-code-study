"use strict";

const path = require("path");
const webpackSchema = require("../schemas/WebpackOptions.json");

const getArguments = (schema = webpackSchema) => {
  /** @type {Flags} */
  const flags = {};

  /**
   * @param {string} input input
   * @returns {string} result
   */
  const pathToArgumentName = (input) =>
    input
      .replace(/\./g, "-")
      .replace(/\[\]/g, "")
      .replace(
        /(\p{Uppercase_Letter}+|\p{Lowercase_Letter}|\d)(\p{Uppercase_Letter}+)/gu,
        "$1-$2"
      )
      .replace(/-?[^\p{Uppercase_Letter}\p{Lowercase_Letter}\d]+/gu, "-")
      .toLowerCase();

  /**
   * @param {string} path path
   * @returns {Schema} schema part
   */
  const getSchemaPart = (path) => {
    const newPath = path.split("/");

    let schemaPart = schema;

    for (let i = 1; i < newPath.length; i++) {
      const inner = schemaPart[newPath[i]];

      if (!inner) {
        break;
      }

      schemaPart = inner;
    }

    return schemaPart;
  };

  /**
   * @param {PathItem[]} path path in the schema
   * @returns {string | undefined} description
   */
  const getDescription = (path) => {
    for (const { schema } of path) {
      if (schema.cli) {
        if (schema.cli.helper) continue;
        if (schema.cli.description) return schema.cli.description;
      }
      if (schema.description) return schema.description;
    }
  };

  /**
   * @param {PathItem[]} path path in the schema
   * @returns {string | undefined} negative description
   */
  const getNegatedDescription = (path) => {
    for (const { schema } of path) {
      if (schema.cli) {
        if (schema.cli.helper) continue;
        if (schema.cli.negatedDescription) return schema.cli.negatedDescription;
      }
    }
  };

  /**
   * @param {PathItem[]} path path in the schema
   * @returns {string | undefined} reset description
   */
  const getResetDescription = (path) => {
    for (const { schema } of path) {
      if (schema.cli) {
        if (schema.cli.helper) continue;
        if (schema.cli.resetDescription) return schema.cli.resetDescription;
      }
    }
  };

  /**
   * @param {Schema} schemaPart schema
   * @returns {Pick<ArgumentConfig, "type"|"values"> | undefined} partial argument config
   */
  const schemaToArgumentConfig = (schemaPart) => {
    if (schemaPart.enum) {
      return {
        type: "enum",
        values: schemaPart.enum,
      };
    }
    switch (schemaPart.type) {
      case "number":
        return {
          type: "number",
        };
      case "string":
        return {
          type: schemaPart.absolutePath ? "path" : "string",
        };
      case "boolean":
        return {
          type: "boolean",
        };
    }
    if (schemaPart.instanceof === "RegExp") {
      return {
        type: "RegExp",
      };
    }
    return undefined;
  };

  /**
   * @param {PathItem[]} path path in the schema
   * @returns {void}
   */
  const addResetFlag = (path) => {
    const schemaPath = path[0].path;
    const name = pathToArgumentName(`${schemaPath}.reset`);
    const description =
      getResetDescription(path) ||
      `Clear all items provided in '${schemaPath}' configuration. ${getDescription(
        path
      )}`;
    flags[name] = {
      configs: [
        {
          type: "reset",
          multiple: false,
          description,
          path: schemaPath,
        },
      ],
      description: undefined,
      simpleType:
        /** @type {SimpleType} */
        (/** @type {unknown} */ (undefined)),
      multiple: /** @type {boolean} */ (/** @type {unknown} */ (undefined)),
    };
  };

  /**
   * @param {PathItem[]} path full path in schema
   * @param {boolean} multiple inside of an array
   * @returns {number} number of arguments added
   */
  const addFlag = (path, multiple) => {
    const argConfigBase = schemaToArgumentConfig(path[0].schema);
    if (!argConfigBase) return 0;

    const negatedDescription = getNegatedDescription(path);
    const name = pathToArgumentName(path[0].path);
    /** @type {ArgumentConfig} */
    const argConfig = {
      ...argConfigBase,
      multiple,
      description: getDescription(path),
      path: path[0].path,
    };

    if (negatedDescription) {
      argConfig.negatedDescription = negatedDescription;
    }

    if (!flags[name]) {
      flags[name] = {
        configs: [],
        description: undefined,
        simpleType:
          /** @type {SimpleType} */
          (/** @type {unknown} */ (undefined)),
        multiple: /** @type {boolean} */ (/** @type {unknown} */ (undefined)),
      };
    }

    if (
      flags[name].configs.some(
        (item) => JSON.stringify(item) === JSON.stringify(argConfig)
      )
    ) {
      return 0;
    }

    if (
      flags[name].configs.some(
        (item) => item.type === argConfig.type && item.multiple !== multiple
      )
    ) {
      if (multiple) {
        throw new Error(
          `Conflicting schema for ${path[0].path} with ${argConfig.type} type (array type must be before single item type)`
        );
      }
      return 0;
    }

    flags[name].configs.push(argConfig);

    return 1;
  };

  // TODO support `not` and `if/then/else`
  // TODO support `const`, but we don't use it on our schema
  /**
   * @param {Schema} schemaPart the current schema
   * @param {string} schemaPath the current path in the schema
   * @param {{schema: object, path: string}[]} path all previous visited schemaParts
   * @param {string | null} inArray if inside of an array, the path to the array
   * @returns {number} added arguments
   */
  const traverse = (schemaPart, schemaPath = "", path = [], inArray = null) => {
    while (schemaPart.$ref) {
      schemaPart = getSchemaPart(schemaPart.$ref);
    }

    const repetitions = path.filter(({ schema }) => schema === schemaPart);
    if (
      repetitions.length >= 2 ||
      repetitions.some(({ path }) => path === schemaPath)
    ) {
      return 0;
    }

    if (schemaPart.cli && schemaPart.cli.exclude) return 0;

    const fullPath = [{ schema: schemaPart, path: schemaPath }, ...path];

    let addedArguments = 0;

    addedArguments += addFlag(fullPath, Boolean(inArray));

    if (schemaPart.type === "object") {
      if (schemaPart.properties) {
        for (const property of Object.keys(schemaPart.properties)) {
          addedArguments += traverse(
            /** @type {Schema} */
            (schemaPart.properties[property]),
            schemaPath ? `${schemaPath}.${property}` : property,
            fullPath,
            inArray
          );
        }
      }

      return addedArguments;
    }

    if (schemaPart.type === "array") {
      if (inArray) {
        return 0;
      }
      if (Array.isArray(schemaPart.items)) {
        const i = 0;
        for (const item of schemaPart.items) {
          addedArguments += traverse(
            /** @type {Schema} */
            (item),
            `${schemaPath}.${i}`,
            fullPath,
            schemaPath
          );
        }

        return addedArguments;
      }

      addedArguments += traverse(
        /** @type {Schema} */
        (schemaPart.items),
        `${schemaPath}[]`,
        fullPath,
        schemaPath
      );

      if (addedArguments > 0) {
        addResetFlag(fullPath);
        addedArguments++;
      }

      return addedArguments;
    }

    const maybeOf = schemaPart.oneOf || schemaPart.anyOf || schemaPart.allOf;

    if (maybeOf) {
      const items = maybeOf;

      for (let i = 0; i < items.length; i++) {
        addedArguments += traverse(
          /** @type {Schema} */
          (items[i]),
          schemaPath,
          fullPath,
          inArray
        );
      }

      return addedArguments;
    }

    return addedArguments;
  };

  traverse(schema);

  // Summarize flags
  for (const name of Object.keys(flags)) {
    /** @type {Argument} */
    const argument = flags[name];
    argument.description = argument.configs.reduce((desc, { description }) => {
      if (!desc) return description;
      if (!description) return desc;
      if (desc.includes(description)) return desc;
      return `${desc} ${description}`;
    }, /** @type {string | undefined} */ (undefined));
    argument.simpleType =
      /** @type {SimpleType} */
      (
        argument.configs.reduce((t, argConfig) => {
          /** @type {SimpleType} */
          let type = "string";
          switch (argConfig.type) {
            case "number":
              type = "number";
              break;
            case "reset":
            case "boolean":
              type = "boolean";
              break;
            case "enum": {
              const values =
                /** @type {NonNullable<ArgumentConfig["values"]>} */
                (argConfig.values);

              if (values.every((v) => typeof v === "boolean")) type = "boolean";
              if (values.every((v) => typeof v === "number")) type = "number";
              break;
            }
          }
          if (t === undefined) return type;
          return t === type ? t : "string";
        }, /** @type {SimpleType | undefined} */ (undefined))
      );
    argument.multiple = argument.configs.some((c) => c.multiple);
  }

  return flags;
};

const processArguments = () => {};

module.exports.getArguments = getArguments;
module.exports.processArguments = processArguments;
