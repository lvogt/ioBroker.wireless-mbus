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
var HciMessageV2_exports = {};
__export(HciMessageV2_exports, {
  default: () => HciMessageV2_default
});
module.exports = __toCommonJS(HciMessageV2_exports);
var slip = __toESM(require("./SlipEncoder"));
const CRC_SIZE = 2;
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
class HciMessageV2 {
  destinationId;
  messageId;
  payload;
  crc;
  constructor() {
    this.destinationId = 0;
    this.messageId = 0;
    this.payload = Buffer.alloc(0);
    this.crc = null;
  }
  /**
   * @param message
   * @param includeCrc
   */
  calcCrc(message, includeCrc) {
    let crc = CRC_INITIAL_VALUE;
    const end = includeCrc ? message.length : message.length - 2;
    for (let i = 0; i < end; i++) {
      crc = crc >> 8 ^ CRC_TABLE[(crc ^ message[i]) & 255];
    }
    return ~crc & 65535;
  }
  checkCrc(message) {
    return this.calcCrc(message, true) == CRC_GOOD_VALUE;
  }
  calcMessageSize() {
    return 2 + this.payload.length + CRC_SIZE;
  }
  /**
   * @param destinationId
   */
  setDestinationId(destinationId) {
    this.destinationId = destinationId;
    return this;
  }
  /**
   * @param messageId
   */
  setMessageId(messageId) {
    this.messageId = messageId;
    return this;
  }
  /**
   * @param data
   */
  setPayload(data) {
    this.payload = data === null ? Buffer.alloc(0) : data;
    return this;
  }
  setupResponse() {
    this.messageId++;
    this.payload = Buffer.alloc(0);
    return this;
  }
  build() {
    const message = Buffer.alloc(this.calcMessageSize());
    let messagePos = 0;
    message[messagePos++] = this.destinationId;
    message[messagePos++] = this.messageId;
    this.payload.copy(message, messagePos);
    messagePos += this.payload.length;
    message.writeUInt16LE(this.calcCrc(message, false), messagePos);
    messagePos += CRC_SIZE;
    return slip.encode(message);
  }
  /**
   * @param data
   */
  parse(data) {
    const message = slip.decode(data);
    let messagePos = 0;
    this.destinationId = message[messagePos++];
    this.messageId = message[messagePos++];
    const payloadLength = message.length - 2 - CRC_SIZE;
    this.payload = message.subarray(2, 2 + payloadLength);
    messagePos += payloadLength;
    this.crc = message.readUInt16LE(messagePos);
    if (!this.checkCrc(message)) {
      return `CRC check failed: got ${this.crc} expected ${this.calcCrc(message, false)}`;
    }
    return true;
  }
}
var HciMessageV2_default = HciMessageV2;
//# sourceMappingURL=HciMessageV2.js.map
