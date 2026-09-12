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
var receiver_exports = {};
__export(receiver_exports, {
  getReceiver: () => getReceiver,
  listReceivers: () => listReceivers
});
module.exports = __toCommonJS(receiver_exports);
var import_AmberReceiver = __toESM(require("./AmberReceiver"));
var import_CulReceiver = __toESM(require("./CulReceiver"));
var import_EbiReceiver = __toESM(require("./EbiReceiver"));
var import_ImstReceiver = __toESM(require("./ImstReceiver"));
var import_ImstV2Receiver = __toESM(require("./ImstV2Receiver"));
var import_SimpleReceiver = __toESM(require("./SimpleReceiver"));
var import_TcpReceiver = __toESM(require("./TcpReceiver"));
const receivers = {
  ebi: {
    name: "Embit EMB-WMB169/868",
    js: "EbiReceiver.js",
    modes: { C: "C Mode", S: "S Mode", T: "T Mode" },
    ReceiverClass: import_EbiReceiver.default
  },
  amber: {
    name: "Amber Wireless AMB8465",
    js: "AmberReceiver.js",
    modes: { C: "C Mode", S: "S Mode", T: "T Mode", CT: "C/T Mode" },
    ReceiverClass: import_AmberReceiver.default
  },
  imst: {
    name: "IMST iM871A",
    js: "ImstReceiver.js",
    modes: {
      CA: "C Mode (frame type A)",
      CB: "C Mode (frame type B)",
      S: "S Mode",
      T: "T Mode"
    },
    ReceiverClass: import_ImstReceiver.default
  },
  imstv2: {
    name: "IMST iU891A-XL",
    js: "ImstV2Receiver.js",
    modes: {
      S: "S Mode",
      T: "T Mode",
      "C/T": "combined C/T-Mode",
      C: "C-Mode (100 kbps)",
      Tx: "Enhanced T Mode"
    },
    ReceiverClass: import_ImstV2Receiver.default
  },
  cul: {
    name: "CUL",
    js: "CulReceiver.js",
    modes: { S: "S Mode", T: "T Mode", C: "C/T Mode" },
    ReceiverClass: import_CulReceiver.default
  },
  simple: {
    name: "Simple Hexstring",
    js: "SimpleReceiver.js",
    modes: { A: "Frame type A", B: "Frame type B" },
    ReceiverClass: import_SimpleReceiver.default
  }
};
const internalReceivers = {
  tcp: {
    name: "TCP (testing only)",
    js: "TcpReceiver.js",
    modes: {},
    ReceiverClass: import_TcpReceiver.default
  }
};
const allReceivers = { ...receivers, ...internalReceivers };
function listReceivers() {
  const list = {};
  for (const [key, { name, js, modes }] of Object.entries(receivers)) {
    list[key] = { name, js, modes };
  }
  return list;
}
function getReceiver(type) {
  if (typeof type !== "string" || !type) {
    return void 0;
  }
  if (Object.prototype.hasOwnProperty.call(allReceivers, type)) {
    return allReceivers[type];
  }
  return Object.values(allReceivers).find((receiver) => receiver.js === type);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getReceiver,
  listReceivers
});
//# sourceMappingURL=index.js.map
