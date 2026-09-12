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
var AmberReceiver_exports = {};
__export(AmberReceiver_exports, {
  default: () => AmberReceiver_default
});
module.exports = __toCommonJS(AmberReceiver_exports);
var import_AmberMessage = __toESM(require("./AmberMessage"));
var import_SerialDevice = __toESM(require("./SerialDevice"));
const CMD_DATA_REQ = 0;
const CMD_DATARETRY_REQ = 2;
const CMD_DATA_IND = 3;
const CMD_SET_MODE_REQ = 4;
const CMD_RESET_REQ = 5;
const CMD_SET_CHANNEL_REQ = 6;
const CMD_SET_REQ = 9;
const CMD_GET_REQ = 10;
const CMD_SERIALNO_REQ = 11;
const CMD_FWV_REQ = 12;
const CMD_RSSI_REQ = 13;
const CMD_SETUARTSPEED_REQ = 16;
const CMD_FACTORYRESET_REQ = 17;
const CMD_DATA_PRELOAD_REQ = 48;
const CMD_DATA_CLR_PRELOAD_REQ = 49;
const CMD_SET_AES_KEY_REQ = 80;
class AmberReceiver extends import_SerialDevice.default {
  rssiEnabled;
  constructor(options, mode, onMessage, onError, loggerFunction) {
    super(options, mode, onMessage, onError, loggerFunction);
    this.log.setPrefix("AMBER");
    this.rssiEnabled = false;
  }
  buildPayloadPackage(command, payload) {
    return new import_AmberMessage.default().setPayload(command, payload).build();
  }
  checkAndExtractMessage() {
    return this.extractMessageByLength(
      import_AmberMessage.default.START_BYTE,
      import_AmberMessage.default.tryToGetLength,
      (messageBuffer) => this.isMessageIntact(messageBuffer)
    );
  }
  /**
   * A message with a wrong checksum is not one: its start byte was payload
   * data that happens to look like the start of a message.
   */
  isMessageIntact(messageBuffer) {
    const parseResult = new import_AmberMessage.default().parse(messageBuffer);
    if (parseResult === true) {
      return true;
    }
    this.log.debug(`${parseResult} - looking for the next start byte`);
    return false;
  }
  /**
   * Responses have the confirm bit set, so a data indication cannot be one -
   * without this, a telegram that arrives between a command and its response
   * is taken for the answer and fails the command with a command id mismatch.
   */
  isTelegramMessage(messageBuffer) {
    const message = new import_AmberMessage.default();
    message.parse(messageBuffer);
    return message.commandId === CMD_DATA_IND;
  }
  validateResponse(pkg, response) {
    const mPkg = new import_AmberMessage.default();
    mPkg.parse(pkg);
    const mResponse = new import_AmberMessage.default();
    mResponse.parse(response);
    if (mPkg.setupResponse().commandId != mResponse.commandId) {
      throw new Error("CommandId mismatch!");
    }
  }
  parseRawMessage(messageBuffer) {
    const amberMessage = new import_AmberMessage.default();
    const parseResult = amberMessage.parse(messageBuffer);
    if (parseResult !== true) {
      this.log.debug(parseResult);
    }
    const rssi = this.getRssi(amberMessage.payload);
    return {
      frameType: "A",
      containsCrc: false,
      rawData: this.fixPayload(amberMessage.payload),
      rssi,
      ts: (/* @__PURE__ */ new Date()).getTime()
    };
  }
  getRssi(payload) {
    if (!this.rssiEnabled) {
      return -1;
    }
    const rssi = payload[payload.length - 1];
    return rssi >= 128 ? (rssi - 256) / 2 - 74 : rssi / 2 - 74;
  }
  fixPayload(payload) {
    const withoutRssi = this.removeRssiFromPayload(payload);
    return Buffer.concat([Buffer.from([withoutRssi.length]), withoutRssi]);
  }
  removeRssiFromPayload(payload) {
    if (!this.rssiEnabled) {
      return payload;
    }
    return payload.subarray(0, payload.length - 1);
  }
  getMode() {
    switch (this.mode) {
      case "C":
        return 14;
      case "S":
        return 3;
      case "CT":
        return 9;
      default:
        return 8;
    }
  }
  getModeDescription() {
    switch (this.mode) {
      case "C":
        return "C-Mode";
      case "S":
        return "S-Mode";
      case "CT":
        return "combined C/T-Mode";
      default:
        return "T-Mode";
    }
  }
  async getReq(address) {
    const response = await this.sendPackage(CMD_GET_REQ, Buffer.from([address, 1]));
    const m = new import_AmberMessage.default();
    m.parse(response);
    return m.payload[2];
  }
  async reset() {
    await this.sendPackage(CMD_RESET_REQ, Buffer.alloc(0));
  }
  async isCmdOutDisabled() {
    const response = await this.getReq(5);
    return response == 1 ? false : true;
  }
  async setCmdOutEnabled(state) {
    state = state ? 1 : 0;
    this.log.debug(`${state ? "Enabling" : "Disabling"} UART_CMD_Out...`);
    const response = await this.sendPackage(CMD_SET_REQ, Buffer.from([5, 1, state]));
    const m = new import_AmberMessage.default();
    m.parse(response);
    if (m.payload[0] === 1) {
      throw new Error("Verification failed!");
    } else if (m.payload[0] === 2) {
      throw new Error("Error: invalid memory position or invalid number of bytes");
    }
    await this.reset();
  }
  async getAutosleep() {
    return await this.getReq(63);
  }
  async isRssiEnabled() {
    return await this.getReq(69);
  }
  async getFwVersion() {
    const response = await this.sendPackage(CMD_FWV_REQ, Buffer.alloc(0));
    const m = new import_AmberMessage.default();
    m.parse(response);
    this.log.debug(`Firmware version ${m.payload[0]}.${m.payload[1]}.${m.payload[2]}`);
  }
  async setMode() {
    const mode = this.getMode();
    await this.sendPackage(CMD_SET_MODE_REQ, Buffer.from([mode]));
    this.log.info(`Receiver set to ${this.getModeDescription()}-MODE`);
  }
  async initDevice() {
    await this.getFwVersion();
    await this.setMode();
    if (await this.isCmdOutDisabled()) {
      await this.setCmdOutEnabled(true);
      this.log.debug("Enabled UART_CMD_Out; wait for 500 msec");
      await this.delay(500);
    } else {
      this.log.debug("UART_CMD_Out is enabled");
    }
    this.rssiEnabled = await this.isRssiEnabled() ? true : false;
    this.log.debug(`RSSI is ${this.rssiEnabled ? "enabled" : "disabled"}`);
    const autosleepState = await this.getAutosleep();
    if (autosleepState != 0) {
      this.log.warn(`Auto sleep is enabled! Messages ${autosleepState == 2 ? "will" : "might"} get lost!`);
    } else {
      this.log.debug("Autosleep is disabled");
    }
  }
}
var AmberReceiver_default = AmberReceiver;
//# sourceMappingURL=AmberReceiver.js.map
