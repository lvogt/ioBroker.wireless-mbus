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
var SlipEncoder_exports = {};
__export(SlipEncoder_exports, {
  END: () => END,
  decode: () => slipDecode,
  encode: () => slipEncode
});
module.exports = __toCommonJS(SlipEncoder_exports);
const END = 192;
const ESC = 219;
const ESC_END = 220;
const ESC_ESC = 221;
function slipEncode(message) {
  const escapeCount = message.filter((b) => b === END || b === ESC).length;
  const encodedMessage = Buffer.alloc(message.length + escapeCount + 2, END);
  let j = 1;
  for (let i = 0; i < message.length; i++) {
    const b = message[i];
    if (b !== END) {
      encodedMessage[j++] = b;
      if (b === ESC) {
        encodedMessage[j++] = ESC_ESC;
      }
    } else {
      encodedMessage[j++] = ESC;
      encodedMessage[j++] = ESC_END;
    }
  }
  return encodedMessage;
}
function slipDecode(message) {
  const escapeCount = message.filter((b) => b === ESC).length;
  const decodedMessage = Buffer.alloc(message.length - escapeCount - 2);
  if (message[0] !== END) {
    throw new Error("Start END marker is missing!");
  }
  if (message[message.length - 1] !== END) {
    throw new Error("Stop END marker is missing!");
  }
  let escape = false;
  let j = 0;
  for (let i = 1; i < message.length - 1; i++) {
    const b = message[i];
    if (escape) {
      if (b === ESC_END) {
        decodedMessage[j++] = END;
      } else if (b === ESC_ESC) {
        decodedMessage[j++] = ESC;
      } else {
        throw new Error(`Found 0x${b.toString(16)} after ESC!`);
      }
      escape = false;
    } else {
      if (b === ESC) {
        escape = true;
      } else {
        decodedMessage[j++] = b;
      }
    }
  }
  return decodedMessage;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  END,
  decode,
  encode
});
//# sourceMappingURL=SlipEncoder.js.map
