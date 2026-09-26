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
var DataStates_exports = {};
__export(DataStates_exports, {
  dataStateId: () => dataStateId,
  dataStateMetadata: () => dataStateMetadata,
  default: () => DataStates_default,
  differences: () => differences,
  recordIdentity: () => recordIdentity
});
module.exports = __toCommonJS(DataStates_exports);
const UNITS_TO_ROLES = {
  "value.power.consumption": ["Wh", "kWh", "MWh", "GWh", "J", "kJ", "MJ", "GJ"],
  "value.power": ["W", "kW", "MW", "J/h", "GJ/h"],
  "value.temperature": ["\xB0C", "K", "\xB0F"],
  "value.volume": ["m\xB3", "feet\xB3"],
  "value.duration": ["s", "min", "h", "d", "months", "years"],
  "value.price": ["\u20AC", "$", "EUR", "USD"],
  "value.mass": ["kg", "t"],
  "value.flow": ["m\xB3/h", "m\xB3/min", "m\xB3/s", "kg/h"],
  "value.pressure": ["bar"],
  "value.current": ["A"],
  "value.voltage": ["V"]
};
const FUNCTION_FIELDS = ["instantaneous value", "maximum value", "minimum value", "value during error state"];
const METADATA_KEYS = ["name", "role", "unit"];
function dataStateId(deviceId, record) {
  return `${deviceId}.data.${record.number}-${record.storageNo}-${record.type}`;
}
function recordIdentity(record, parsed) {
  return {
    storageNo: record.storageNo,
    tariff: record.tariff,
    deviceUnit: record.devUnit,
    functionField: record.functionField,
    vifExtensions: parsed ? [...parsed.header.vib.extensions] : [],
    manufacturerSpecific: !parsed
  };
}
function isRecordIdentity(value) {
  const identity = value;
  return typeof value === "object" && value !== null && typeof identity.storageNo === "number" && typeof identity.tariff === "number" && typeof identity.deviceUnit === "number" && typeof identity.functionField === "number" && Array.isArray(identity.vifExtensions) && identity.vifExtensions.every((extension) => typeof extension === "number") && typeof identity.manufacturerSpecific === "boolean";
}
function describeFunctionField(functionField) {
  var _a;
  return (_a = FUNCTION_FIELDS[functionField]) != null ? _a : `function field ${functionField}`;
}
function describeExtensions(extensions) {
  if (!extensions.length) {
    return "no VIF extensions";
  }
  const hex = extensions.map((extension) => extension.toString(16).toUpperCase().padStart(2, "0"));
  return `VIF extensions ${hex.join(" ")}`;
}
function describeOrigin(manufacturerSpecific) {
  return manufacturerSpecific ? "a manufacturer specific value" : "a data record";
}
function differences(stored, incoming) {
  const result = [];
  if (stored.storageNo !== incoming.storageNo) {
    result.push(`storage number ${incoming.storageNo} instead of ${stored.storageNo}`);
  }
  if (stored.tariff !== incoming.tariff) {
    result.push(`tariff ${incoming.tariff} instead of ${stored.tariff}`);
  }
  if (stored.deviceUnit !== incoming.deviceUnit) {
    result.push(`sub-unit ${incoming.deviceUnit} instead of ${stored.deviceUnit}`);
  }
  if (stored.functionField !== incoming.functionField) {
    result.push(
      `${describeFunctionField(incoming.functionField)} instead of ${describeFunctionField(stored.functionField)}`
    );
  }
  if (stored.vifExtensions.join() !== incoming.vifExtensions.join()) {
    result.push(
      `${describeExtensions(incoming.vifExtensions)} instead of ${describeExtensions(stored.vifExtensions)}`
    );
  }
  if (stored.manufacturerSpecific !== incoming.manufacturerSpecific) {
    result.push(
      `${describeOrigin(incoming.manufacturerSpecific)} instead of ${describeOrigin(stored.manufacturerSpecific)}`
    );
  }
  return result;
}
function dataStateMetadata(record, forcekWh) {
  const unit = forcekWh && (record.unit == "Wh" || record.unit == "J") ? "kWh" : record.unit;
  const role = record.type.includes("TIME_POINT") ? "date" : Object.keys(UNITS_TO_ROLES).find((key) => UNITS_TO_ROLES[key].includes(record.unit)) || "value";
  let name;
  if (record.tariff) {
    name = `${record.description} (Tariff ${record.tariff}; ${record.functionFieldText})`;
  } else {
    name = `${record.description} (${record.functionFieldText})`;
  }
  return { name, role, unit };
}
function comparable(key, value) {
  return key === "unit" && (value === void 0 || value === null) ? "" : value;
}
function knownStateOf(obj) {
  var _a;
  const common = obj.common;
  const identity = (_a = obj.native) == null ? void 0 : _a.record;
  return {
    identity: isRecordIdentity(identity) ? identity : void 0,
    metadata: { name: common.name, role: common.role, unit: common.unit },
    mismatchReported: false
  };
}
class DataStates {
  adapter;
  objectHelper;
  /** the data states of this instance, by id relative to its namespace */
  states;
  constructor(adapter, objectHelper) {
    this.adapter = adapter;
    this.objectHelper = objectHelper;
    this.states = /* @__PURE__ */ new Map();
  }
  /**
   * Read the data states that already exist, so that a telegram does not
   * have to read the object of every one of its records first. A state that
   * is not known here is looked up when a telegram has a record for it.
   */
  async load() {
    let objects = {};
    try {
      objects = await this.adapter.getForeignObjectsAsync(`${this.adapter.namespace}.*`, "state");
    } catch (error) {
      this.adapter.log.warn(`Could not read the state objects that already exist: ${error}`);
      return;
    }
    const prefix = `${this.adapter.namespace}.`;
    for (const [id, obj] of Object.entries(objects)) {
      const relativeId = id.substring(prefix.length);
      if (id.startsWith(prefix) && /^[^.]+\.data\./.test(relativeId)) {
        this.states.set(relativeId, knownStateOf(obj));
      }
    }
  }
  /**
   * Make sure the state of a record exists and describes that record.
   *
   * @param deviceId
   * @param record the record as the legacy result has it
   * @param parsed the same record as the parser decoded it, if it is one
   * @returns whether the value of the record may be written to its state
   */
  async verify(deviceId, record, parsed) {
    var _a;
    const id = dataStateId(deviceId, record);
    const identity = recordIdentity(record, parsed);
    const metadata = dataStateMetadata(record, this.adapter.config.forcekWh);
    const known = (_a = this.states.get(id)) != null ? _a : await this.read(id);
    if (!known) {
      await this.create(id, record, identity, metadata);
      return true;
    }
    if (known.identity) {
      const found = differences(known.identity, identity);
      if (found.length) {
        this.reportMismatch(id, known, found);
        return false;
      }
    }
    await this.update(id, known, identity, metadata);
    return true;
  }
  /**
   * Drop what is known about a state whose object was deleted, so that the
   * next record for it creates it again instead of writing a value that has
   * no object.
   *
   * @param id relative to the namespace of the instance
   */
  forget(id) {
    this.states.delete(id);
  }
  async read(id) {
    let obj;
    try {
      obj = await this.adapter.getObjectAsync(id);
    } catch (error) {
      this.adapter.log.warn(`Could not read the object of ${id}: ${error}`);
    }
    if (!obj) {
      return void 0;
    }
    const known = knownStateOf(obj);
    this.states.set(id, known);
    return known;
  }
  async create(id, record, identity, metadata) {
    await this.objectHelper.createObject(id, {
      type: "state",
      common: {
        ...metadata,
        type: "mixed",
        read: true,
        write: false
      },
      native: {
        id: id.substring(id.indexOf(".")),
        StorageNumber: record.storageNo,
        Tariff: record.tariff,
        record: identity
      }
    });
    this.states.set(id, { identity, metadata: { ...metadata }, mismatchReported: false });
  }
  /**
   * A state that an adapter before this check created takes the record that
   * arrives first as the one it stands for - there is nothing else to go by.
   *
   * @param id
   * @param known
   * @param identity
   * @param metadata
   */
  async update(id, known, identity, metadata) {
    const changes = {};
    if (!known.identity) {
      changes.native = { record: identity };
      known.identity = identity;
    }
    if (this.adapter.config.updateStateObjects !== false) {
      const common = {};
      for (const key of METADATA_KEYS) {
        if (comparable(key, known.metadata[key]) !== comparable(key, metadata[key])) {
          Object.assign(common, { [key]: metadata[key] });
          known.metadata[key] = metadata[key];
        }
      }
      if (Object.keys(common).length) {
        this.adapter.log.debug(`Updating the object of ${id}: ${JSON.stringify(common)}`);
        changes.common = common;
      }
    }
    if (changes.native || changes.common) {
      await this.objectHelper.updateObject(id, changes);
    }
  }
  reportMismatch(id, known, found) {
    if (known.mismatchReported) {
      return;
    }
    known.mismatchReported = true;
    this.adapter.log.warn(
      `Values for ${id} are skipped: the state was created for a different data record than the one this telegram has at its position (${found.join(", ")}). The meter sends its records in different orders or telegrams of different layouts.`
    );
  }
}
var DataStates_default = DataStates;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  dataStateId,
  dataStateMetadata,
  differences,
  recordIdentity
});
//# sourceMappingURL=DataStates.js.map
