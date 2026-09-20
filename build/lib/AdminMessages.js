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
var AdminMessages_exports = {};
__export(AdminMessages_exports, {
  default: () => AdminMessages_default
});
module.exports = __toCommonJS(AdminMessages_exports);
var import_serialport = require("serialport");
var import_wireless_mbus_parser = require("wireless-mbus-parser");
var import_receiver = require("./receiver/index");
var import_ManufacturerSpecific = require("./ManufacturerSpecific");
class AdminMessages {
  adapter;
  aesKeys;
  constructor(adapter, aesKeys) {
    this.adapter = adapter;
    this.aesKeys = aesKeys;
  }
  /**
   * The serial ports as jsonConfig autocompleteSendTo options. The control
   * is "freeSolo", so a port that is not listed - a tcp://host:port address
   * for instance - can still be typed in.
   */
  async listUartOptions() {
    if (!import_serialport.SerialPort) {
      this.adapter.log.warn("Module serialport is not available");
      return [];
    }
    try {
      const ports = await import_serialport.SerialPort.list();
      this.adapter.log.debug(`Found serial ports: ${JSON.stringify(ports)}`);
      return ports.map((port) => ({
        label: port.manufacturer ? `${port.path} (${port.manufacturer})` : port.path,
        value: port.path
      }));
    } catch (error) {
      this.adapter.log.error(`Could not list the serial ports: ${error}`);
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
    const configured = message && Array.isArray(message.aeskeys) ? message.aeskeys : this.adapter.config.aeskeys;
    const { aeskeys, added } = this.aesKeys.mergeInto(Array.isArray(configured) ? configured : []);
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
    const configured = message && "descriptions" in message ? message.descriptions : this.adapter.config.manufacturerSpecific;
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
    const configured = message && "descriptions" in message ? message.descriptions : this.adapter.config.manufacturerSpecific;
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
    const options = { verbose: true, key: this.aesKeys.getKeyBuffer((0, import_wireless_mbus_parser.guessDeviceId)(data)) };
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
        // manufacturer specific blob - a configured description, or
        // one of the handlers the parser brings itself
        source: index < parsed.dataRecords.length ? "telegram" : "manufacturer"
      }));
      native.manufacturerSpecificPreview = rows;
      return {
        native,
        result: "manufacturerSpecificPreviewOk",
        args: [rows.filter((row) => row.source === "manufacturer").length]
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
  /**
   * Answer a message of the admin UI, or leave it alone if it is none of
   * these.
   *
   * Nobody waits for this, so every answer goes through the same place: an
   * exception in a handler would otherwise be an unhandled rejection, and
   * adapter-core terminates the adapter over one of those.
   *
   * @param obj the message as the adapter received it
   */
  handle(obj) {
    if (typeof obj !== "object" || !obj.callback) {
      return;
    }
    Promise.resolve().then(() => this.answer(obj.command, obj.message)).then((answer) => {
      if (typeof answer !== "undefined") {
        this.adapter.sendTo(obj.from, obj.command, answer, obj.callback);
      }
    }).catch((error) => this.adapter.log.error(`Could not answer the message "${obj.command}": ${error}`));
  }
  /**
   * What one command answers with.
   *
   * @param command the command of the message
   * @param message what was sent with it - the values of the open form
   * @returns the answer, or undefined for a command that is none of these,
   * which is then not answered at all
   */
  answer(command, message) {
    switch (command) {
      case "listUart":
        return this.listUartOptions();
      case "listReceiver":
        return Object.entries((0, import_receiver.listReceivers)()).map(([value, receiver]) => ({
          label: receiver.name,
          value
        }));
      case "listWmbusMode":
        return this.listWmbusModeOptions(message && message.deviceType);
      case "exampleManufacturerSpecific":
        return this.exampleManufacturerSpecific(message);
      case "checkManufacturerSpecific":
        return this.checkManufacturerSpecific(message);
      case "previewManufacturerSpecific":
        return this.previewManufacturerSpecific(message);
      case "importNeedsKey":
        return this.importNeedsKeyNative(message);
      case "needsKey":
        return [...this.aesKeys.needsKey];
      default:
        return void 0;
    }
  }
}
var AdminMessages_default = AdminMessages;
//# sourceMappingURL=AdminMessages.js.map
