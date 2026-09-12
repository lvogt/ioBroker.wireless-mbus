"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var SimpleReceiver_exports = {};
__export(SimpleReceiver_exports, {
  default: () => SimpleReceiver_default
});
module.exports = __toCommonJS(SimpleReceiver_exports);
var import_SerialDevice = __toESM(require("./SerialDevice"));
const CMD_END = "\n";
const CARRIAGE_RETURN = 13;
const CRC_MARKER = ["Z".charCodeAt(0), "z".charCodeAt(0)];
class SimpleReceiver extends import_SerialDevice.default {
  frameType;
  constructor(options, mode, onMessage, onError, loggerFunction) {
    super(options, mode, onMessage, onError, loggerFunction);
    this.log.setPrefix("SIMPLE");
    this.frameType = "A";
  }
  /** One telegram per line - and a chunk can hold more than one of them. */
  checkAndExtractMessage() {
    for (; ; ) {
      const end = this.parserBuffer.indexOf(CMD_END);
      if (end === -1) {
        return null;
      }
      let line = this.parserBuffer.subarray(0, end);
      this.parserBuffer = this.parserBuffer.subarray(end + CMD_END.length);
      if (line.length && line[line.length - 1] === CARRIAGE_RETURN) {
        line = line.subarray(0, line.length - 1);
      }
      if (!line.length) {
        continue;
      }
      const hexString = this.getHexString(line);
      if (!/^[0-9a-fA-F]+$/.test(hexString) || hexString.length % 2) {
        this.log.debug(`Discarding line with invalid hex data: ${line.toString("ascii")}`);
        continue;
      }
      return line;
    }
  }
  /**
   * The telegram of a line, without the marker that may be in front of it.
   *
   * @param line
   * @returns the telegram as the hex string it was written as
   */
  getHexString(line) {
    return line.toString("ascii", CRC_MARKER.includes(line[0]) ? 1 : 0);
  }
  parseRawMessage(messageBuffer) {
    return {
      frameType: this.frameType,
      // The marker is a promise that the telegram carries its CRCs.
      // Its absence promises nothing: a sender that passes on what it
      // picked up off the air hands them over without announcing them,
      // so let the parser look for them rather than tell it there are
      // none - which made it read the first CRC byte as the CI field
      // (#276).
      containsCrc: CRC_MARKER.includes(messageBuffer[0]) ? true : void 0,
      rawData: Buffer.from(this.getHexString(messageBuffer), "hex"),
      rssi: -1,
      ts: (/* @__PURE__ */ new Date()).getTime()
    };
  }
  // Deliberately async with nothing to await: init() awaits this hook, and
  // the tick that yields is what keeps the first telegram from being handled
  // before the receiver is ready.
  // eslint-disable-next-line @typescript-eslint/require-await
  async initDevice() {
    if (this.mode == "B") {
      this.frameType = "B";
    }
  }
}
var SimpleReceiver_default = SimpleReceiver;
//# sourceMappingURL=SimpleReceiver.js.map
