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
var ObjectHelper_exports = {};
__export(ObjectHelper_exports, {
  default: () => ObjectHelper_default
});
module.exports = __toCommonJS(ObjectHelper_exports);
class ObjectHelper {
  adapter;
  constructor(adapter) {
    this.adapter = adapter;
  }
  async createObject(name, obj) {
    try {
      await this.adapter.setObjectNotExistsAsync(name, obj);
    } catch (err) {
      this.adapter.log.error(`Error creating state object: ${err}`);
    }
  }
  async updateState(name, value) {
    try {
      await this.adapter.setStateAsync(name, value, true);
    } catch (err) {
      this.adapter.log.error(`Error updating state ${name}: ${err}`);
    }
  }
  /**
   * What the adapter learned about a device is kept in the native part of
   * its device object: invisible in the object tree, but there again after a
   * restart. extendObject replaces the arrays it is given rather than
   * merging them element by element, so a layout that was dropped is gone.
   *
   * @param deviceId
   * @param native
   */
  async updateDeviceNative(deviceId, native) {
    try {
      await this.adapter.extendObjectAsync(deviceId, { native });
    } catch (err) {
      this.adapter.log.error(`Error updating device object ${deviceId}: ${err}`);
    }
  }
  async updateObject(name, changes) {
    try {
      await this.adapter.extendObjectAsync(name, changes);
    } catch (err) {
      this.adapter.log.error(`Error updating state object ${name}: ${err}`);
    }
  }
  async createDeviceOrChannel(type, name) {
    await this.createObject(name, {
      type,
      common: {
        name
      },
      native: {}
    });
  }
  async createInfoState(deviceId, name) {
    await this.createObject(`${deviceId}.info.${name}`, {
      type: "state",
      common: {
        name,
        role: "value",
        type: "mixed",
        read: true,
        write: false
      },
      native: {
        id: `.info.${name}`
      }
    });
  }
}
var ObjectHelper_default = ObjectHelper;
//# sourceMappingURL=ObjectHelper.js.map
