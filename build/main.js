"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_wireless_mbus_parser = require("wireless-mbus-parser");
var import_receiver = require("./lib/receiver");
var import_ObjectHelper = __toESM(require("./lib/ObjectHelper"));
var import_DeviceRegistry = __toESM(require("./lib/DeviceRegistry"));
var import_AesKeys = __toESM(require("./lib/AesKeys"));
var import_BlockList = __toESM(require("./lib/BlockList"));
var import_AdminMessages = __toESM(require("./lib/AdminMessages"));
var import_ManufacturerSpecific = require("./lib/ManufacturerSpecific");
process.setSourceMapsEnabled(true);
const EXPECTED_PARSER_ERRORS = ["DATA_RECORD_CACHE_MISSING"];
const INITIAL_RECONNECT_DELAY = 5e3;
const MAX_RECONNECT_DELAY = 3e5;
class WirelessMbus extends utils.Adapter {
  objectHelper;
  adminMessages;
  /**
   * Whether the receiver is connected - not to be confused with the
   * "connected" of the adapter class, which says whether the adapter reaches
   * the databases. js-controller stops an adapter that cannot reach them,
   * and decides that by a flag of that name.
   *
   * Undefined until the first answer, so that onReady() reports a receiver
   * that is not connected yet rather than leaving the state of the run
   * before - which said "connected" whenever that run ended while it was.
   */
  receiverConnected;
  receiver;
  reconnectTimeout;
  reconnectDelay;
  reconnectAttempts;
  parser;
  aesKeys;
  blockList;
  createdDevices;
  deviceRegistry;
  manufacturerSpecificHandlers;
  stateValues;
  constructor(options = {}) {
    super({
      ...options,
      name: "wireless-mbus"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.objectHelper = new import_ObjectHelper.default(this);
    this.receiverConnected = void 0;
    this.receiver = null;
    this.reconnectTimeout = null;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.reconnectAttempts = 0;
    this.parser = new import_wireless_mbus_parser.WirelessMbusParser();
    this.aesKeys = new import_AesKeys.default([], this.log);
    this.blockList = new import_BlockList.default([], {}, this.log);
    this.adminMessages = new import_AdminMessages.default(this, this.aesKeys);
    this.createdDevices = /* @__PURE__ */ new Set();
    this.deviceRegistry = new import_DeviceRegistry.default();
    this.manufacturerSpecificHandlers = {};
    this.stateValues = {};
  }
  async closeReceiver() {
    const receiver = this.receiver;
    this.receiver = null;
    try {
      if (receiver) {
        await receiver.closeConnection();
      }
    } catch (error) {
      this.log.warn(`Error while closing the receiver connection: ${error}`);
    }
  }
  async onUnload(callback) {
    if (this.reconnectTimeout) {
      this.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    await this.closeReceiver();
    callback && callback();
  }
  async onReady() {
    await this.objectHelper.createObject("info.connection", {
      type: "state",
      common: {
        role: "indicator.connected",
        name: "If connected to wM-Bus receiver",
        type: "boolean",
        read: true,
        write: false,
        def: false
      },
      native: {}
    });
    await this.objectHelper.createObject("info.rawdata", {
      type: "state",
      common: {
        // "value" is for numbers - this one holds a telegram as hex
        role: "text",
        name: "Telegram raw data if parser failed",
        type: "string",
        read: true,
        write: false,
        def: ""
      },
      native: {}
    });
    this.aesKeys = new import_AesKeys.default(this.config.aeskeys, this.log);
    this.blockList = new import_BlockList.default(this.config.blacklist, { auto: this.config.autoBlocklist }, this.log);
    this.adminMessages = new import_AdminMessages.default(this, this.aesKeys);
    this.loadManufacturerSpecificDescriptions();
    await this.loadKnownDevices();
    await this.setConnected(false);
    await this.connectReceiver();
  }
  /**
   * Take over the descriptions of manufacturer specific data records.
   *
   * A description the parser rejects is reported and left out rather than
   * taken along: it is configuration somebody typed, and the meters of the
   * other descriptions have nothing to do with it. This has to happen before
   * the parser is created.
   */
  loadManufacturerSpecificDescriptions() {
    const { handlers, reports, error } = (0, import_ManufacturerSpecific.buildHandlers)(this.config.manufacturerSpecific);
    if (error) {
      this.log.warn(`The manufacturer specific descriptions are ignored: they are ${error}`);
    }
    for (const report of reports.filter((entry) => entry.error)) {
      this.log.warn(`The description of ${report.manufacturer} is ignored: it ${report.message}`);
    }
    const manufacturers = Object.keys(handlers);
    if (manufacturers.length) {
      this.log.info(`Describing the manufacturer specific data of ${manufacturers.join(", ")}`);
    }
    this.manufacturerSpecificHandlers = handlers;
  }
  /**
   * Take over the devices that already have an object tree.
   *
   * They are what "ignoreUnknownDevices" decides by, and their objects are
   * the only place where the record layouts of their telegrams survive a
   * restart - so this has to happen before the receiver is opened.
   */
  async loadKnownDevices() {
    let devices = [];
    try {
      devices = await this.getDevicesAsync();
    } catch (error) {
      this.log.warn(`Could not read the devices that already exist: ${error}`);
    }
    for (const device of devices) {
      this.deviceRegistry.add(device._id.substring(this.namespace.length + 1), device.native);
    }
    this.log.debug(`Found ${devices.length} device(s) with an object tree`);
    this.parser = this.createParser();
  }
  /**
   * A parser that knows the record layouts of all known devices, so that a
   * compact telegram is decoded right away rather than after the next full
   * telegram of the same meter.
   */
  createParser() {
    const cachedDataRecordHeaders = this.deviceRegistry.layouts();
    try {
      return new import_wireless_mbus_parser.WirelessMbusParser({
        cachedDataRecordHeaders,
        manufacturerSpecificHandlers: this.manufacturerSpecificHandlers
      });
    } catch (error) {
      this.log.warn(`Stored data record headers were rejected by the parser: ${error}`);
      return new import_wireless_mbus_parser.WirelessMbusParser();
    }
  }
  /**
   * Create the configured receiver and initialise the device.
   *
   * Initialisation can fail for a reason that is gone again a few seconds
   * later: a telegram that is in flight while the port is opened costs the
   * first command its response, which is the normal outcome of restarting
   * the adapter while the receiver is still in receive mode. Such a failure
   * used to leave the instance idle until someone restarted it by hand, so
   * keep trying with a growing delay instead.
   */
  async connectReceiver() {
    var _a;
    const port = typeof this.config.serialPort !== "undefined" ? this.config.serialPort : "/dev/ttyWMBUS";
    const baud = typeof this.config.serialBaudRate !== "undefined" ? parseInt(String(this.config.serialBaudRate)) : 9600;
    const options = this.createOptions(port, baud);
    const receiverInfo = (0, import_receiver.getReceiver)(this.config.deviceType);
    if (!receiverInfo) {
      this.log.error(`No or unknown adapter type selected! ${this.config.deviceType}`);
      return;
    }
    const mode = this.resolveMode(receiverInfo, this.config.wmbusMode);
    try {
      this.receiver = new receiverInfo.ReceiverClass(
        {
          ...options,
          // Timers created through the adapter are cleared by
          // js-controller when the adapter is unloaded.
          timers: {
            setTimeout: this.setTimeout.bind(this),
            clearTimeout: this.clearTimeout.bind(this)
          }
        },
        mode,
        this.dataReceived.bind(this),
        this.serialError.bind(this),
        {
          debug: this.log.debug,
          info: this.log.info,
          warn: this.log.warn,
          error: this.log.error
        }
      );
      this.log.debug(`Created device of type: ${receiverInfo.name}`);
      await ((_a = this.receiver) == null ? void 0 : _a.init());
      await this.setConnected(true);
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.reconnectAttempts = 0;
    } catch (error) {
      this.logConnectionFailure(`Error opening serial port ${port} with baudrate ${baud}: ${error}`);
      await this.setConnected(false);
      await this.closeReceiver();
      this.scheduleReconnect();
    }
  }
  /**
   * The first failure of an outage is worth an error, the attempts after it
   * are not: a receiver that stays unreachable would otherwise fill the log
   * with the same line for as long as it is away.
   */
  logConnectionFailure(message) {
    if (this.reconnectAttempts) {
      this.log.debug(message);
    } else {
      this.log.error(message);
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimeout) {
      return;
    }
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
    const message = `Trying to connect to the receiver again in ${Math.round(delay / 1e3)} seconds`;
    if (this.reconnectAttempts) {
      this.log.debug(message);
    } else {
      this.log.info(message);
    }
    this.reconnectAttempts++;
    this.reconnectTimeout = this.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectReceiver().catch((error) => this.log.error(`Failed to connect to the receiver: ${error}`));
    }, delay);
  }
  /**
   * A configured mode can belong to a different receiver - the admin UI
   * resets it when the receiver changes, but a configuration written before
   * that, or edited outside the UI, can still carry a stale value. Falling
   * back to the receiver's first mode beats initialising the hardware with
   * one it does not know.
   */
  resolveMode(receiverInfo, configuredMode) {
    const modes = Object.keys(receiverInfo.modes);
    if (modes.includes(configuredMode)) {
      return configuredMode;
    }
    if (!modes.length) {
      return configuredMode;
    }
    this.log.warn(
      `Mode "${configuredMode}" is not supported by ${receiverInfo.name} - falling back to "${modes[0]}"`
    );
    return modes[0];
  }
  createOptions(port, baud) {
    const matches = String(port).match(/tcp:\/\/([^:]+):(\d+)/);
    if (matches) {
      return { isTcp: true, host: matches[1], port: parseInt(matches[2]) };
    }
    return { path: port, baudRate: baud };
  }
  async serialError(err) {
    this.logConnectionFailure(`Serialport error: ${err.message}`);
    if (!this.receiver) {
      return;
    }
    await this.setConnected(false);
    await this.closeReceiver();
    this.scheduleReconnect();
  }
  async setConnected(isConnected) {
    if (this.receiverConnected === isConnected) {
      return;
    }
    this.receiverConnected = isConnected;
    try {
      await this.setStateAsync("info.connection", this.receiverConnected, true);
      this.log.debug(`connected set to ${this.receiverConnected}`);
    } catch (error) {
      this.log.error(`Can not update connected state: ${error}`);
    }
  }
  /**
   * The callback the receivers report a telegram to. Nobody waits for it, so
   * an exception in here would be an unhandled rejection - and adapter-core
   * terminates the adapter over one of those.
   */
  async dataReceived(data) {
    try {
      await this.handleTelegram(data);
    } catch (error) {
      this.log.error(`Error while handling a telegram: ${error}`);
    }
  }
  async handleTelegram(data) {
    await this.setConnected(true);
    const id = (0, import_wireless_mbus_parser.guessDeviceId)(data.rawData);
    if (data.rawData.length < 11) {
      if (id == "ERR-XXXXXXXX") {
        this.log.debug(`Invalid telegram received? ${data.rawData.toString("hex")}`);
      } else {
        this.log.debug(`Beacon of device: ${id}`);
      }
      return;
    }
    if (this.blockList.isBlocked(id)) {
      this.log.debug(`Device is blocked: ${id}`);
      return;
    }
    const key = this.aesKeys.getKeyBuffer(id);
    let parsed;
    let result;
    try {
      parsed = await this.parser.parse(data.rawData, {
        verbose: true,
        containsCrc: data.containsCrc,
        key
      });
      result = import_wireless_mbus_parser.WirelessMbusParser.toLegacyResult(parsed);
    } catch (error) {
      await this.handleParserError(id, data, error);
      return;
    }
    this.blockList.noteSuccess(id);
    const deviceId = `${result.deviceInformation.Manufacturer}-${result.deviceInformation.Id}`;
    if (this.config.ignoreUnknownDevices && !this.deviceRegistry.has(deviceId)) {
      this.log.debug(`Device has no object tree and is ignored: ${deviceId}`);
      return;
    }
    await this.updateDevice(deviceId, result);
    await this.rememberDataRecordHeaders(deviceId, parsed);
  }
  /**
   * Keep the layout of the data records of a telegram with the device, so
   * that its compact telegrams can be decoded after a restart.
   *
   * @param deviceId
   * @param parsed
   */
  async rememberDataRecordHeaders(deviceId, parsed) {
    const layout = import_wireless_mbus_parser.WirelessMbusParser.getDataRecordHeadersCacheEntry(parsed);
    if (!this.deviceRegistry.learnLayout(deviceId, layout)) {
      return;
    }
    this.parser = this.createParser();
    await this.objectHelper.updateDeviceNative(deviceId, this.deviceRegistry.nativeOf(deviceId));
  }
  async handleParserError(id, data, error) {
    const thrown = error instanceof Error ? error : void 0;
    const name = (thrown == null ? void 0 : thrown.name) || "UNKNOWN_ERROR";
    const isExpected = EXPECTED_PARSER_ERRORS.includes(name);
    if (isExpected) {
      this.log.debug(`Waiting for a full frame to decode compact telegrams of device ${id} (${name})`);
      return;
    }
    this.log.debug(`Parser failed to parse telegram from device ${id}: ${name} - ${thrown == null ? void 0 : thrown.message}`);
    const muted = this.config.ignoreUnknownDevices && !this.deviceRegistry.has(id);
    this.blockList.noteFailure(id, muted);
    if (muted) {
      return;
    }
    await this.setState("info.rawdata", data.rawData.toString("hex"), true);
    this.aesKeys.checkWrongKey(id, name);
  }
  async updateDevice(deviceId, result) {
    if (!this.createdDevices.has(deviceId)) {
      await this.createDeviceObjects(deviceId, result);
    }
    await this.updateDeviceStates(deviceId, result);
  }
  async createDeviceObjects(deviceId, data) {
    this.log.debug(`Creating device: ${deviceId}`);
    await this.objectHelper.createDeviceOrChannel("device", deviceId);
    await this.objectHelper.createDeviceOrChannel("channel", `${deviceId}.data`);
    await this.objectHelper.createDeviceOrChannel("channel", `${deviceId}.info`);
    for (const key of Object.keys(data.deviceInformation)) {
      await this.objectHelper.createInfoState(deviceId, key);
    }
    await this.objectHelper.createInfoState(deviceId, "Updated");
    for (const item of data.dataRecord) {
      await this.objectHelper.createDataState(deviceId, item);
    }
    this.createdDevices.add(deviceId);
    this.deviceRegistry.add(deviceId);
  }
  async updateDeviceStates(deviceId, data) {
    this.log.debug(`Updating device: ${deviceId}`);
    for (const key of Object.keys(data.deviceInformation)) {
      const name = `${deviceId}.info.${key}`;
      if (typeof this.stateValues[name] === "undefined" || this.stateValues[name] !== data.deviceInformation[key]) {
        this.stateValues[name] = data.deviceInformation[key];
        await this.objectHelper.updateState(name, data.deviceInformation[key]);
      }
    }
    await this.objectHelper.updateState(`${deviceId}.info.Updated`, Math.floor(Date.now() / 1e3));
    for (const item of data.dataRecord) {
      const name = `${deviceId}.data.${item.number}-${item.storageNo}-${item.type}`;
      if (this.config.alwaysUpdate || typeof this.stateValues[name] === "undefined" || this.stateValues[name] !== item.value) {
        this.stateValues[name] = item.value;
        let val = item.value;
        if (this.config.forcekWh && typeof val === "number") {
          if (item.unit == "Wh") {
            val = val / 1e3;
          } else if (item.unit == "J") {
            val = val / 36e5;
          }
        }
        this.log.debug(`Value ${name}: ${val}`);
        await this.objectHelper.updateState(name, val);
      }
    }
  }
  onMessage(obj) {
    this.adminMessages.handle(obj);
  }
}
if (require.main !== module) {
  module.exports = (options) => new WirelessMbus(options);
} else {
  new WirelessMbus();
}
//# sourceMappingURL=main.js.map
