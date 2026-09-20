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
var EbiReceiver_exports = {};
__export(EbiReceiver_exports, {
  default: () => EbiReceiver_default
});
module.exports = __toCommonJS(EbiReceiver_exports);
var import_SerialDevice = __toESM(require("./SerialDevice"));
var import_EbiMessage = __toESM(require("./EbiMessage"));
const DEVICE_INFORMATION_PROTOCOL = {
  0: "Unknown",
  1: "Proprietary",
  16: "802.15.4",
  32: "ZigBee",
  33: "ZigBee 2004 (1.0)",
  34: "ZigBee 2006",
  35: "ZigBee 2007",
  36: "ZigBee 2007-Pro",
  64: "Wireless M-Bus"
};
const DEVICE_INFORMATION_MODULE = {
  0: "Unknown",
  16: "Reserved",
  32: "EMB-ZRF2xx",
  36: "EMB-ZRF231xx",
  38: "EMB-ZRF231PA",
  40: "EMB-ZRF212xx",
  41: "EMB-ZRF212B",
  48: "EMB-Z253x",
  52: "EMB-Z2530x",
  54: "EMB-Z2530PA",
  56: "EMB-Z2531x",
  58: "EMB-Z2531PA-USB",
  60: "EMB-Z2538x",
  61: "EMB-Z2538PA",
  64: "EMB-WMBx",
  68: "EMB-WMB169x",
  69: "EMB-WMB169T",
  70: "EMB-WMB169PA",
  72: "EMB-WMB868x",
  73: "EMB-WMB868"
};
const JOINING_NETWORK_PREFERENCE = {
  JOINING_NETWORK_NOT_PERMITTED: 0,
  JOINING_NETWORK_PERMITTED: 1
};
const SCAN_MODE = {
  SCAN_MODE_ENERGY: 0,
  SCAN_MODE_PASSIVE: 1,
  SCAN_MODE_ACTIVE: 2
};
const EXECUTION_STATUS_BYTE_VALUE = {
  0: "Success",
  1: "Generic error",
  2: "Parameters not accepted",
  3: "Operation timeout",
  4: "No memory",
  5: "Unsupported",
  6: "Busy",
  7: "Duty Cycle"
};
const CHANNELS_WMB = {
  1: 1,
  // 169.40625[MHz] @4.8[kbps]
  2: 2,
  // 169,41875[MHz] @4.8[kbps]
  3: 3,
  // 169,43125[MHz] @2.4[kbps]
  4: 4,
  // 169,44375[MHz] @2.4[kbps]
  5: 5,
  // 169,45625[MHz] @4.8[kbps]
  6: 6,
  // 169,46875[MHz] @4.8[kbps]
  7: 7,
  // 169,43750[MHz] @19.2[kbps]
  13: 13,
  // 868.030[MHz] @4.8[kbps]
  14: 14,
  // 868,090[MHz] @4.8[kbps]
  15: 15,
  // 868,150[MHz] @4.8[kbps]
  16: 16,
  // 868.210[MHz] @4.8[kbps]
  17: 17,
  // 868.270[MHz] @4.8[kbps]
  18: 18,
  // 868.330[MHz] @4.8[kbps]
  19: 19,
  // 868.390[MHz] @4.8[kbps]
  20: 20,
  // 868.450[MHz] @4.8[kbps]
  21: 21,
  // 868.510[MHz] @4.8[kbps]
  22: 22,
  // 868.570[MHz] @4.8[kbps]
  23: 23,
  // 868,300[MHz] @16,384[kbps]
  24: 24,
  // 868,300[MHz] @16,384[kbps]
  25: 25,
  // 868,950[MHz] @66.666[kbps]
  26: 26,
  // 868.300[MHz] @16.384[kbps]
  27: 27,
  // 868.030[MHz] @2.4[kbps]
  28: 28,
  // 868.090[MHz] @2.4[kbps]
  29: 29,
  // 868.150[MHz] @2.4[kbps]
  30: 30,
  // 868.210[MHz] @2.4[kbps]
  31: 31,
  // 868.270[MHz] @2.4[kbps]
  32: 32,
  // 868.330[MHz] @2.4[kbps]
  33: 33,
  // 868.390[MHz] @2.4[kbps]
  34: 34,
  // 868.450[MHz] @2.4[kbps]
  35: 35,
  // 868.510[MHz] @2.4[kbps]
  36: 36,
  // 868.570[MHz] @2.4[kbps]
  37: 37,
  // 868.950[MHz] @100[kbps]
  38: 38
  // 869,525[MHz] @50[kbps]
};
const MODULE_MESSAGE_FLAG = 128;
const MSG_RECEIVED_DATA = 224;
const MIN_MESSAGE_LENGTH = 4;
const STALE_DATA_TIMEOUT = 100;
const CMD_DEVICE_INFORMATION = 1;
const CMD_DEVICE_STATE = 4;
const CMD_RESET = 5;
const CMD_FIRMWARE_VERSION = 6;
const CMD_RESTORE_SETTINGS = 7;
const CMD_SAVE_SETTINGS = 8;
const CMD_UART_CONFIG = 9;
const CMD_OUTPUT_POWER = 16;
const CMD_OPERATING_CHANNEL = 17;
const CMD_ENERGY_SAVE = 19;
const CMD_NETWORK_AUTOMATED_SETTINGS = 36;
const CMD_NETWORK_START = 49;
const CMD_BOOTLOADER_ENTER = 112;
const CMD_BOOTLOADER_SETOPTIONS = 113;
const CMD_BOOTLOADER_ERASEMEMORY = 120;
const CMD_BOOTLOADER_WRITE = 122;
const CMD_BOOTLOADER_READ = 123;
const CMD_BOOTLOADER_COMMIT = 127;
const RX_POLICY_ALLWAYS_ON_WMB = 0;
const RX_POLICY_ALLWAYS_OFF_WMB = 1;
const RX_POLICY_RECEIVED_WINDOW_WMB = 2;
const RX_POLICY_RECEIVED_WITH_END_WINDOW_WMB = 3;
const MCU_POLICY_ALLWAYS_ON_WMB = 0;
const MCU_POLICY_ALLWAYS_OFF_WMB = 1;
const NETWORK_ROLE_WMB = {
  NETWORK_ROLE_METER: 0,
  NETWORK_ROLE_OTHER_DEVICE: 1
};
class EbiReceiver extends import_SerialDevice.default {
  constructor(options, mode, onMessage, onError, loggerFunction) {
    super(options, mode, onMessage, onError, loggerFunction);
    this.log.setPrefix("EBI");
    this.staleDataTimeout = STALE_DATA_TIMEOUT;
  }
  buildPayloadPackage(command, payload = null) {
    return new import_EbiMessage.default().setPayload(command, payload).build();
  }
  checkAndExtractMessage() {
    return this.extractMessageByLength(
      // The protocol has nothing to synchronise on: no start marker, just
      // a length, a message id, the payload and a one byte checksum
      null,
      (candidate) => this.getMessageLength(candidate),
      (messageBuffer) => this.isMessageIntact(messageBuffer)
    );
  }
  getMessageLength(candidate) {
    const length = import_EbiMessage.default.tryToGetLength(candidate);
    if (length !== -1 && (length < MIN_MESSAGE_LENGTH || length > this.maxParserBufferLength)) {
      return 0;
    }
    return length;
  }
  /**
   * Whether a message could be one the module sent. The checksum is a single
   * byte, so it alone would accept one in 256 of the slices that a
   * resynchronisation tries out.
   */
  isMessageIntact(messageBuffer) {
    const message = new import_EbiMessage.default();
    if (message.parse(messageBuffer) !== true) {
      return false;
    }
    return (message.messageId & MODULE_MESSAGE_FLAG) !== 0;
  }
  /**
   * Without this a telegram that arrives between a command and its response
   * is taken for the response and fails the command.
   */
  isTelegramMessage(messageBuffer) {
    const message = new import_EbiMessage.default();
    message.parse(messageBuffer);
    return message.messageId === MSG_RECEIVED_DATA;
  }
  validateResponse(pkg, response) {
    const mPkg = new import_EbiMessage.default();
    mPkg.parse(pkg);
    const mResponse = new import_EbiMessage.default();
    mResponse.parse(response);
    if (mPkg.payload.length) {
      if (mResponse.payload[0] != 0) {
        throw new Error(
          `Package validation failed! Execution status: ${EXECUTION_STATUS_BYTE_VALUE[mResponse.payload[0]]}`
        );
      }
    }
    if (mPkg.setupResponse().messageId != mResponse.messageId) {
      throw new Error("MessageId mismatch!");
    }
  }
  parseRawMessage(messageBuffer) {
    const ebiMessage = new import_EbiMessage.default();
    const parseResult = ebiMessage.parse(messageBuffer);
    if (parseResult !== true) {
      this.log.debug(parseResult);
    }
    const options = ebiMessage.payload.readUInt16BE(0);
    const frameType = this.getFrameType(options);
    const rssi = this.getRssi(options, ebiMessage.payload);
    const ts = this.getTimestamp(options, ebiMessage.payload);
    const rawData = this.stripHeader(options, ebiMessage.payload);
    return {
      frameType,
      containsCrc: false,
      rawData,
      rssi,
      ts
    };
  }
  getRssi(options, payload) {
    if (options & 32768) {
      return payload.readInt8(2);
    }
    return -1;
  }
  getFrameType(options) {
    if (options & 16) {
      return "B";
    }
    return "A";
  }
  getTimestamp(options, payload) {
    if (options & 8) {
      const pos = 2 + (options & 32768 ? 1 : 0);
      return payload.readUInt32BE(pos) / 32768;
    }
    return (/* @__PURE__ */ new Date()).getTime();
  }
  stripHeader(options, payload) {
    const start = 2 + (options & 32768 ? 1 : 0) + (options & 8 ? 4 : 0);
    return payload.subarray(start);
  }
  async reset() {
    await this.sendPackage(CMD_RESET, Buffer.alloc(0));
    const response = await this.readResponse();
    const m = new import_EbiMessage.default();
    m.parse(response);
    if (m.payload[0] != 16) {
      this.log.warn(`Device not ready! ${m.payload.toString("hex")}`);
      return false;
    }
    this.log.debug("Device ready");
    return true;
  }
  async getDeviceInformation() {
    const response = await this.sendPackage(CMD_DEVICE_INFORMATION, Buffer.alloc(0));
    const m = new import_EbiMessage.default();
    m.parse(response);
    this.log.debug(
      `Found ${DEVICE_INFORMATION_PROTOCOL[m.payload[0]]} protocol and module ${DEVICE_INFORMATION_MODULE[m.payload[1]]}`
    );
    return m.payload;
  }
  async setOutputPower(power) {
    let payload;
    if (power >= 0) {
      payload = Buffer.from([power & 255]);
    } else {
      payload = Buffer.from([-power & 128]);
    }
    await this.sendPackage(CMD_OUTPUT_POWER, payload);
  }
  async setOperatingChannel(channel) {
    await this.sendPackage(CMD_OPERATING_CHANNEL, Buffer.from([CHANNELS_WMB[channel]]));
  }
  async setEnergySave(rxPolicy, mcuPolicy) {
    await this.sendPackage(CMD_ENERGY_SAVE, Buffer.from([rxPolicy, mcuPolicy]));
  }
  async setNetworkAutomatedSettings() {
    await this.sendPackage(CMD_NETWORK_AUTOMATED_SETTINGS, Buffer.from([128, 0]));
  }
  async saveSettings() {
    await this.sendPackage(CMD_SAVE_SETTINGS, Buffer.alloc(0));
  }
  async networkStart() {
    await this.sendPackage(CMD_NETWORK_START, Buffer.alloc(0));
  }
  getMode() {
    switch (this.mode) {
      case "T":
        return 25;
      case "S":
        return 24;
      case "C":
        return 37;
      default:
        return 25;
    }
  }
  getModeDescription() {
    switch (this.mode) {
      case "T":
        return "T-Mode 868.950[MHz] @66.666[kbps]";
      case "S":
        return "S-Mode 868.300[MHz] @16.384[kbps]";
      case "C":
        return "C-Mode 868.950[MHz] @100[kbps]";
      default:
        return "T-Mode 868.950[MHz] @66.666[kbps]";
    }
  }
  async initDevice() {
    const deviceInfo = await this.getDeviceInformation();
    if (!(deviceInfo[0] & 64)) {
      throw new Error("This is not an Embit Wireless M-Bus device!");
    }
    const deviceReady = await this.reset();
    await this.setOutputPower(15);
    this.log.debug("Power set to max");
    await this.setOperatingChannel(this.getMode());
    this.log.info(`Receiver set to ${this.getModeDescription()}`);
    await this.setEnergySave(RX_POLICY_ALLWAYS_ON_WMB, MCU_POLICY_ALLWAYS_ON_WMB);
    this.log.debug("Energy saving disabled");
    if (deviceReady) {
      await this.setNetworkAutomatedSettings();
      this.log.debug("Automatically start network");
      await this.saveSettings();
      this.log.debug("Settings saved");
    }
    await this.networkStart();
    this.log.debug("Network start okay!");
  }
}
var EbiReceiver_default = EbiReceiver;
//# sourceMappingURL=EbiReceiver.js.map
