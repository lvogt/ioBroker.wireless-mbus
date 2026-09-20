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
var ManufacturerSpecific_exports = {};
__export(ManufacturerSpecific_exports, {
  EXAMPLE_DESCRIPTION: () => EXAMPLE_DESCRIPTION,
  buildHandlers: () => buildHandlers,
  readDescriptions: () => readDescriptions
});
module.exports = __toCommonJS(ManufacturerSpecific_exports);
var import_wireless_mbus_parser = require("wireless-mbus-parser");
const MANUFACTURER_PATTERN = /^[A-Z]{3}$/;
function readDescriptions(configured) {
  if (configured === void 0 || configured === null || configured === "") {
    return { descriptions: {} };
  }
  if (typeof configured === "string") {
    try {
      return readDescriptions(JSON.parse(configured));
    } catch (error) {
      return { descriptions: {}, error: `not valid JSON (${error instanceof Error ? error.message : error})` };
    }
  }
  if (typeof configured !== "object" || Array.isArray(configured)) {
    return { descriptions: {}, error: 'expected one description per manufacturer, e.g. { "ITW": [ ... ] }' };
  }
  return { descriptions: configured };
}
function summarize(spec) {
  let layouts = 0;
  let fields = 0;
  for (const entry of spec) {
    const layout = entry;
    if (layout && Array.isArray(layout.fields)) {
      layouts++;
      fields += layout.fields.length;
    }
  }
  return layouts ? `${layouts} layout(s) with ${fields} field(s)` : `${spec.length} field(s)`;
}
function buildHandlers(configured) {
  const { descriptions, error } = readDescriptions(configured);
  if (error) {
    return { handlers: {}, reports: [], error };
  }
  const handlers = {};
  const reports = [];
  for (const [manufacturer, spec] of Object.entries(descriptions)) {
    if (!MANUFACTURER_PATTERN.test(manufacturer)) {
      reports.push({
        manufacturer,
        message: "is no manufacturer code (three capital letters) and can never match a telegram",
        error: true
      });
      continue;
    }
    try {
      const fieldSpec = spec;
      handlers[manufacturer] = (0, import_wireless_mbus_parser.createManufacturerSpecificHandler)(fieldSpec);
      reports.push({ manufacturer, message: summarize(fieldSpec), error: false });
    } catch (thrown) {
      reports.push({
        manufacturer,
        message: thrown instanceof Error ? thrown.message : `${thrown}`,
        error: true
      });
    }
  }
  return { handlers, reports };
}
const EXAMPLE_DESCRIPTION = JSON.stringify(
  {
    XXX: [
      { byte: 0, bit: 0, description: "Backflow detected" },
      { byte: 1, flags: ["Leakage", "Burst", null, "Removal"] },
      { byte: 2, bytes: 3, description: "Volume", unit: "l", legacyName: "VIF_VOLUME_RAW" },
      { byte: 5, bits: [0, 1], description: "Network mode", values: ["Off", "Walk-by", "Fixed network"] }
    ]
  },
  null,
  4
);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXAMPLE_DESCRIPTION,
  buildHandlers,
  readDescriptions
});
//# sourceMappingURL=ManufacturerSpecific.js.map
