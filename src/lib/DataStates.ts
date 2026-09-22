'use strict';

/*
 * The state objects of the data records of a telegram.
 *
 * The id of a data state names the position of a record in the telegram, its
 * storage number and its VIF - but not its tariff, its sub-unit, its function
 * field or its VIF extensions. A meter that sends its records in a different
 * order, or sends telegrams of more than one layout, can put another record at
 * the same id, and its value would end up in a state that describes a
 * different one. So every state remembers the record it was created for, and
 * the value of a record that does not match it is dropped rather than written.
 *
 * The object of a record that does match is kept up to date: its name, unit
 * and role follow what the adapter would create it with today, unless the
 * instance is told to leave them alone.
 */

import type { DataRecord, LegacyResult } from 'wireless-mbus-parser';
import type ObjectHelper from './ObjectHelper';

/** One data record of a telegram, as the legacy result hands it out. */
type LegacyDataRecord = LegacyResult['dataRecord'][number];

/** What tells two records that end up at the same state id apart. */
export interface RecordIdentity {
    storageNo: number;
    tariff: number;
    deviceUnit: number;
    functionField: number;
    vifExtensions: number[];
    /** a value decoded from manufacturer specific data, not a record of the telegram */
    manufacturerSpecific: boolean;
}

/** The part of the common section of a data state that follows the record. */
interface Metadata {
    name: ioBroker.StringOrTranslated;
    role: string;
    unit: string;
}

interface KnownState {
    /** undefined for a state that an adapter before this check created */
    identity: RecordIdentity | undefined;
    metadata: Partial<Record<keyof Metadata, unknown>>;
    /** a record that does not match is reported once per run, not with every telegram */
    mismatchReported: boolean;
}

const UNITS_TO_ROLES: Record<string, string[]> = {
    'value.power.consumption': ['Wh', 'kWh', 'MWh', 'GWh', 'J', 'kJ', 'MJ', 'GJ'],
    'value.power': ['W', 'kW', 'MW', 'J/h', 'GJ/h'],
    'value.temperature': ['°C', 'K', '°F'],
    'value.volume': ['m³', 'feet³'],
    'value.duration': ['s', 'min', 'h', 'd', 'months', 'years'],
    'value.price': ['€', '$', 'EUR', 'USD'],
    'value.mass': ['kg', 't'],
    'value.flow': ['m³/h', 'm³/min', 'm³/s', 'kg/h'],
    'value.pressure': ['bar'],
    'value.current': ['A'],
    'value.voltage': ['V'],
};

const FUNCTION_FIELDS = ['instantaneous value', 'maximum value', 'minimum value', 'value during error state'];

const METADATA_KEYS: (keyof Metadata)[] = ['name', 'role', 'unit'];

/**
 * @param record
 * @returns the name of the state of a record in the data channel of its device
 */
export function dataStateName(record: LegacyDataRecord): string {
    return `${record.number}-${record.storageNo}-${record.type}`;
}

/**
 * @param deviceId
 * @param record
 * @returns the id of the state of a record, relative to the namespace of the instance
 */
export function dataStateId(deviceId: string, record: LegacyDataRecord): string {
    return `${deviceId}.data.${dataStateName(record)}`;
}

/**
 * @param record the record as the legacy result has it
 * @param parsed the same record as the parser decoded it - there is none for a
 * value that was decoded from manufacturer specific data
 * @returns what tells the record apart from others at the same state id
 */
export function recordIdentity(record: LegacyDataRecord, parsed: DataRecord | undefined): RecordIdentity {
    return {
        storageNo: record.storageNo,
        tariff: record.tariff,
        deviceUnit: record.devUnit,
        functionField: record.functionField,
        vifExtensions: parsed ? [...parsed.header.vib.extensions] : [],
        manufacturerSpecific: !parsed,
    };
}

/**
 * Whatever ended up in the native part of an object - written by a newer
 * version of the adapter, or edited by somebody - is only taken for a record
 * identity if it is one.
 *
 * @param value
 * @returns whether the value is a record identity
 */
function isRecordIdentity(value: unknown): value is RecordIdentity {
    const identity = value as Partial<RecordIdentity>;

    return (
        typeof value === 'object' &&
        value !== null &&
        typeof identity.storageNo === 'number' &&
        typeof identity.tariff === 'number' &&
        typeof identity.deviceUnit === 'number' &&
        typeof identity.functionField === 'number' &&
        Array.isArray(identity.vifExtensions) &&
        identity.vifExtensions.every(extension => typeof extension === 'number') &&
        typeof identity.manufacturerSpecific === 'boolean'
    );
}

function describeFunctionField(functionField: number): string {
    return FUNCTION_FIELDS[functionField] ?? `function field ${functionField}`;
}

function describeExtensions(extensions: number[]): string {
    if (!extensions.length) {
        return 'no VIF extensions';
    }

    const hex = extensions.map(extension => extension.toString(16).toUpperCase().padStart(2, '0'));
    return `VIF extensions ${hex.join(' ')}`;
}

function describeOrigin(manufacturerSpecific: boolean): string {
    return manufacturerSpecific ? 'a manufacturer specific value' : 'a data record';
}

/**
 * @param stored the record a state was created for
 * @param incoming the record of a telegram at the same state id
 * @returns how the two differ, in words - empty if they are the same record
 */
