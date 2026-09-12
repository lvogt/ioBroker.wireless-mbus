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
var HciMessage_exports = {};
__export(HciMessage_exports, {
  default: () => HciMessage_default
});
module.exports = __toCommonJS(HciMessage_exports);
const SOF = 165;
const CRC_FLAG = 128;
const RSSI_FLAG = 64;
const TIMESTAMP_FLAG = 32;
const HEADER_SIZE = 4;
const RSSI_SIZE = 1;
const CRC_SIZE = 2;
const TIMESTAMP_SIZE = 4;
const HIGH_MASK = 240;
const LOW_MASK = 15;
const CRC_INITIAL_VALUE = 65535;
const CRC_GOOD_VALUE = 3911;
const CRC_TABLE = [
  0,
  4489,
  8978,
  12955,
  17956,
  22445,
  25910,
  29887,
  35912,
  40385,
  44890,
  48851,
  51820,
  56293,
  59774,
  63735,
  4225,
  264,
  13203,
  8730,
  22181,
  18220,
  30135,
  25662,
  40137,
  36160,
  49115,
  44626,
  56045,
  52068,
  63999,
  59510,
  8450,
  12427,
  528,
  5017,
  26406,
  30383,
  17460,
  21949,
  44362,
  48323,
  36440,
  40913,
  60270,
  64231,
  51324,
  55797,
  12675,
  8202,
  4753,
  792,
  30631,
  26158,
  21685,
  17724,
  48587,
  44098,
  40665,
  36688,
  64495,
  60006,
  55549,
  51572,
  16900,
  21389,
  24854,
  28831,
  1056,
  5545,
  10034,
  14011,
  52812,
  57285,
  60766,
  64727,
  34920,
  39393,
  43898,
  47859,
  21125,
  17164,
  29079,
  24606,
  5281,
  1320,
  14259,
  9786,
  57037,
  53060,
  64991,
  60502,
  39145,
  35168,
  48123,
  43634,
  25350,
  29327,
  16404,
  20893,
  9506,
  13483,
  1584,
  6073,
  61262,
  65223,
  52316,
  56789,
  43370,
  47331,
  35448,
  39921,
  29575,
  25102,
  20629,
  16668,
  13731,
  9258,
  5809,
  1848,
  65487,
  60998,
  56541,
  52564,
  47595,
  43106,
  39673,
  35696,
  33800,
  38273,
  42778,
  46739,
  49708,
  54181,
  57662,
  61623,
  2112,
  6601,
  11090,
  15067,
  20068,
  24557,
  28022,
  31999,
  38025,
  34048,
  47003,
  42514,
  53933,
  49956,
  61887,
  57398,
  6337,
  2376,
  15315,
  10842,
  24293,
  20332,
  32247,
  27774,
  42250,
  46211,
  34328,
  38801,
  58158,
  62119,
  49212,
  53685,
  10562,
  14539,
  2640,
  7129,
  28518,
  32495,
  19572,
  24061,
  46475,
  41986,
  38553,
  34576,
  62383,
  57894,
  53437,
  49460,
  14787,
  10314,
  6865,
  2904,
  32743,
  28270,
  23797,
  19836,
  50700,
  55173,
  58654,
  62615,
  32808,
  37281,
  41786,
  45747,
  19012,
  23501,
  26966,
  30943,
  3168,
  7657,
  12146,
  16123,
  54925,
  50948,
  62879,
  58390,
  37033,
  33056,
  46011,
  41522,
  23237,
  19276,
  31191,
  26718,
  7393,
  3432,
  16371,
  11898,
  59150,
  63111,
  50204,
  54677,
  41258,
  45219,
  33336,
  37809,
  27462,
  31439,
  18516,
  23005,
  11618,
  15595,
  3696,
  8185,
  63375,
  58886,
  54429,
  50452,
  45483,
  40994,
  37561,
  33584,
  31687,
  27214,
  22741,
  18780,
  15843,
  11370,
  7921,
  3960
];
class HciMessage {
  messageId;
  endpointId;
  hasTimestamp;
  hasRssi;
  hasCrc;
  crc;
  rawRssi;
  rssi;
  timestamp;
  payload;
  static START_BYTE = SOF;
  constructor() {
    this.messageId = 0;
    this.endpointId = 0;
    this.hasTimestamp = false;
    this.hasRssi = false;
    this.hasCrc = false;
    this.crc = null;
    this.rawRssi = null;
    this.rssi = null;
    this.timestamp = null;
    this.payload = Buffer.alloc(0);
  }
  calcCrc(message, includeCrc) {
    let crc = CRC_INITIAL_VALUE;
    const end = includeCrc ? message.length : message.length - 2;
    for (let i = 1; i < end; i++) {
      crc = crc >> 8 ^ CRC_TABLE[(crc ^ message[i]) & 255];
    }
    return ~crc & 65535;
  }
  checkCrc(message) {
    return this.calcCrc(message, true) == CRC_GOOD_VALUE;
  }
  calcMessageSize() {
    return 4 + this.payload.length + (this.hasTimestamp ? TIMESTAMP_SIZE : 0) + (this.hasRssi ? RSSI_SIZE : 0) + (this.hasCrc ? CRC_SIZE : 0);
  }
  setPayload(endpointId, messageId, data) {
    this.endpointId = endpointId;
    this.messageId = messageId;
    this.payload = data === null ? Buffer.alloc(0) : data;
    return this;
  }
  setRssi(rssi) {
    if (rssi === null) {
      this.hasRssi = false;
      this.rssi = null;
    } else {
      this.hasRssi = true;
      this.rssi = rssi;
    }
    return this;
  }
  setTimestamp(timestamp) {
    if (timestamp == null) {
      this.hasTimestamp = false;
      this.timestamp = null;
    } else {
      this.hasTimestamp = true;
      this.timestamp = timestamp;
    }
    return this;
  }
  setCrc(update) {
    if (update === true) {
      this.hasCrc = true;
    } else {
      this.hasCrc = false;
    }
    return this;
  }
  setupResponse() {
    this.setTimestamp(null);
    this.setRssi(null);
    this.setCrc(true);
    this.messageId++;
    this.payload = Buffer.alloc(0);
    return this;
  }
  buildHeader() {
    const header = Buffer.alloc(HEADER_SIZE);
    const controlField = (this.hasCrc ? CRC_FLAG : 0) | (this.hasRssi ? RSSI_FLAG : 0) | (this.hasTimestamp ? TIMESTAMP_FLAG : 0) | this.endpointId;
    header[0] = SOF;
    header[1] = controlField;
    header[2] = this.messageId;
    header[3] = this.payload.length;
    return header;
  }
  build() {
    var _a, _b;
    const message = Buffer.alloc(this.calcMessageSize());
    let messagePos = 0;
    const header = this.buildHeader();
    header.copy(message, 0);
    messagePos += HEADER_SIZE;
    this.payload.copy(message, messagePos);
    messagePos += this.payload.length;
    if (this.hasTimestamp) {
      message.writeUInt32LE((_a = this.timestamp) != null ? _a : 0, messagePos);
      messagePos += TIMESTAMP_SIZE;
    }
    if (this.hasRssi) {
      const rawRssi = (((_b = this.rssi) != null ? _b : 0) + 380 / 3) * 15 / 8 & 255;
      message[messagePos] = rawRssi;
      messagePos += RSSI_SIZE;
    }
    if (this.hasCrc) {
      message.writeUInt16LE(this.calcCrc(message, false), messagePos);
      messagePos += CRC_SIZE;
    }
    return message;
  }
  parse(data) {
    if (data[0] != SOF) {
      throw new Error(`SOF byte is incorrect! Was ${data[0]} expected ${SOF}`);
    }
    const controlField = data[1] & HIGH_MASK;
    this.hasCrc = controlField & CRC_FLAG ? true : false;
    this.hasRssi = controlField & RSSI_FLAG ? true : false;
    this.hasTimestamp = controlField & TIMESTAMP_FLAG ? true : false;
    this.endpointId = data[1] & LOW_MASK;
    this.messageId = data[2];
    const payloadLength = data[3];
    let messagePos = HEADER_SIZE;
    this.payload = data.subarray(HEADER_SIZE, payloadLength + HEADER_SIZE);
    messagePos += payloadLength;
    if (this.hasTimestamp) {
      this.timestamp = data.readUInt32LE(messagePos);
      messagePos += TIMESTAMP_SIZE;
    } else {
      this.timestamp = null;
    }
    if (this.hasRssi) {
      const rawRssi = data[messagePos++];
      this.rssi = 8 / 15 * rawRssi - 380 / 3;
    } else {
      this.rawRssi = null;
      this.rssi = null;
    }
    if (this.hasCrc) {
      this.crc = data.readUInt16LE(messagePos);
      messagePos += CRC_SIZE;
      if (!this.checkCrc(data)) {
        return `CRC check failed: got ${this.crc} expected ${this.calcCrc(data, false)}`;
      }
    } else {
      this.crc = null;
    }
    return true;
  }
  static tryToGetLength(message) {
    if (message.length < 4) {
      return -1;
    }
    const controlField = message[1] & HIGH_MASK;
    return message[3] + 4 + (controlField & TIMESTAMP_FLAG ? TIMESTAMP_SIZE : 0) + (controlField & RSSI_FLAG ? RSSI_SIZE : 0) + (controlField & CRC_FLAG ? CRC_SIZE : 0);
  }
}
var HciMessage_default = HciMessage;
//# sourceMappingURL=HciMessage.js.map
