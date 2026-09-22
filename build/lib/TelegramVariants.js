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
var TelegramVariants_exports = {};
__export(TelegramVariants_exports, {
  MAX_VARIANTS_PER_DEVICE: () => MAX_VARIANTS_PER_DEVICE,
  PERSIST_INTERVAL: () => PERSIST_INTERVAL,
  default: () => TelegramVariants_default,
  variantName: () => variantName
});
module.exports = __toCommonJS(TelegramVariants_exports);
const MAX_VARIANTS_PER_DEVICE = 8;
const PERSIST_INTERVAL = 60 * 60 * 1e3;
function variantName(crc) {
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
function keyOfRow(row) {
  var _a, _b;
  const id = String((_a = row == null ? void 0 : row.id) != null ? _a : "").trim();
  const variant = String((_b = row == null ? void 0 : row.variant) != null ? _b : "").trim().replace(/^0x/i, "").toUpperCase();
  if (!id || !/^[0-9A-F]{1,8}$/.test(variant)) {
    return void 0;
  }
  return `${id}/${variant.padStart(4, "0")}`;
}
function isVariant(value) {
  const variant = value;
  return typeof value === "object" && value !== null && typeof variant.crc === "number" && Array.isArray(variant.frames) && variant.frames.every((frame) => frame === "full" || frame === "compact") && Array.isArray(variant.states) && variant.states.every((state) => typeof state === "string") && typeof variant.firstSeen === "number" && typeof variant.lastSeen === "number" && typeof variant.count === "number";
}
function formatTime(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
class TelegramVariants {
  devices;
  /** "<device id>/<variant>" of every variant the configuration ignores */
  ignored;
  constructor(ignored) {
    this.devices = /* @__PURE__ */ new Map();
    this.ignored = TelegramVariants.keysOf(ignored);
  }
  static keysOf(rows) {
    const keys = Array.isArray(rows) ? rows.map(keyOfRow) : [];
    return new Set(keys.filter((key) => key !== void 0));
  }
  /**
   * Take over what the object of a device remembers about its variants.
   *
   * @param deviceId
   * @param native the native part of the device object
   */
  add(deviceId, native = {}) {
    const stored = Array.isArray(native.telegramVariants) ? native.telegramVariants : [];
    const variants = stored.filter(isVariant).slice(-MAX_VARIANTS_PER_DEVICE);
    this.devices.set(deviceId, { variants, persistedAt: Date.now() });
  }
  /**
   * @param deviceId
   * @param crc
   * @returns whether the configuration ignores the variant
   */
  isIgnored(deviceId, crc) {
    return this.ignored.has(`${deviceId}/${variantName(crc)}`);
  }
  /**
   * Count a telegram of a device.
   *
   * @param deviceId
   * @param crc the crc of its data record headers
   * @param frame whether it was a full or a compact telegram
   * @param states the states its records are written to
   * @param now
   * @returns whether the variants of the device should be written to its
   * object now - which they are then taken to be
   */
  note(deviceId, crc, frame, states, now = Date.now()) {
    let device = this.devices.get(deviceId);
    if (!device) {
      device = { variants: [], persistedAt: 0 };
      this.devices.set(deviceId, device);
    }
    let changed = false;
    let variant = device.variants.find((known) => known.crc === crc);
    if (!variant) {
      variant = { crc, frames: [], states, firstSeen: now, lastSeen: now, count: 0 };
      device.variants.push(variant);
      changed = true;
      if (device.variants.length > MAX_VARIANTS_PER_DEVICE) {
        device.variants.sort((a, b) => a.lastSeen - b.lastSeen);
        device.variants.shift();
      }
    }
    if (!variant.frames.includes(frame)) {
      variant.frames.push(frame);
      changed = true;
    }
    variant.states = states;
    variant.lastSeen = now;
    variant.count++;
    if (changed || now - device.persistedAt >= PERSIST_INTERVAL) {
      device.persistedAt = now;
      return true;
    }
    return false;
  }
  /**
   * What to store in the native part of the device object.
   *
   * @param deviceId
   * @returns what the device object keeps
   */
  nativeOf(deviceId) {
    var _a, _b;
    return { telegramVariants: (_b = (_a = this.devices.get(deviceId)) == null ? void 0 : _a.variants) != null ? _b : [] };
  }
  /**
   * The variants of all devices as the admin UI shows them.
   *
   * @param ignored the list of ignored variants of the open form, which may
   * differ from the one this instance runs with
   * @returns one row per variant, by device and with the one seen last first
   */
  rows(ignored) {
    var _a, _b;
    const ignoredKeys = TelegramVariants.keysOf(ignored);
    const rows = [];
    for (const deviceId of [...this.devices.keys()].sort()) {
      const variants = [...(_b = (_a = this.devices.get(deviceId)) == null ? void 0 : _a.variants) != null ? _b : []];
      for (const variant of variants.sort((a, b) => b.lastSeen - a.lastSeen)) {
        const name = variantName(variant.crc);
        rows.push({
          device: deviceId,
          variant: name,
          frames: variant.frames.join(", "),
          telegrams: variant.count,
          firstSeen: formatTime(variant.firstSeen),
          lastSeen: formatTime(variant.lastSeen),
          states: variant.states.join(", "),
          ignored: ignoredKeys.has(`${deviceId}/${name}`) ? "\u2713" : ""
        });
      }
    }
    return rows;
  }
}
var TelegramVariants_default = TelegramVariants;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_VARIANTS_PER_DEVICE,
  PERSIST_INTERVAL,
  variantName
});
//# sourceMappingURL=TelegramVariants.js.map
