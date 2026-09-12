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
var import_ObjectHelper = __toESM(require("./lib/ObjectHelper.js"));
var import_DeviceRegistry = __toESM(require("./lib/DeviceRegistry.js"));
var import_ManufacturerSpecific = require("./lib/ManufacturerSpecific.js");
var import_serialport = require("serialport");
const EXPECTED_PARSER_ERRORS = ["DATA_RECORD_CACHE_MISSING"];
const AUTO_BLOCK_AFTER_FAILURES = 10;
const INITIAL_RECONNECT_DELAY = 5e3;
const MAX_RECONNECT_DELAY = 3e5;
class WirelessMbus extends utils.Adapter {
  objectHelper;
  receivers;
  connected;
  receiver;
  reconnectTimeout;
  reconnectDelay;
  reconnectAttempts;
  parser;
  /** device id -> how many of its telegrams failed to decode in a row */
  failedDevices;
  blockedDevices;
  needsKey;
  reportedInvalidKeys;
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
    this.receivers = {};
    this.connected = false;
    this.receiver = null;
    this.reconnectTimeout = null;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.reconnectAttempts = 0;
    this.parser = new import_wireless_mbus_parser.WirelessMbusParser();
    this.failedDevices = /* @__PURE__ */ new Map();
    this.blockedDevices = /* @__PURE__ */ new Set();
    this.needsKey = /* @__PURE__ */ new Set();
    this.reportedInvalidKeys = /* @__PURE__ */ new Set();
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
    const objConnection = {
      _id: "info.connection",
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
    };
    await this.objectHelper.createObject(objConnection._id, objConnection);
    const objRaw = {
      _id: "info.rawdata",
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
    };
    await this.objectHelper.createObject(objRaw._id, objRaw);
    if (typeof this.config.aeskeys !== "undefined") {
      this.config.aeskeys.forEach((item) => {
        if (item.key === "UNKNOWN") {
          this.needsKey.add(item.id);
        }
      });
    }
    this.loadManufacturerSpecificDescriptions();
    await this.loadKnownDevices();
    this.receivers = (0, import_receiver.listReceivers)();
    this.setConnected(false);
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
      this.setConnected(true);
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.reconnectAttempts = 0;
    } catch (error) {
      this.logConnectionFailure(`Error opening serial port ${port} with baudrate ${baud}: ${error}`);
      this.setConnected(false);
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
    this.setConnected(false);
    await this.closeReceiver();
    this.scheduleReconnect();
  }
  async setConnected(isConnected) {
    if (this.connected === isConnected) {
      return;
    }
    this.connected = isConnected;
    try {
      await this.setStateAsync("info.connection", this.connected, true);
      this.log.debug(`connected set to ${this.connected}`);
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
    this.setConnected(true);
    const id = (0, import_wireless_mbus_parser.guessDeviceId)(data.rawData);
    if (data.rawData.length < 11) {
      if (id == "ERR-XXXXXXXX") {
        this.log.debug(`Invalid telegram received? ${data.rawData.toString("hex")}`);
      } else {
        this.log.debug(`Beacon of device: ${id}`);
      }
      return;
    }
    if (this.isDeviceBlocked(id)) {
      this.log.debug(`Device is blocked: ${id}`);
      return;
    }
    const key = this.getAesKeyBuffer(id);
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
      this.handleParserError(id, data, error);
      return;
    }
    this.resetAutoBlocklist(id);
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
  handleParserError(id, data, error) {
    const name = error && error.name ? error.name : "UNKNOWN_ERROR";
    const isExpected = EXPECTED_PARSER_ERRORS.includes(name);
    if (isExpected) {
      this.log.debug(`Waiting for a full frame to decode compact telegrams of device ${id} (${name})`);
      return;
    }
    this.log.debug(`Parser failed to parse telegram from device ${id}: ${name} - ${error && error.message}`);
    const muted = this.config.ignoreUnknownDevices && !this.deviceRegistry.has(id);
    if (this.config.autoBlocklist) {
      this.checkAutoBlocklist(id, muted);
    }
    if (muted) {
      return;
    }
    this.setState("info.rawdata", data.rawData.toString("hex"), true);
    this.checkWrongKey(id, name);
  }
  /**
   * Resolve the configured AES key for a device into the Buffer the parser
   * expects. Keys are stored either as 32 hex characters or as a 16
   * character plain text key.
   */
  getAesKeyBuffer(id) {
    const key = this.getAesKey(id);
    if (typeof key === "undefined" || key === "UNKNOWN") {
      return void 0;
    }
    if (key.length === 32) {
      const buffer = Buffer.from(key, "hex");
      if (buffer.length === 16) {
        this.log.debug(`Found AES key for device ${id}`);
        return buffer;
      }
    } else if (key.length === 16) {
      this.log.debug(`Found AES key for device ${id}`);
      return Buffer.from(key, "latin1");
    }
    if (!this.reportedInvalidKeys.has(id)) {
      this.reportedInvalidKeys.add(id);
      this.log.error(`Invalid AES key configured for device ${id} - key rejected!`);
    }
    return void 0;
  }
  isDeviceBlocked(id) {
    if (this.blockedDevices.has(id)) {
      return true;
    }
    if (!Array.isArray(this.config.blacklist)) {
      return false;
    }
    return this.config.blacklist.some((item) => typeof item.id !== "undefined" && item.id == id);
  }
  /**
   * @param id
   * @param [quiet] report the block in the debug log only
   */
  checkAutoBlocklist(id, quiet = false) {
    var _a;
    const failures = ((_a = this.failedDevices.get(id)) != null ? _a : 0) + 1;
    this.failedDevices.set(id, failures);
    if (failures >= AUTO_BLOCK_AFTER_FAILURES && !this.blockedDevices.has(id)) {
      this.blockedDevices.add(id);
      const message = `Device ${id} is now blocked until adapter restart!`;
      if (quiet) {
        this.log.debug(message);
      } else {
        this.log.warn(message);
      }
    }
  }
  resetAutoBlocklist(id) {
    this.failedDevices.delete(id);
  }
  checkWrongKey(id, errorName) {
    if (errorName === "NO_AES_KEY") {
      this.needsKey.add(id);
    }
  }
  /**
   * The configured key of a device. A configured id that the device id only
   * starts with counts as well, so one row can stand for a series of
   * meters - and the longest of them wins, which makes the exact match the
   * best possible one.
   */
  getAesKey(id) {
    const rows = Array.isArray(this.config.aeskeys) ? this.config.aeskeys : [];
    const candidates = rows.filter((row) => typeof row.id !== "undefined" && id.startsWith(row.id));
    if (!candidates.length) {
      return void 0;
    }
    return candidates.reduce((longest, row) => row.id.length > longest.id.length ? row : longest).key;
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
        if (this.config.forcekWh) {
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
  /**
   * The serial ports as jsonConfig selectSendTo options. The control is
   * configured with "manual": true, so a port that is not listed - a
   * tcp://host:port address for instance - can still be typed in.
   */
  async listUartOptions() {
    if (!import_serialport.SerialPort) {
      this.log.warn("Module serialport is not available");
      return [];
    }
    try {
      const ports = await import_serialport.SerialPort.list();
      this.log.debug(`Found serial ports: ${JSON.stringify(ports)}`);
      return ports.map((port) => ({
        label: port.manufacturer ? `${port.path} (${port.manufacturer})` : port.path,
        value: port.path
      }));
    } catch (error) {
      this.log.error(`Could not list the serial ports: ${error}`);
      return [];
    }
  }
  /** The modes of one receiver as jsonConfig selectSendTo options. */
  listWmbusModeOptions(deviceType) {
    const receiver = (0, import_receiver.getReceiver)(deviceType);
    if (!receiver) {
      return [];
    }
    return Object.entries(receiver.modes).map(([value, label]) => ({ label, value }));
  }
  /**
   * Merge the devices that asked for a key into the key list, so they only
   * need the key filled in.
   *
   * The list to merge into comes from the open form, which the jsonConfig
   * control sends along - not from the saved configuration. Merging into
   * what the adapter has saved replaced whatever was in the form: rows typed
   * since the last save were lost, and so were saved rows whenever the
   * running instance had not picked them up yet.
   *
   * The result goes to a sendTo control with "useNative", which puts the
   * returned aeskeys into the open form without saving anything -
   * deliberately no "saveConfig", because the added rows still carry the
   * placeholder key and saving now would restart the instance for a
   * configuration the user has not finished editing.
   */
  importNeedsKeyNative(message) {
    const configured = message && Array.isArray(message.aeskeys) ? message.aeskeys : this.config.aeskeys;
    const aeskeys = Array.isArray(configured) ? [...configured] : [];
    let added = 0;
    for (const id of this.needsKey) {
      if (aeskeys.findIndex((item) => item.id === id) === -1) {
        aeskeys.push({ id, key: "UNKNOWN" });
        added++;
      }
    }
    return {
      native: { aeskeys },
      result: added ? "devicesAdded" : "noNewDevices",
      args: [added]
    };
  }
  /**
   * What the parser makes of the descriptions in the open form: one line per
   * manufacturer, with the message the parser rejected a description with -
   * which is what tells its author where it is wrong.
   *
   * The text goes back as the result itself rather than through the "result"
   * map of the control: a mapped result is shown *and* alerted a second time
   * in its raw form unless the control writes a native back, which is what
   * showed the name of the text instead of the text. What it says is the
   * report of the parser, which is English wherever it comes from.
   *
   * @param [message] the descriptions, as the jsonConfig control sends them
   */
  checkManufacturerSpecific(message) {
    const configured = message && "descriptions" in message ? message.descriptions : this.config.manufacturerSpecific;
    const { reports, error } = (0, import_ManufacturerSpecific.buildHandlers)(configured);
    if (error) {
      return { result: `The descriptions are ${error}` };
    }
    if (!reports.length) {
      return { result: "No description is configured" };
    }
    return { result: reports.map((report) => `${report.manufacturer}: ${report.message}`).join("\n") };
  }
  /**
   * Hand the editor an example description, for somebody who has nothing to
   * start from - but never over a description somebody wrote, not even a
   * broken one: what is in the editor may be half typed.
   *
   * @param [message] the descriptions of the open form
   */
  exampleManufacturerSpecific(message) {
    const configured = message && "descriptions" in message ? message.descriptions : this.config.manufacturerSpecific;
    const { descriptions, error } = (0, import_ManufacturerSpecific.readDescriptions)(configured);
    if (error || Object.keys(descriptions).length) {
      return { result: "There is a description already - the example is in the README of the adapter" };
    }
    return {
      native: { manufacturerSpecific: import_ManufacturerSpecific.EXAMPLE_DESCRIPTION },
      result: "manufacturerSpecificExampleInserted"
    };
  }
  /**
   * Decode one telegram with the descriptions of the open form and answer
   * with the states it would write - which is the only way to see whether a
   * description names the right bytes without saving it first.
   *
   * The rows go into a table of the form through "useNative": a row per
   * state, and the source column says whether it is a record of the telegram
   * or a value a description got out of one.
   *
   * @param [message] the descriptions and the telegram, as hex
   */
  async previewManufacturerSpecific(message) {
    const hex = String(message && message.telegram || "").replace(/[\s:.-]/g, "");
    const native = { manufacturerSpecificPreview: [] };
    if (!hex.length || hex.length % 2 || !/^[0-9a-fA-F]+$/.test(hex)) {
      return { native, result: "manufacturerSpecificNoTelegram" };
    }
    const { handlers, error } = (0, import_ManufacturerSpecific.buildHandlers)(message && message.descriptions);
    if (error) {
      return { native, result: "manufacturerSpecificReport", args: [`The descriptions are ${error}`] };
    }
    const data = Buffer.from(hex, "hex");
    const options = { verbose: true, key: this.getAesKeyBuffer((0, import_wireless_mbus_parser.guessDeviceId)(data)) };
    try {
      const parsed = await new import_wireless_mbus_parser.WirelessMbusParser({ manufacturerSpecificHandlers: handlers }).parse(
        data,
        options
      );
      const result = import_wireless_mbus_parser.WirelessMbusParser.toLegacyResult(parsed);
      const device = `${result.deviceInformation.Manufacturer}-${result.deviceInformation.Id}`;
      const rows = result.dataRecord.map((record, index) => ({
        // the id the adapter would write, so it can be looked up
        state: `${device}.data.${record.number}-${record.storageNo}-${record.type}`,
        name: record.description,
        value: `${record.value}`,
        unit: record.unit,
        // everything behind the records of the telegram came out of a
        // manufacturer specific blob
        source: index < parsed.dataRecords.length ? "telegram" : "description"
      }));
      native.manufacturerSpecificPreview = rows;
      return {
        native,
        result: "manufacturerSpecificPreviewOk",
        args: [rows.filter((row) => row.source === "description").length]
      };
    } catch (thrown) {
      const error2 = thrown instanceof Error ? thrown : new Error(`${thrown}`);
      return {
        native,
        result: "manufacturerSpecificReport",
        args: [`The telegram could not be decoded: ${error2.name} - ${error2.message}`]
      };
    }
  }
  onMessage(obj) {
    if (typeof obj === "object" && obj.callback) {
      switch (obj.command) {
        case "listUart":
          this.listUartOptions().then((options) => this.sendTo(obj.from, obj.command, options, obj.callback));
          break;
        case "listReceiver":
          this.sendTo(
            obj.from,
            obj.command,
            Object.entries(this.receivers).map(([value, receiver]) => ({
              label: receiver.name,
              value
            })),
            obj.callback
          );
          break;
        case "listWmbusMode":
          this.sendTo(
            obj.from,
            obj.command,
            this.listWmbusModeOptions(obj.message && obj.message.deviceType),
            obj.callback
          );
          break;
        case "exampleManufacturerSpecific":
          this.sendTo(obj.from, obj.command, this.exampleManufacturerSpecific(obj.message), obj.callback);
          break;
        case "checkManufacturerSpecific":
          this.sendTo(obj.from, obj.command, this.checkManufacturerSpecific(obj.message), obj.callback);
          break;
        case "previewManufacturerSpecific":
          this.previewManufacturerSpecific(obj.message).then(
            (result) => this.sendTo(obj.from, obj.command, result, obj.callback)
          );
          break;
        case "importNeedsKey":
          this.sendTo(obj.from, obj.command, this.importNeedsKeyNative(obj.message), obj.callback);
          break;
        case "needsKey":
          this.sendTo(obj.from, obj.command, [...this.needsKey], obj.callback);
          break;
      }
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new WirelessMbus(options);
} else {
  new WirelessMbus();
}
//# sourceMappingURL=main.js.map
