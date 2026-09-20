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
var AesKeys_exports = {};
__export(AesKeys_exports, {
  KEY_PLACEHOLDER: () => KEY_PLACEHOLDER,
  default: () => AesKeys_default
});
module.exports = __toCommonJS(AesKeys_exports);
const KEY_PLACEHOLDER = "UNKNOWN";
const NO_KEY_ERROR = "NO_AES_KEY";
class AesKeys {
  rows;
  log;
  /** devices that asked for a key the configuration does not have */
  needsKey;
  /** devices whose configured key was reported as unusable */
  reportedInvalid;
  constructor(rows, log) {
    this.rows = Array.isArray(rows) ? rows : [];
    this.log = log;
    this.needsKey = /* @__PURE__ */ new Set();
    this.reportedInvalid = /* @__PURE__ */ new Set();
    for (const row of this.rows) {
      if (row.key === KEY_PLACEHOLDER) {
        this.needsKey.add(row.id);
      }
    }
  }
  /**
   * The configured key of a device. A configured id that the device id only
   * starts with counts as well, so one row can stand for a series of
   * meters - and the longest of them wins, which makes the exact match the
   * best possible one.
   *
   * @param id the device the telegram came from
   * @returns the key as it is configured, or undefined if there is none
   */
  getKey(id) {
    const candidates = this.rows.filter((row) => typeof row.id !== "undefined" && id.startsWith(row.id));
    if (!candidates.length) {
      return void 0;
    }
    return candidates.reduce((longest, row) => row.id.length > longest.id.length ? row : longest).key;
  }
  /**
   * Resolve the configured key of a device into the Buffer the parser
   * expects. Keys are stored either as 32 hex characters or as a 16
   * character plain text key.
   *
   * @param id the device the telegram came from
   * @returns the key, or undefined if there is none or it is unusable
   */
  getKeyBuffer(id) {
    const key = this.getKey(id);
    if (typeof key === "undefined" || key === KEY_PLACEHOLDER) {
      return void 0;
    }
    if (key.length === 32) {
      const buffer = Buffer.from(key, "hex");
      if (buffer.length === 16) {
        this.log.debug(`Found AES key for device ${id}`);
        return buffer;
      }
    } else if (key.length === 16) {
      this.log.debug(`Found AES key for device ${id}`);
      return Buffer.from(key, "latin1");
    }
    if (!this.reportedInvalid.has(id)) {
      this.reportedInvalid.add(id);
      this.log.error(`Invalid AES key configured for device ${id} - key rejected!`);
    }
    return void 0;
  }
  /**
   * Take note of a device whose telegram could not be decoded for lack of a
   * key, so the admin UI can offer to add a row for it.
   *
   * @param id the device the telegram came from
   * @param errorName the name of the error the parser threw
   */
  checkWrongKey(id, errorName) {
    if (errorName === NO_KEY_ERROR) {
      this.needsKey.add(id);
    }
  }
  /**
   * Merge the devices that asked for a key into a key list, each with the
   * placeholder key, and say how many rows that added.
   *
   * @param rows the list to merge into
   */
  mergeInto(rows) {
    const aeskeys = [...rows];
    let added = 0;
    for (const id of this.needsKey) {
      if (aeskeys.findIndex((item) => item.id === id) === -1) {
        aeskeys.push({ id, key: KEY_PLACEHOLDER });
        added++;
      }
    }
    return { aeskeys, added };
  }
}
var AesKeys_default = AesKeys;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KEY_PLACEHOLDER
});
//# sourceMappingURL=AesKeys.js.map
