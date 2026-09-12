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
var TcpReceiver_exports = {};
__export(TcpReceiver_exports, {
  default: () => TcpReceiver_default
});
module.exports = __toCommonJS(TcpReceiver_exports);
var import_SimpleLogger = __toESM(require("../SimpleLogger"));
var import_node_net = __toESM(require("node:net"));
class TcpReceiver {
  log;
  options;
  mode;
  onMessage;
  onError;
  /** a stand-in for the serial port, so the adapter can treat every receiver alike */
  port;
  parserBuffer;
  server;
  constructor(options, mode, onMessage, onError, loggerFunction) {
    this.log = new import_SimpleLogger.default(loggerFunction);
    this.log.prefix = "TCP";
    if (typeof onMessage !== "function") {
      throw new Error('onMessage must be of type "function(data)"');
    }
    this.options = options;
    this.mode = mode;
    this.onMessage = onMessage;
    this.onError = onError;
    this.port = { on: () => {
    }, close: () => {
    } };
    this.parserBuffer = Buffer.alloc(0);
    this.server = import_node_net.default.createServer();
    this.server.on("connection", (socket) => {
      socket.on("data", this.onData.bind(this));
    });
  }
  onData(data) {
    const jsonString = data.toString("utf-8");
    this.log.debug(`Message received: ${jsonString}`);
    let message;
    try {
      const json = JSON.parse(jsonString);
      message = {
        frameType: json.frameType,
        containsCrc: json.containsCrc,
        rawData: Buffer.from(json.data, "hex"),
        rssi: -1,
        ts: (/* @__PURE__ */ new Date()).getTime()
      };
    } catch (error) {
      this.log.warn(`Cannot read the telegram: ${error}`);
      return;
    }
    this.onMessage(message);
  }
  async init() {
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(Number(this.options.path), "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        this.server.on("error", (error) => this.onError(error));
        resolve(true);
      });
    });
    this.log.info(`Listening on local port ${this.options.path}`);
    this.port = {
      on: () => {
      },
      close: () => {
        this.server.close();
      }
    };
  }
  async closeConnection() {
    await new Promise((resolve) => this.server.close(() => resolve(true)));
  }
}
var TcpReceiver_default = TcpReceiver;
//# sourceMappingURL=TcpReceiver.js.map
