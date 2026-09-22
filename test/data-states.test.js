'use strict';

const { expect } = require('chai');
const { VifTable } = require('wireless-mbus-parser');
const ObjectHelper = require('../src/lib/ObjectHelper').default;
const DataStates = require('../src/lib/DataStates').default;
const { differences, recordIdentity } = require('../src/lib/DataStates');

const NAMESPACE = 'wireless-mbus.0';
const ID = 'LSE-58511882.data.2-0-VIF_VOLUME';

/**
 * An adapter that keeps its objects in memory.
 *
 * @param [config] what the instance has saved
 */
function fakeAdapter(config = {}) {
    return {
        namespace: NAMESPACE,
        config: { forcekWh: false, updateStateObjects: true, ...config },
        /** @type {Record<string, any>} */
        objects: {},
        /** @type {string[]} */
        warnings: [],
        reads: 0,
        log: {
            debug: () => {},
            info: () => {},
            error: () => {},
            warn(message) {
                this.owner.warnings.push(message);
            },
        },
        async getForeignObjectsAsync(pattern, type) {
            const prefix = pattern.replace(/\*$/, '');
            return Object.fromEntries(
                Object.entries(this.objects).filter(([id, obj]) => id.startsWith(prefix) && obj.type === type),
            );
        },
        async getObjectAsync(id) {
            this.reads++;
            return this.objects[`${NAMESPACE}.${id}`] ?? null;
        },
        async setObjectNotExistsAsync(id, obj) {
            this.objects[`${NAMESPACE}.${id}`] ??= structuredClone(obj);
        },
        async extendObjectAsync(id, changes) {
            const obj = this.objects[`${NAMESPACE}.${id}`];
            obj.common = { ...obj.common, ...changes.common };
            obj.native = { ...obj.native, ...changes.native };
        },
        /** @param {string} id relative to the namespace */
        object(id) {
            return this.objects[`${NAMESPACE}.${id}`];
        },
    };
}

/**
 * A data record as the legacy result has it - the volume at position 2 of
 * the telegram of a Sensus meter.
 *
 * @param [overrides]
 */
function legacyRecord(overrides = {}) {
    return {
        number: 2,
        value: 1.234,
        unit: 'm³',
        type: 'VIF_VOLUME',
        description: 'Volume',
        tariff: 0,
        storageNo: 0,
        devUnit: 0,
        functionFieldText: 'Instantaneous value',
        functionField: 0,
        ...overrides,
    };
}

/**
 * The same record as the parser decoded it - only the VIF extensions matter
 * here, the rest of the identity comes from the legacy record.
 *
 * @param {number[]} [extensions]
 */
function parsedRecord(extensions = []) {
    return {
        header: {
            dib: { tariff: 0, deviceUnit: 0, storageNo: 0, functionField: 0, dataField: 12 },
            vib: { primary: { vif: 0x13, table: VifTable.Default, extensionBitSet: false }, extensions },
            offset: 0,
            length: 0,
        },
        value: 1234,
    };
}

/** A data state as a version of the adapter before the check created it. */
function oldObject(common = {}) {
    return {
        type: 'state',
        common: {
            name: 'Volume (Instantaneous value)',
            role: 'value.volume',
            type: 'mixed',
            read: true,
            write: false,
            unit: 'm³',
            ...common,
        },
        native: { id: '.data.2-0-VIF_VOLUME', StorageNumber: 0, Tariff: 0 },
    };
}

