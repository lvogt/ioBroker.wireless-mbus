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
var ImstReceiver_exports = {};
__export(ImstReceiver_exports, {
  default: () => ImstReceiver_default
});
module.exports = __toCommonJS(ImstReceiver_exports);
var import_HciMessage = __toESM(require("./HciMessage"));
var import_SerialDevice = __toESM(require("./SerialDevice"));
const DEVMGMT_ID = 1;
const RADIOLINK_ID = 2;
const RADIOLINKTEST_ID = 3;
const HWTEST_ID = 4;
const DEVMGMT_MSG_SET_CONFIG_REQ = 3;
const DEVMGMT_MSG_SET_CONFIG_RSP = 4;
const RADIOLINK_MSG_WMBUSMSG_IND = 3;
const LINK_MODE_S1 = 0;
const LINK_MODE_S1m = 1;
const LINK_MODE_S2 = 2;
const LINK_MODE_T1 = 3;
const LINK_MODE_T2 = 4;
const LINK_MODE_R2 = 5;
const LINK_MODE_C1A = 6;
const LINK_MODE_C1B = 7;
const LINK_MODE_C2A = 8;
const LINK_MODE_C2B = 9;
class ImstReceiver extends import_SerialDevice.default {
  frameType;
  constructor(options, mode, onMessage, onError, loggerFunction) {
    super(options, mode, onMessage, onError, loggerFunction);
    this.log.setPrefix("IMST");
    this.frameType = "A";
  }
  buildPayloadPackage(command, payload) {
    return new import_HciMessage.default().setPayload(DEVMGMT_ID, command, payload).setCrc(true).build();
  }
  checkAndExtractMessage() {
    return this.extractMessageByLength(
      import_HciMessage.default.START_BYTE,
      import_HciMessage.default.tryToGetLength,
      (messageBuffer) => this.isMessageIntact(messageBuffer)
    );
  }
  /**
   * Whether a message decodes and, if it carries a CRC, whether that CRC is
   * correct. The module can be configured to send messages without one, and
   * then the start of frame byte and a self consistent length are all there
   * is to go by.
   */
  isMessageIntact(messageBuffer) {
    try {
      const parseResult = new import_HciMessage.default().parse(messageBuffer);
      if (parseResult === true) {
        return true;
      }
      this.log.debug(`${parseResult} - looking for the next start byte`);
    } catch (error) {
      this.log.debug(`${error} - looking for the next start byte`);
    }
    return false;
  }
  /**
   * Without this a telegram that arrives between a command and its response
   * is taken for the response and fails the command with a message id
   * mismatch.
   */
  isTelegramMessage(messageBuffer) {
    const message = new import_HciMessage.default();
    message.parse(messageBuffer);
    return message.endpointId === RADIOLINK_ID && message.messageId === RADIOLINK_MSG_WMBUSMSG_IND;
  }
  validateResponse(pkg, response) {
    const mPkg = new import_HciMessage.default();
    mPkg.parse(pkg);
    const mResponse = new import_HciMessage.default();
    mResponse.parse(response);
    if (mPkg.setupResponse().messageId != mResponse.messageId) {
      throw new Error("MessageId mismatch!");
    }
  }
  parseRawMessage(messageBuffer) {
    var _a, _b;
    const hciMessage = new import_HciMessage.default();
    const parseResult = hciMessage.parse(messageBuffer);
    if (parseResult !== true) {
      this.log.debug(parseResult);
    }
    return {
      frameType: this.frameType,
      containsCrc: false,
      rawData: this.prefixPayloadWithLength(hciMessage.payload),
      rssi: (_a = hciMessage.rssi) != null ? _a : -1,
      ts: hciMessage.hasTimestamp ? (_b = hciMessage.timestamp) != null ? _b : 0 : (/* @__PURE__ */ new Date()).getTime()
    };
  }
  prefixPayloadWithLength(payload) {
    return Buffer.concat([Buffer.from([payload.length]), payload]);
  }
  getMode() {
    switch (this.mode) {
      case "S":
        return LINK_MODE_S1;
      case "CA":
        return LINK_MODE_C1A;
      case "CB":
        return LINK_MODE_C1B;
      default:
        return LINK_MODE_T1;
    }
  }
  async setModeAndDisableSleepMode() {
    const mode = this.getMode();
    this.frameType = mode == LINK_MODE_C1B ? "B" : "A";
    if (mode > 9) {
      throw new Error(`Invalid mode! ${mode}`);
    }
    await this.sendPackage(DEVMGMT_MSG_SET_CONFIG_REQ, Buffer.from([0, 3, 0, mode, 8, 0]));
    this.log.info(`Receiver set to ${this.mode}-MODE`);
  }
  async initDevice() {
    await this.setModeAndDisableSleepMode();
  }
}
var ImstReceiver_default = ImstReceiver;
//# sourceMappingURL=ImstReceiver.js.map
