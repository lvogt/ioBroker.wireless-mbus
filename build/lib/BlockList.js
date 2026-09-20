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
var BlockList_exports = {};
__export(BlockList_exports, {
  AUTO_BLOCK_AFTER_FAILURES: () => AUTO_BLOCK_AFTER_FAILURES,
  default: () => BlockList_default
});
module.exports = __toCommonJS(BlockList_exports);
const AUTO_BLOCK_AFTER_FAILURES = 10;
class BlockList {
  configured;
  auto;
  log;
  /** device id -> how many of its telegrams failed to decode in a row */
  failures;
  /** devices the automatic block list rejected, until the adapter restarts */
  blocked;
  constructor(configured, options, log) {
    this.configured = Array.isArray(configured) ? configured : [];
    this.auto = options.auto === true;
    this.log = log;
    this.failures = /* @__PURE__ */ new Map();
    this.blocked = /* @__PURE__ */ new Set();
  }
  isBlocked(id) {
    if (this.blocked.has(id)) {
      return true;
    }
    return this.configured.some((item) => typeof item.id !== "undefined" && item.id == id);
  }
  /**
   * Count a telegram that failed to decode, and block the device once too
   * many of them did.
   *
   * @param id the device the telegram came from
   * @param [quiet] report the block in the debug log only
   */
  noteFailure(id, quiet = false) {
    var _a;
    if (!this.auto) {
      return;
    }
    const failures = ((_a = this.failures.get(id)) != null ? _a : 0) + 1;
    this.failures.set(id, failures);
    if (failures >= AUTO_BLOCK_AFTER_FAILURES && !this.blocked.has(id)) {
      this.blocked.add(id);
      const message = `Device ${id} is now blocked until adapter restart!`;
      if (quiet) {
        this.log.debug(message);
      } else {
        this.log.warn(message);
      }
    }
  }
  /**
   * Count a telegram that decoded. The failures have to be consecutive: a
   * meter whose compact telegrams wait for a full one must not collect its
   * way into the block list over days.
   *
   * @param id the device the telegram came from
   */
  noteSuccess(id) {
    this.failures.delete(id);
  }
}
var BlockList_default = BlockList;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUTO_BLOCK_AFTER_FAILURES
});
//# sourceMappingURL=BlockList.js.map
