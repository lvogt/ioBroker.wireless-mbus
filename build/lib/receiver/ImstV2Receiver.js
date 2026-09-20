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
var ImstV2Receiver_exports = {};
__export(ImstV2Receiver_exports, {
  default: () => ImstV2Receiver_default
});
module.exports = __toCommonJS(ImstV2Receiver_exports);
var import_HciMessageV2 = __toESM(require("./HciMessageV2"));
var import_SerialDevice = __toESM(require("./SerialDevice"));
var import_SlipEncoder = require("./SlipEncoder");
const SAP_DEVMGMT = 1;
const SAP_WMBUS = 9;
const DEVMGMT_OFFSET = 256;
const PING_REQ = 1 + DEVMGMT_OFFSET;
const PING_RSP = 2 + DEVMGMT_OFFSET;
const FW_INFO_REQ = 5 + DEVMGMT_OFFSET;
const FW_INFO_RSP = 6 + DEVMGMT_OFFSET;
const GET_ACTIVE_CONFIG_REQ = 1;
const GET_ACTIVE_CONFIG_RSP = 2;
const SET_ACTIVE_CONFIG_REQ = 3;
const SET_ACTIVE_CONFIG_RSP = 4;
const RX_MESSAGE_IND = 32;
const MIN_FRAME_LENGTH = 6;
const STALE_DATA_TIMEOUT = 100;
const LINK_MODE_S = 1;
const LINK_MODE_T = 2;
const LINK_MODE_CT = 3;
const LINK_MODE_C = 5;
const LINK_MODE_TX = 6;
class ImstV2Receiver extends import_SerialDevice.default {
  constructor(options, mode, onMessage, onError, loggerFunction) {
    super(options, mode, onMessage, onError, loggerFunction);
    this.log.setPrefix("IMSTv2");
    this.staleDataTimeout = STALE_DATA_TIMEOUT;
  }
  buildPayloadPackage(command, payload = null) {
    const sapId = command >= DEVMGMT_OFFSET ? SAP_DEVMGMT : SAP_WMBUS;
    const messageId = command - DEVMGMT_OFFSET;
    return new import_HciMessageV2.default().setDestinationId(sapId).setMessageId(messageId).setPayload(payload).build();
  }
  /**
   * Take the next complete SLIP frame out of the parser buffer.
   *
   * The END marker that closes a frame is deliberately left in the buffer:
   * a sender that does not repeat it uses it as the start marker of the next
   * frame. Consuming it would turn the frame behind it into a fragment
   * without a start marker, which is then dropped up to its own end marker -
   * so a single corrupt frame used to cost the frame following it as well.
   * Losing one command response that way is enough to make initDevice() time
   * out and leave the receiver dead (issues #308 and #309).
   */
  checkAndExtractMessage() {
    for (; ; ) {
      const start = this.parserBuffer.indexOf(import_SlipEncoder.END);
      if (start === -1) {
        return null;
      }
      if (start > 0) {
        this.parserBuffer = this.parserBuffer.subarray(start);
      }
      const end = this.parserBuffer.indexOf(import_SlipEncoder.END, 1);
      if (end === -1) {
        return null;
      }
      if (end + 1 >= MIN_FRAME_LENGTH) {
        const messageBuffer = this.parserBuffer.subarray(0, end + 1);
        this.parserBuffer = this.parserBuffer.subarray(end);
        if (this.isMessageIntact(messageBuffer)) {
          return messageBuffer;
        }
        continue;
      }
      this.parserBuffer = this.parserBuffer.subarray(end);
    }
  }
  /**
   * A frame that does not decode or whose CRC is wrong is no frame: it must
   * not be handed to a pending readResponse() as if it were the answer to a
   * command, and it must not reach the telegram parser either - a corrupt
   * telegram would count towards the automatic block list of a device that
   * is working perfectly well.
   */
  isMessageIntact(messageBuffer) {
    try {
      const parseResult = new import_HciMessageV2.default().parse(messageBuffer);
      if (parseResult === true) {
        return true;
      }
      this.log.debug(parseResult);
    } catch (error) {
      this.log.debug(`Malformed message: ${error}`);
    }
    this.log.debug(`Discarded message: ${messageBuffer.toString("hex")}`);
    return false;
  }
  validateResponse(pkg, response) {
    const mPkg = new import_HciMessageV2.default();
    mPkg.parse(pkg);
    const mResponse = new import_HciMessageV2.default();
    mResponse.parse(response);
    if (mPkg.setupResponse().messageId != mResponse.messageId) {
      throw new Error(
        `MessageId mismatch! actual: ${mResponse.messageId} - expected ${mPkg.setupResponse().messageId}`
      );
    }
  }
  isTelegramMessage(messageBuffer) {
    const msg = new import_HciMessageV2.default();
    msg.parse(messageBuffer);
    return msg.destinationId === 9 && msg.messageId === 32;
  }
  parseRawMessage(messageBuffer) {
    const hciMessage = new import_HciMessageV2.default();
    const parseResult = hciMessage.parse(messageBuffer);
    if (parseResult !== true) {
      this.log.debug(parseResult);
    }
    if (hciMessage.messageId !== RX_MESSAGE_IND) {
      this.log.debug(
        `Unhandled message received: 0x${hciMessage.messageId.toString(16)} - ${hciMessage.payload.toString("hex")}`
      );
    }
    const timestamp = hciMessage.payload.readInt32LE(0);
    const frameType = hciMessage.payload[6] >= 20 ? "B" : "A";
    const rssi = hciMessage.payload.readInt8(7);
    return {
      frameType,
      containsCrc: false,
      rawData: hciMessage.payload.subarray(8),
      rssi,
      ts: timestamp
    };
  }
  getMode() {
    switch (this.mode) {
      case "S":
        return LINK_MODE_S;
      case "T":
        return LINK_MODE_T;
      case "CT":
        return LINK_MODE_CT;
      case "C":
        return LINK_MODE_C;
      case "Tx":
        return LINK_MODE_TX;
      default:
        return LINK_MODE_CT;
    }
  }
  getModeDescription() {
    switch (this.mode) {
      case "S":
        return "S-Mode";
      case "T":
        return "T-Mode";
      case "CT":
        return "combined C/T-Mode";
      case "C":
        return "C-Mode (100 kbps)";
      case "Tx":
        return "enhanced T-Mode";
      default:
        return "combined C/T-Mode";
    }
  }
  logStatus(status) {
    if (status === 0) {
      this.log.debug("Device status: OK");
    } else {
      this.log.warn(`Device status not OK (0x${status.toString(16)})`);
    }
  }
  async ping() {
    const response = await this.sendPackage(PING_REQ, Buffer.alloc(0));
    const m = new import_HciMessageV2.default();
    m.parse(response);
    this.logStatus(m.payload[0]);
  }
  async getFwInfo() {
    const response = await this.sendPackage(FW_INFO_REQ, Buffer.alloc(0));
    const m = new import_HciMessageV2.default();
    m.parse(response);
    this.logStatus(m.payload[0]);
    const version = `${m.payload[2]}.${m.payload[1]}`;
    const buildCount = m.payload.readUint16LE(3);
    const date = m.payload.toString("utf-8", 5, 15);
    const fwName = m.payload.toString("utf-8", 15);
    this.log.debug(`Firmware v${version} --- build count ${buildCount} on ${date} --- ${fwName}`);
  }
  async setModeAndAndEnableReceiveNotification() {
    const response = await this.sendPackage(GET_ACTIVE_CONFIG_REQ, Buffer.alloc(0));
    const m = new import_HciMessageV2.default();
    m.parse(response);
    const config = m.payload.subarray(1);
    config[0] = this.getMode();
    config[1] &= 254;
    config[1] |= 2;
    await this.sendPackage(SET_ACTIVE_CONFIG_REQ, config);
    this.log.info(`Receiver set to ${this.getModeDescription()}`);
  }
  async initDevice() {
    await this.ping();
    await this.getFwInfo();
    await this.setModeAndAndEnableReceiveNotification();
  }
}
var ImstV2Receiver_default = ImstV2Receiver;
//# sourceMappingURL=ImstV2Receiver.js.map
