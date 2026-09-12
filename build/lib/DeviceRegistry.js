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
var DeviceRegistry_exports = {};
__export(DeviceRegistry_exports, {
  MAX_LAYOUTS_PER_DEVICE: () => MAX_LAYOUTS_PER_DEVICE,
  default: () => DeviceRegistry_default
});
module.exports = __toCommonJS(DeviceRegistry_exports);
const MAX_LAYOUTS_PER_DEVICE = 4;
function isValidLayout(layout) {
  const entry = layout;
  return typeof layout === "object" && layout !== null && entry.version === "v1" && typeof entry.crc === "number" && Array.isArray(entry.cachedDataRecordHeaders);
}
class DeviceRegistry {
  devices;
  constructor() {
    this.devices = /* @__PURE__ */ new Map();
  }
  /**
   * Register a device that has an object tree, with what its device object
   * remembers about it.
   *
   * @param deviceId id of the device object, e.g. ELS-12345678
   * @param native the native part of that object
   */
  add(deviceId, native = {}) {
    if (!this.devices.has(deviceId)) {
      this.devices.set(deviceId, { layouts: [] });
    }
    const layouts = Array.isArray(native.dataRecordHeaders) ? native.dataRecordHeaders : [];
    for (const layout of layouts.filter(isValidLayout)) {
      this.learnLayout(deviceId, layout);
    }
  }
  /**
   * @param deviceId
   * @returns whether the device has an object tree
   */
  has(deviceId) {
    return this.devices.has(deviceId);
  }
  /**
   * Take over the record layout of a telegram.
   *
   * @param deviceId
   * @param layout
   * @returns whether the layout was a new one
   */
  learnLayout(deviceId, layout) {
    const entry = this.devices.get(deviceId);
    if (!entry || !isValidLayout(layout) || entry.layouts.some((known) => known.crc === layout.crc)) {
      return false;
    }
    entry.layouts.push(layout);
    entry.layouts.splice(0, entry.layouts.length - MAX_LAYOUTS_PER_DEVICE);
    return true;
  }
  /**
   * The record layouts of all devices, as the parser takes them.
   *
   * @returns every layout that is known
   */
  layouts() {
    return [...this.devices.values()].flatMap((entry) => entry.layouts);
  }
  /**
   * What to store in the native part of the device object.
   *
   * @param deviceId
   * @returns what the device object keeps
   */
  nativeOf(deviceId) {
    var _a, _b;
    return { dataRecordHeaders: (_b = (_a = this.devices.get(deviceId)) == null ? void 0 : _a.layouts) != null ? _b : [] };
  }
}
var DeviceRegistry_default = DeviceRegistry;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_LAYOUTS_PER_DEVICE
});
//# sourceMappingURL=DeviceRegistry.js.map
