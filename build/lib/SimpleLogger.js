"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var SimpleLogger_exports = {};
__export(SimpleLogger_exports, {
  default: () => SimpleLogger_default
});
module.exports = __toCommonJS(SimpleLogger_exports);
class SimpleLogger {
  prefix;
  logError;
  logWarn;
  logInfo;
  logDebug;
  constructor(loggerFunction) {
    this.prefix = "";
    if (typeof loggerFunction === "undefined") {
      this.logError = console.log;
      this.logWarn = console.log;
      this.logInfo = console.log;
      this.logDebug = console.log;
    } else if (typeof loggerFunction === "function") {
      this.logError = loggerFunction;
      this.logWarn = loggerFunction;
      this.logInfo = loggerFunction;
      this.logDebug = loggerFunction;
    } else {
      this.logError = typeof loggerFunction.error === "function" ? loggerFunction.error : function() {
      };
      this.logInfo = typeof loggerFunction.info === "function" ? loggerFunction.info : function() {
      };
      this.logDebug = typeof loggerFunction.debug === "function" ? loggerFunction.debug : function() {
      };
      this.logWarn = typeof loggerFunction.warn === "function" ? loggerFunction.warn : this.logInfo;
    }
  }
  setPrefix(prefix) {
    this.prefix = prefix;
  }
  error(msg) {
    this.logError(`${this.prefix}: ${msg}`);
  }
  warn(msg) {
    this.logWarn(`${this.prefix}: ${msg}`);
  }
  info(msg) {
    this.logInfo(`${this.prefix}: ${msg}`);
  }
  debug(msg) {
    this.logDebug(`${this.prefix}: ${msg}`);
  }
}
var SimpleLogger_default = SimpleLogger;
//# sourceMappingURL=SimpleLogger.js.map
