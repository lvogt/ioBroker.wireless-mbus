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
var CulReceiver_exports = {};
__export(CulReceiver_exports, {
  default: () => CulReceiver_default
});
module.exports = __toCommonJS(CulReceiver_exports);
var import_SerialDevice = __toESM(require("./SerialDevice"));
const CMD_END = "\r\n";
const CMD_SET_DATA_REPORTING_AND_MODE = "X21\r\nbr";
const CMD_VERSION = "V";
const TELEGRAM_LINE = 98;
const FRAME_TYPE_B_LINE = 89;
const FRAME_TYPE_A = 1;
const FRAME_TYPE_B = 0;
const STALE_DATA_TIMEOUT = 100;
class CulReceiver extends import_SerialDevice.default {
  constructor(options, mode, onMessage, onError, loggerFunction) {
    super(options, mode, onMessage, onError, loggerFunction);
    this.log.setPrefix("CUL");
    this.staleDataTimeout = STALE_DATA_TIMEOUT;
  }
  /**
   * Every command is sent with a separator in front of it. That costs
   * nothing - culfw ignores an empty line - and buys two things: it ends
   * whatever a previous run left in the firmware's command buffer, which is
   * kept across connections, and it takes the place of the command letter
   * where the first byte written after an idle line is lost. Some CH340
   * based CULs do lose it, and the command letter of "X21" going missing was
   * what culfw then answered with "? (21 is unknown)".
   */
  buildPayloadPackage(command, payload) {
    const s = CMD_END + command + (payload ? payload : "") + CMD_END;
    return Buffer.from(s);
  }
  /**
   * The CUL is line based and sends one telegram or one command response per
   * line, so several of them can share a chunk. Taking the whole buffer as
   * one message dropped everything after the first line without a trace -
   * Buffer.from(..., 'hex') stops at the first character that is not a hex
   * digit instead of complaining about it. Take one line at a time.
   */
  checkAndExtractMessage() {
    for (; ; ) {
      const end = this.parserBuffer.indexOf(CMD_END);
      if (end === -1) {
        return null;
      }
      const line = this.parserBuffer.subarray(0, end);
      this.parserBuffer = this.parserBuffer.subarray(end + CMD_END.length);
      if (!line.length) {
        continue;
      }
      if (line[0] !== TELEGRAM_LINE) {
        return line;
      }
      const isFrameTypeB = line[1] === FRAME_TYPE_B_LINE;
      const hexString = line.toString("ascii", isFrameTypeB ? 2 : 1);
      const data = Buffer.from(hexString, "hex");
      if (data.length * 2 !== hexString.length) {
        this.log.debug(`Discarding line with invalid hex data: ${hexString}`);
        continue;
      }
      return Buffer.concat([Buffer.from([isFrameTypeB ? FRAME_TYPE_B : FRAME_TYPE_A]), data]);
    }
  }
  /**
   * Which of the two a message is cannot be seen from the message itself: a
   * telegram is binary and a response is whatever the firmware answers. The
   * marker that extraction put in front of a telegram says it, and without
   * that a telegram arriving between a command and its response was taken
   * for the response and failed the command.
   */
  isTelegramMessage(messageBuffer) {
    return messageBuffer[0] === FRAME_TYPE_A || messageBuffer[0] === FRAME_TYPE_B;
  }
  parseRawMessage(messageBuffer) {
    let rssi = messageBuffer[messageBuffer.length - 1];
    rssi = rssi >= 128 ? (rssi - 256) / 2 - 74 : rssi / 2 - 74;
    const frameType = messageBuffer[0] === FRAME_TYPE_B ? "B" : "A";
    const payload = messageBuffer.subarray(1, messageBuffer.length - 1);
    return {
      frameType,
      containsCrc: true,
      rawData: payload,
      rssi,
      ts: (/* @__PURE__ */ new Date()).getTime()
    };
  }
  async setDataReportingAndMode() {
    const m = this.mode.toLowerCase();
    if (m != "s" && m != "t" && m != "c") {
      throw new Error("Unknown mode!");
    }
    const expectedResponse = `${m.toUpperCase()}MODE`;
    let lastUnexpectedResponse = null;
    const isModeConfirmation = (response) => {
      const text = response.toString("ascii");
      if (text.endsWith(expectedResponse)) {
        return true;
      }
      this.log.warn(`Ignoring unexpected response while setting ${expectedResponse}: ${text}`);
      lastUnexpectedResponse = text;
      return false;
    };
    try {
      await this.sendPackage(CMD_SET_DATA_REPORTING_AND_MODE, m, isModeConfirmation);
    } catch (error) {
      const seen = lastUnexpectedResponse ? ` - last response was ${String(lastUnexpectedResponse)}` : "";
      throw new Error(`Failed to set ${expectedResponse}: ${error}${seen}`);
    }
    this.log.info(`Receiver set to ${m.toUpperCase()}-MODE and data reporting with RSSI`);
  }
  async checkVersion() {
    try {
      const version = await this.sendPackage(CMD_VERSION);
      this.log.debug(`Version: ${version.toString("ascii")}`);
    } catch (error) {
      this.log.debug(`Error getting CUL version: ${error}`);
    }
  }
  async initDevice() {
    await this.checkVersion();
    await this.setDataReportingAndMode();
  }
}
var CulReceiver_default = CulReceiver;
//# sourceMappingURL=CulReceiver.js.map