export function differences(stored: RecordIdentity, incoming: RecordIdentity): string[] {
    const result: string[] = [];

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
            `${describeFunctionField(incoming.functionField)} instead of ${describeFunctionField(stored.functionField)}`,
        );
    }
    if (stored.vifExtensions.join() !== incoming.vifExtensions.join()) {
        result.push(
            `${describeExtensions(incoming.vifExtensions)} instead of ${describeExtensions(stored.vifExtensions)}`,
        );
    }
    if (stored.manufacturerSpecific !== incoming.manufacturerSpecific) {
        result.push(
            `${describeOrigin(incoming.manufacturerSpecific)} instead of ${describeOrigin(stored.manufacturerSpecific)}`,
        );
    }

    return result;
}

/**
 * @param record
 * @param forcekWh whether energy is converted to kWh
 * @returns name, role and unit of the state of a record
 */
export function dataStateMetadata(record: LegacyDataRecord, forcekWh: boolean): Metadata {
    const unit = forcekWh && (record.unit == 'Wh' || record.unit == 'J') ? 'kWh' : record.unit;
    const role = record.type.includes('TIME_POINT')
        ? 'date'
        : Object.keys(UNITS_TO_ROLES).find(key => UNITS_TO_ROLES[key].includes(record.unit)) || 'value';

    let name: string;
    if (record.tariff) {
        name = `${record.description} (Tariff ${record.tariff}; ${record.functionFieldText})`;
    } else {
        name = `${record.description} (${record.functionFieldText})`;
    }

    return { name, role, unit };
}

/**
 * An object that was created without a unit has none, where the adapter
 * compares against an empty one.
 *
 * @param key
 * @param value
 * @returns the value to compare
 */
function comparable(key: keyof Metadata, value: unknown): unknown {
    return key === 'unit' && (value === undefined || value === null) ? '' : value;
}

function knownStateOf(obj: ioBroker.Object): KnownState {
    const common = obj.common as Partial<Record<keyof Metadata, unknown>>;
    const identity: unknown = obj.native?.record;

    return {
        identity: isRecordIdentity(identity) ? identity : undefined,
        metadata: { name: common.name, role: common.role, unit: common.unit },
        mismatchReported: false,
    };
}

class DataStates {
    adapter: ioBroker.Adapter;
    objectHelper: ObjectHelper;
    /** the data states of this instance, by id relative to its namespace */
    states: Map<string, KnownState>;

    constructor(adapter: ioBroker.Adapter, objectHelper: ObjectHelper) {
        this.adapter = adapter;
        this.objectHelper = objectHelper;
        this.states = new Map();
    }

    /**
     * Read the data states that already exist, so that a telegram does not
     * have to read the object of every one of its records first. A state that
     * is not known here is looked up when a telegram has a record for it.
     */
    async load(): Promise<void> {
        let objects: Record<string, ioBroker.Object> = {};

        try {
            objects = await this.adapter.getForeignObjectsAsync(`${this.adapter.namespace}.*`, 'state');
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
    async verify(deviceId: string, record: LegacyDataRecord, parsed: DataRecord | undefined): Promise<boolean> {
        const id = dataStateId(deviceId, record);
        const identity = recordIdentity(record, parsed);
        const metadata = dataStateMetadata(record, this.adapter.config.forcekWh);

        const known = this.states.get(id) ?? (await this.read(id));

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
    forget(id: string): void {
        this.states.delete(id);
    }

    async read(id: string): Promise<KnownState | undefined> {
        let obj: ioBroker.Object | null | undefined;

        try {
            obj = await this.adapter.getObjectAsync(id);
        } catch (error) {
            this.adapter.log.warn(`Could not read the object of ${id}: ${error}`);
        }

        if (!obj) {
            return undefined;
        }

        const known = knownStateOf(obj);
        this.states.set(id, known);
        return known;
    }

    async create(id: string, record: LegacyDataRecord, identity: RecordIdentity, metadata: Metadata): Promise<void> {
        await this.objectHelper.createObject(id, {
            type: 'state',
            common: {
                ...metadata,
                type: 'mixed',
                read: true,
                write: false,
            },
            native: {
                id: id.substring(id.indexOf('.')),
                StorageNumber: record.storageNo,
                Tariff: record.tariff,
                record: identity,
            },
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
    async update(id: string, known: KnownState, identity: RecordIdentity, metadata: Metadata): Promise<void> {
        const changes: Partial<ioBroker.StateObject> = {};

        if (!known.identity) {
            changes.native = { record: identity };
            known.identity = identity;
        }

        // An upgrade adds the default of a new setting to the instance, but an
        // instance can still come without it - it is on unless it is off
        if (this.adapter.config.updateStateObjects !== false) {
            const common: Partial<Metadata> = {};

            for (const key of METADATA_KEYS) {
                if (comparable(key, known.metadata[key]) !== comparable(key, metadata[key])) {
                    Object.assign(common, { [key]: metadata[key] });
                    known.metadata[key] = metadata[key];
                }
            }

            if (Object.keys(common).length) {
                this.adapter.log.debug(`Updating the object of ${id}: ${JSON.stringify(common)}`);
                changes.common = common as ioBroker.StateCommon;
            }
        }

        if (changes.native || changes.common) {
            await this.objectHelper.updateObject(id, changes);
        }
    }

    reportMismatch(id: string, known: KnownState, found: string[]): void {
        if (known.mismatchReported) {
            return;
        }
        known.mismatchReported = true;

        this.adapter.log.warn(
            `Values for ${id} are skipped: the state was created for a different data record than the one ` +
                `this telegram has at its position (${found.join(', ')}). The meter sends its records in ` +
                `different orders or telegrams of different layouts.`,
        );
    }
}

export default DataStates;
