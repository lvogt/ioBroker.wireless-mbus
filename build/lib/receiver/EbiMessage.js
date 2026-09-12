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
var EbiMessage_exports = {};
__export(EbiMessage_exports, {
  default: () => EbiMessage_default
});
module.exports = __toCommonJS(EbiMessage_exports);
const CMD_CONFIRM_BIT = 128;
class EbiMessage {
  messageId;
  payload;
  constructor() {
    this.messageId = 0;
    this.payload = Buffer.alloc(0);
  }
  calcChecksum(data) {
    let chksum = 0;
    for (let i = 0; i < data.length - 1; i++) {
      chksum += data[i];
    }
    return chksum & 255;
  }
  calcMessageSize() {
    return 4 + this.payload.length;
  }
  setPayload(messageId, data) {
    this.messageId = messageId;
    this.payload = data === null ? Buffer.alloc(0) : data;
    return this;
  }
  setupResponse() {
    this.messageId |= CMD_CONFIRM_BIT;
    return this;
  }
  build() {
    const message = Buffer.alloc(this.calcMessageSize());
    message.writeUInt16BE(this.calcMessageSize(), 0);
    message[2] = this.messageId;
    this.payload.copy(message, 3);
    message[message.length - 1] = this.calcChecksum(message);
    return message;
  }
  parse(data) {
    this.messageId = data[2];
    this.payload = Buffer.alloc(data.readUInt16BE(0) - 4);
    data.copy(this.payload, 0, 3, data.length - 1);
    if (this.calcChecksum(data) != data[data.length - 1]) {
      return `CRC check failed: got ${data[data.length - 1]} expected ${this.calcChecksum(data)}`;
    }
    return true;
  }
  static tryToGetLength(message) {
    if (message.length < 2) {
      return -1;
    }
    return message.readUInt16BE(0);
  }
}
var EbiMessage_default = EbiMessage;
//# sourceMappingURL=EbiMessage.js.map
