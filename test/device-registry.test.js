'use strict';

const { expect } = require('chai');
const { VifTable } = require('wireless-mbus-parser');
const DeviceRegistry = require('../lib/DeviceRegistry');
const { MAX_LAYOUTS_PER_DEVICE } = DeviceRegistry;

/**
 * A record layout as the parser hands it out - only the crc matters here.
 *
 * @param {number} crc
 * @returns {import('wireless-mbus-parser').DataRecordHeadersCacheEntry} a layout with that signature
 */
function layout(crc) {
    return {
        crc,
        version: 'v1',
        cachedDataRecordHeaders: [
            {
                dib: { tariff: 0, deviceUnit: 0, storageNo: 0, functionField: 0, dataField: 3 },
                vib: { primary: { vif: 0x13, table: VifTable.Default, extensionBitSet: false }, extensions: [] },
            },
        ],
    };
}

describe('Device registry', () => {
    /** @type {DeviceRegistry} */
    let registry;
    beforeEach(() => {
        registry = new DeviceRegistry();
        registry.add('KAM-60723506');
    });

    it('knows a device by the id of its object tree', () => {
        expect(registry.has('KAM-60723506')).to.be.true;
        expect(registry.has('CEN-11111111')).to.be.false;
    });

    it('keeps one layout per header signature', () => {
        expect(registry.learnLayout('KAM-60723506', layout(33501))).to.be.true;
        expect(registry.learnLayout('KAM-60723506', layout(33501))).to.be.false;
        expect(registry.learnLayout('KAM-60723506', layout(4711))).to.be.true;

        expect(registry.layouts().map(entry => entry.crc)).to.eql([33501, 4711]);
    });

    it('drops the oldest layout of a meter that keeps changing it', () => {
        for (let crc = 0; crc < MAX_LAYOUTS_PER_DEVICE + 2; crc++) {
            registry.learnLayout('KAM-60723506', layout(crc));
        }

        expect(registry.layouts()).to.have.lengthOf(MAX_LAYOUTS_PER_DEVICE);
        expect(registry.layouts().map(entry => entry.crc)).to.eql([2, 3, 4, 5]);
    });

    it('collects the layouts of every device for the parser', () => {
        registry.add('ELS-12345678');
        registry.learnLayout('KAM-60723506', layout(33501));
        registry.learnLayout('ELS-12345678', layout(4711));

        expect(registry.layouts().map(entry => entry.crc)).to.eql([33501, 4711]);
    });

    it('takes over what a device object remembers', () => {
        registry.add('ELS-12345678', { dataRecordHeaders: [layout(4711)] });

        expect(registry.nativeOf('ELS-12345678')).to.eql({ dataRecordHeaders: [layout(4711)] });
        expect(registry.layouts().map(entry => entry.crc)).to.eql([4711]);
    });

    it('does not forget what it knew when the device turns up again', () => {
        registry.learnLayout('KAM-60723506', layout(33501));
        registry.add('KAM-60723506');

        expect(registry.layouts().map(entry => entry.crc)).to.eql([33501]);
    });

    it('survives a device object without or with a broken native part', () => {
        registry.add('ELS-12345678', { dataRecordHeaders: 42 });

        expect(registry.nativeOf('KAM-60723506')).to.eql({ dataRecordHeaders: [] });
        expect(registry.nativeOf('ELS-12345678')).to.eql({ dataRecordHeaders: [] });
        expect(registry.nativeOf('CEN-11111111')).to.eql({ dataRecordHeaders: [] });
    });

    it('drops a stored layout the parser would reject', () => {
        // an entry of a version this adapter does not know, one that somebody
        // edited, or one that was never a layout at all
        registry.add('ELS-12345678', {
            dataRecordHeaders: [
                { crc: 1, version: 'v2', cachedDataRecordHeaders: [] },
                { crc: 2, version: 'v1' },
                { version: 'v1', cachedDataRecordHeaders: [] },
                'nonsense',
                null,
                layout(4711),
            ],
        });

        expect(registry.layouts().map(entry => entry.crc)).to.eql([4711]);
    });

    it('ignores a layout for a device that has no object tree', () => {
        expect(registry.learnLayout('CEN-11111111', layout(4711))).to.be.false;
        expect(registry.layouts()).to.be.empty;
    });
});
