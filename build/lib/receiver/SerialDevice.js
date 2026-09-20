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
var SerialDevice_exports = {};
__export(SerialDevice_exports, {
  default: () => SerialDevice_default
});
module.exports = __toCommonJS(SerialDevice_exports);
var import_serialport = require("serialport");
var import_node_net = __toESM(require("node:net"));
var import_SimpleLogger = __toESM(require("../SimpleLogger"));
class SerialDevice {
  log;
  SerialPortImpl;
  timers;
  options;
  port;
  mode;
  closeRequested;
  parserBuffer;
  maxParserBufferLength;
  readTimeout;
  readPromises;
  staleDataTimeout;
  onMessage;
  onError;
  constructor(options, mode, onMessage, onError, loggerFunction) {
    this.log = new import_SimpleLogger.default(loggerFunction);
    if (typeof onMessage !== "function") {
      throw new Error('onMessage must be of type "function(data)"');
    }
    const { serialPortImpl, timers, ...portOptions } = options != null ? options : {};
    this.SerialPortImpl = serialPortImpl || import_serialport.SerialPort;
    this.timers = {
      setTimeout: typeof (timers == null ? void 0 : timers.setTimeout) === "function" ? timers.setTimeout : globalThis.setTimeout,
      clearTimeout: typeof (timers == null ? void 0 : timers.clearTimeout) === "function" ? timers.clearTimeout : (handle) => globalThis.clearTimeout(handle)
    };
    this.options = portOptions;
    this.port = null;
    this.mode = mode;
    this.closeRequested = false;
    this.parserBuffer = Buffer.alloc(0);
    this.maxParserBufferLength = 1024;
    this.readTimeout = 3e3;
    this.readPromises = [];
    this.staleDataTimeout = 0;
    this.onMessage = onMessage;
    this.onError = onError;
  }
  buildPayloadPackage(_command, _payload) {
    throw new Error("buildPayloadPackage is unimplemented!");
  }
  validateResponse(_pkg, _response) {
  }
  checkAndExtractMessage() {
    throw new Error("checkAndExtractMessage is unimplemented!");
  }
  parseRawMessage(_messageBuffer) {
    throw new Error("parseRawMessage is unimplemented!");
  }
  /**
   * Take the next message out of the parser buffer, for the protocols that
   * announce the length of a message in its header.
   *
   * A message is only accepted where it is complete and intact, so that the
   * receiver finds its way back into the stream after a byte was lost or
   * added. Without that, every message after such a glitch is cut at the
   * wrong place and the garbage is handed out as the answer to a command or
   * emitted as a telegram of a device that does not exist.
   *
   * A candidate that announces more than has arrived is kept, because it may
   * be a message that is still being received. It loses that benefit of the
   * doubt as soon as a valid message follows it: bytes arrive in order, so
   * something complete behind it proves that it never was the start of one.
   *
   * @param startByte the byte every message starts with, or
   * null if the protocol has no such marker and every position in the buffer
   * is a candidate
   * @param getLength the length of the
   * message the candidate starts with: -1 while its header is incomplete, 0
   * if the candidate cannot be the start of a message at all
   * @param isIntact whether a complete
   * message is intact - it must not accept a slice that only looks the part
   * @returns the next message, or null if the buffer holds none
   */
  extractMessageByLength(startByte, getLength, isIntact) {
    const findStart = (from) => {
      if (startByte === null) {
        return from < this.parserBuffer.length ? from : -1;
      }
      return this.parserBuffer.indexOf(startByte, from);
    };
    let incompleteStart = -1;
    for (let start = findStart(0); start !== -1; start = findStart(start + 1)) {
      const candidate = this.parserBuffer.subarray(start);
      const expectedLength = getLength(candidate);
      if (expectedLength === 0) {
        continue;
      }
      if (expectedLength === -1 || candidate.length < expectedLength) {
        if (incompleteStart === -1) {
          incompleteStart = start;
        }
        continue;
      }
      const messageBuffer = candidate.subarray(0, expectedLength);
      if (isIntact(messageBuffer)) {
        this.parserBuffer = candidate.subarray(expectedLength);
        return messageBuffer;
      }
    }
    const keepFrom = incompleteStart === -1 ? this.parserBuffer.length : incompleteStart;
    if (keepFrom) {
      this.log.debug(`Discarding ${keepFrom} byte(s) that start no message`);
      this.parserBuffer = this.parserBuffer.subarray(keepFrom);
    }
    return null;
  }
  initDevice() {
    throw new Error("initDevice is unimplemented!");
  }
  /**
   * Wait for the given number of milliseconds.
   *
   * The returned promise never settles if the adapter is unloaded while it is
   * pending, because the timer is then cleared without firing. That is
   * intended: whatever waited for it stops right there instead of continuing
   * to talk to a device that is being shut down.
   *
   * @returns a promise that resolves when the time has passed
   */
  delay(ms) {
    return new Promise((resolve) => this.timers.setTimeout(() => resolve(), ms));
  }
  /**
   * Wait for the answer to a command.
   *
   * @param [isExpectedResponse] which
   * message answers the command. A message it turns down stays unclaimed and
   * is dropped, and the command keeps waiting for the next one. The default
   * takes whatever arrives first, which is all a protocol that answers every
   * command with exactly one message needs. A receiver whose device also
   * sends lines of its own accord has to tell them apart - otherwise a line
   * that crossed the command is handed out as its answer and fails it.
   * @returns the answer to the command
   */
  async readResponse(isExpectedResponse) {
    let reader;
    const waitForReadPromise = new Promise((resolve) => {
      reader = {
        accepts: typeof isExpectedResponse === "function" ? isExpectedResponse : () => true,
        deliver: (data) => resolve(data)
      };
      this.readPromises.push(reader);
    });
    let timeoutHandle;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeoutHandle = this.timers.setTimeout(() => {
        const index = this.readPromises.indexOf(reader);
        if (index !== -1) {
          this.readPromises.splice(index, 1);
        }
        reject(new Error("Timeout waiting for response"));
      }, this.readTimeout);
    });
    try {
      return await Promise.race([waitForReadPromise, timeoutPromise]);
    } finally {
      this.timers.clearTimeout(timeoutHandle);
    }
  }
  /**
   * Send a command and wait for its answer.
   *
   * @param command the command, in the form the receiver builds its packages from
   * @param [payload] what to send with it
   * @param [isExpectedResponse] see readResponse()
   * @returns the answer to the command
   */
  async sendPackage(command, payload, isExpectedResponse) {
    const pkg = this.buildPayloadPackage(command, payload);
    this.log.debug(`TX: ${Buffer.isBuffer(pkg) ? pkg.toString("hex") : pkg}`);
    const port = this.port;
    if (port == null) {
      throw new Error("The serial connection has not been created yet or creation was unsuccessful!");
    }
    await new Promise((resolve, reject) => {
      port.write(
        pkg,
        (error) => error ? reject(new Error("Error writing to serial connection")) : resolve(true)
      );
    });
    const response = await this.readResponse(isExpectedResponse);
    this.validateResponse(pkg, response);
    return response;
  }
  concatAndTrimParserBuffer(data) {
    this.parserBuffer = Buffer.concat([this.parserBuffer, data]);
    if (this.parserBuffer.length > this.maxParserBufferLength) {
      this.log.debug("Buffer too large - cutting to max length!");
      this.parserBuffer = this.parserBuffer.subarray(-1 * this.maxParserBufferLength);
    }
  }
  onData(data) {
    this.log.debug(`RX: ${data.toString("hex")}`);
    this.concatAndTrimParserBuffer(data);
    try {
      this.dispatchMessages();
    } catch (error) {
      this.log.error(`Error while processing received data: ${error}`);
      this.parserBuffer = Buffer.alloc(0);
    }
  }
  dispatchMessages() {
    var _a;
    let messageBuffer = this.checkAndExtractMessage();
    while (messageBuffer !== null) {
      if (this.isTelegramMessage(messageBuffer)) {
        this.emitMessage(messageBuffer);
      } else if (this.readPromises.length && this.readPromises[0].accepts(messageBuffer)) {
        (_a = this.readPromises.shift()) == null ? void 0 : _a.deliver(messageBuffer);
      } else {
        const hex = Buffer.isBuffer(messageBuffer) ? messageBuffer.toString("hex") : messageBuffer;
        this.log.debug(
          this.readPromises.length ? `This message answers no pending command - dropped: ${hex}` : `Nothing is waiting for this message - dropped: ${hex}`
        );
      }
      messageBuffer = this.checkAndExtractMessage();
    }
  }
  /**
   * Whether a message is a telegram rather than the answer to a command.
   *
   * The default is the best a protocol that does not mark the difference can
   * do: whatever arrives while a command is waiting for its answer is that
   * answer, and everything else is a telegram. Receivers whose messages say
   * what they are override it - only then can a message that nobody expects
   * be recognised as one and dropped.
   */
  isTelegramMessage(_messageBuffer) {
    return this.readPromises.length === 0;
  }
  emitMessage(messageBuffer) {
    this.log.debug(`Message received: ${messageBuffer.toString("hex")}`);
    const messageObject = this.parseRawMessage(messageBuffer);
    this.onMessage(messageObject);
  }
  initDeviceConnection() {
    if (!this.options.isTcp) {
      this.port = new this.SerialPortImpl(this.options);
      this.port.on("data", this.onData.bind(this));
      this.port.on("error", this.onError);
    } else {
      this.closeRequested = false;
      this.port = new import_node_net.default.Socket();
      this.port.setKeepAlive(true, 0);
      this.port.connect(Number(this.options.port), String(this.options.host));
      this.port.on("data", this.onData.bind(this));
      this.port.on("close", this.handleTcpClose.bind(this));
      this.port.on("error", this.onError);
    }
  }
  handleTcpClose(hadError) {
    if (hadError) {
      this.log.debug("TCP socket was closed after a transmission error");
    }
    if (this.closeRequested) {
      return;
    }
    this.log.debug("TCP socket was closed");
    this.onError(new Error("TCP connection closed"));
  }
  async closeConnection() {
    this.closeRequested = true;
    const port = this.port;
    this.port = null;
    if (!port) {
      return;
    }
    await new Promise((resolve) => {
      if (port instanceof this.SerialPortImpl) {
        port.close(() => resolve(true));
      } else {
        port.end(() => resolve(true));
      }
    });
  }
  /**
   * A receiver that is still in receive mode keeps sending telegrams, so the
   * first bytes read after opening the port are usually the tail of a frame.
   * After an adapter restart that is the normal case rather than the
   * exception, so wait for them and drop them instead of letting the first
   * command deal with the fragment.
   */
  async discardStaleData() {
    if (!this.staleDataTimeout) {
      return;
    }
    await this.delay(this.staleDataTimeout);
    if (this.parserBuffer.length) {
      this.log.debug(`Discarding stale data: ${this.parserBuffer.toString("hex")}`);
      this.parserBuffer = Buffer.alloc(0);
    }
  }
  async init() {
    this.initDeviceConnection();
    try {
      await this.discardStaleData();
      await this.initDevice();
    } catch (error) {
      this.log.debug(`Failed to init device: ${error}`);
      await this.closeConnection();
      throw error;
    }
  }
}
var SerialDevice_default = SerialDevice;
//# sourceMappingURL=SerialDevice.js.map