describe('Data states', () => {
    let adapter;
    let dataStates;

    function create(config) {
        adapter = fakeAdapter(config);
        adapter.log.owner = adapter;
        const asAdapter = /** @type {any} */ (adapter);
        dataStates = new DataStates(asAdapter, new ObjectHelper(asAdapter));
    }

    beforeEach(() => create());

    describe('a record without a state', () => {
        it('gets a state that remembers the record', async () => {
            expect(await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord())).to.be.true;

            const obj = adapter.object(ID);
            expect(obj.common).to.include({ name: 'Volume (Instantaneous value)', role: 'value.volume', unit: 'm³' });
            expect(obj.native).to.eql({
                id: '.data.2-0-VIF_VOLUME',
                StorageNumber: 0,
                Tariff: 0,
                record: {
                    storageNo: 0,
                    tariff: 0,
                    deviceUnit: 0,
                    functionField: 0,
                    vifExtensions: [],
                    manufacturerSpecific: false,
                },
            });
        });

        it('is only looked up once', async () => {
            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());
            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());

            expect(adapter.reads).to.equal(1);
        });
    });

    describe('a record that does not match its state', () => {
        beforeEach(async () => {
            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());
        });

        it('is skipped for another tariff', async () => {
            expect(await dataStates.verify('LSE-58511882', legacyRecord({ tariff: 1 }), parsedRecord())).to.be.false;
            expect(adapter.warnings[0]).to.include(ID).and.to.include('tariff 1 instead of 0');
        });

        it('is skipped for another sub-unit', async () => {
            expect(await dataStates.verify('LSE-58511882', legacyRecord({ devUnit: 1 }), parsedRecord())).to.be.false;
            expect(adapter.warnings[0]).to.include('sub-unit 1 instead of 0');
        });

        it('is skipped for another function field', async () => {
            const maximum = legacyRecord({ functionField: 1, functionFieldText: 'Maximum value' });

            expect(await dataStates.verify('LSE-58511882', maximum, parsedRecord())).to.be.false;
            expect(adapter.warnings[0]).to.include('maximum value instead of instantaneous value');
        });

        it('is skipped for other VIF extensions', async () => {
            expect(await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord([0x3c]))).to.be.false;
            expect(adapter.warnings[0]).to.include('VIF extensions 3C instead of no VIF extensions');
        });

        it('is skipped for a value decoded from manufacturer specific data', async () => {
            expect(await dataStates.verify('LSE-58511882', legacyRecord(), undefined)).to.be.false;
            expect(adapter.warnings[0]).to.include('a manufacturer specific value instead of a data record');
        });

        it('is reported once, not with every telegram', async () => {
            await dataStates.verify('LSE-58511882', legacyRecord({ tariff: 1 }), parsedRecord());
            await dataStates.verify('LSE-58511882', legacyRecord({ tariff: 1 }), parsedRecord());

            expect(adapter.warnings).to.have.lengthOf(1);
        });

        it('leaves the state alone', async () => {
            await dataStates.verify(
                'LSE-58511882',
                legacyRecord({ tariff: 1, description: 'Something else', unit: 'l' }),
                parsedRecord(),
            );

            expect(adapter.object(ID).common).to.include({ name: 'Volume (Instantaneous value)', unit: 'm³' });
            expect(adapter.object(ID).native.record.tariff).to.equal(0);
        });

        it('does not get in the way of the record the state stands for', async () => {
            await dataStates.verify('LSE-58511882', legacyRecord({ tariff: 1 }), parsedRecord());

            expect(await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord())).to.be.true;
        });
    });

    describe('a state an earlier version of the adapter created', () => {
        beforeEach(() => {
            adapter.objects[`${NAMESPACE}.${ID}`] = oldObject();
        });

        it('takes the first record for the one it stands for', async () => {
            expect(await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord())).to.be.true;

            expect(adapter.object(ID).native.record).to.eql(recordIdentity(legacyRecord(), parsedRecord()));
            // what was there before stays
            expect(adapter.object(ID).native.StorageNumber).to.equal(0);
        });

        it('turns down a different record after that', async () => {
            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());

            expect(await dataStates.verify('LSE-58511882', legacyRecord({ tariff: 2 }), parsedRecord())).to.be.false;
        });

        it('takes a record for one that has something else in its native part', async () => {
            adapter.object(ID).native.record = { tariff: 'one' };

            expect(await dataStates.verify('LSE-58511882', legacyRecord({ tariff: 2 }), parsedRecord())).to.be.true;
            expect(adapter.object(ID).native.record.tariff).to.equal(2);
        });
    });

    describe('the metadata of a state', () => {
        it('follows the record', async () => {
            adapter.objects[`${NAMESPACE}.${ID}`] = oldObject({ name: 'Volume', role: 'value', unit: 'l' });

            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());

            expect(adapter.object(ID).common).to.include({
                name: 'Volume (Instantaneous value)',
                role: 'value.volume',
                unit: 'm³',
            });
        });

        it('follows the kWh option', async () => {
            create({ forcekWh: true });
            adapter.objects[`${NAMESPACE}.${ID}`] = oldObject({ unit: 'Wh', role: 'value.power.consumption' });

            await dataStates.verify(
                'LSE-58511882',
                legacyRecord({ unit: 'Wh', description: 'Energy' }),
                parsedRecord(),
            );

            expect(adapter.object(ID).common.unit).to.equal('kWh');
        });

        it('is taken as it is when there is no unit either way', async () => {
            const obj = /** @type {any} */ (oldObject({ name: 'Model version (Instantaneous value)', role: 'value' }));
            delete obj.common.unit;
            adapter.objects[`${NAMESPACE}.${ID}`] = obj;

            await dataStates.verify(
                'LSE-58511882',
                legacyRecord({ unit: '', description: 'Model version' }),
                parsedRecord(),
            );

            expect(adapter.object(ID).common).to.not.have.property('unit');
        });

        it('follows the record for an instance that does not have the setting yet', async () => {
            create();
            delete adapter.config.updateStateObjects;
            adapter.objects[`${NAMESPACE}.${ID}`] = oldObject({ unit: 'l' });

            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());

            expect(adapter.object(ID).common.unit).to.equal('m³');
        });

        it('is left alone when the instance says so, while the record is still stored', async () => {
            create({ updateStateObjects: false });
            adapter.objects[`${NAMESPACE}.${ID}`] = oldObject({ name: 'My water meter', unit: 'l' });

            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());

            expect(adapter.object(ID).common).to.include({ name: 'My water meter', unit: 'l' });
            expect(adapter.object(ID).native.record).to.be.an('object');
        });
    });

    describe('the states that already exist', () => {
        it('are read in one go', async () => {
            adapter.objects[`${NAMESPACE}.${ID}`] = oldObject();

            await dataStates.load();
            await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord());

            expect(adapter.reads).to.equal(0);
        });

        it('are the data states only', async () => {
            adapter.objects[`${NAMESPACE}.LSE-58511882.info.Id`] = { type: 'state', common: {}, native: {} };
            adapter.objects[`${NAMESPACE}.info.connection`] = { type: 'state', common: {}, native: {} };

            await dataStates.load();

            expect([...dataStates.states.keys()]).to.be.empty;
        });

        it('are looked up one by one when they cannot be read in one go', async () => {
            adapter.objects[`${NAMESPACE}.${ID}`] = oldObject();
            adapter.getForeignObjectsAsync = async () => {
                throw new Error('no connection');
            };

            await dataStates.load();
            expect(await dataStates.verify('LSE-58511882', legacyRecord(), parsedRecord())).to.be.true;

            expect(adapter.reads).to.equal(1);
            expect(adapter.warnings[0]).to.include('no connection');
        });
    });

    describe('the differences of two records', () => {
        it('are none for the same record', () => {
            const identity = recordIdentity(legacyRecord(), parsedRecord([0x3c]));

            expect(differences(identity, recordIdentity(legacyRecord(), parsedRecord([0x3c])))).to.be.empty;
        });

        it('name a function field the standard does not know by its number', () => {
            const stored = recordIdentity(legacyRecord(), parsedRecord());
            const incoming = { ...stored, functionField: 7 };

            expect(differences(stored, incoming)).to.eql(['function field 7 instead of instantaneous value']);
        });
    });
});
