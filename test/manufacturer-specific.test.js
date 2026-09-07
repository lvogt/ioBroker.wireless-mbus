'use strict';

const { expect } = require('chai');
const { WirelessMbusParser } = require('wireless-mbus-parser');
const { buildHandlers, readDescriptions, EXAMPLE_DESCRIPTION } = require('../lib/ManufacturerSpecific');

/*
 * The descriptions of manufacturer specific data records come from the admin
 * UI as the JSON somebody typed, so what matters here is that nonsense is
 * reported rather than thrown, and that one broken description does not cost
 * the others.
 */

describe('Manufacturer specific descriptions: reading them', () => {
    it('takes nothing for no description at all', () => {
        for (const nothing of [undefined, null, '', '{}']) {
            expect(readDescriptions(nothing).error, `${nothing}`).to.be.undefined;
            expect(readDescriptions(nothing).descriptions, `${nothing}`).to.eql({});
        }
    });

    it('takes the JSON of the editor as well as the object behind it', () => {
        const spec = [{ byte: 0, description: 'Flag' }];

        expect(readDescriptions(JSON.stringify({ ACM: spec })).descriptions).to.eql({ ACM: spec });
        expect(readDescriptions({ ACM: spec }).descriptions).to.eql({ ACM: spec });
    });

    it('reports JSON that is none, rather than throwing', () => {
        const { descriptions, error } = readDescriptions('{ "ACM": [ ');

        expect(error).to.match(/not valid JSON/);
        expect(descriptions).to.eql({});
    });

    it('reports a description that is not one per manufacturer', () => {
        expect(readDescriptions('[{"byte":0}]').error).to.match(/one description per manufacturer/);
        expect(readDescriptions('42').error).to.match(/one description per manufacturer/);
    });
});

describe('Manufacturer specific descriptions: building handlers', () => {
    it('builds a handler per manufacturer and says what it holds', () => {
        const { handlers, reports, error } = buildHandlers({
            ACM: [
                { byte: 0, description: 'Flag' },
                { byte: 1, flags: ['Leak', null, 'Burst'] },
            ],
            XYZ: [{ deviceType: 7, fields: [{ byte: 0, bytes: 2, description: 'Volume', unit: 'l' }] }],
        });

        expect(error).to.be.undefined;
        expect(Object.keys(handlers)).to.eql(['ACM', 'XYZ']);
        expect(reports).to.eql([
            { manufacturer: 'ACM', message: '2 field(s)', error: false },
            { manufacturer: 'XYZ', message: '1 layout(s) with 1 field(s)', error: false },
        ]);
    });

    it('reports the message the parser rejected a description with', () => {
        const { handlers, reports } = buildHandlers({ ACM: [{ byte: 0, bit: 9, description: 'Flag' }] });

        expect(handlers).to.eql({});
        expect(reports).to.have.lengthOf(1);
        expect(reports[0].error).to.be.true;
        // the parser knows what is wrong with it, and says so
        expect(reports[0].message).to.match(/bit 9 is outside of the field at byte 0/);
    });

    it('keeps the descriptions a broken one is next to', () => {
        const { handlers, reports } = buildHandlers({
            ACM: [{ byte: 0, description: 'Flag' }],
            BAD: [{ description: 'without a byte' }],
            XYZ: [{ byte: 0, description: 'Flag' }],
        });

        expect(Object.keys(handlers)).to.eql(['ACM', 'XYZ']);
        expect(reports.filter(report => report.error).map(report => report.manufacturer)).to.eql(['BAD']);
    });

    it('rejects a key that is no manufacturer code', () => {
        const { handlers, reports } = buildHandlers({ Acme: [{ byte: 0, description: 'Flag' }] });

        expect(handlers).to.eql({});
        expect(reports[0].message).to.match(/no manufacturer code/);
    });
});

describe('Manufacturer specific descriptions: the example of the admin UI', () => {
    it('is a description the parser accepts', () => {
        const { handlers, reports, error } = buildHandlers(EXAMPLE_DESCRIPTION);

        expect(error).to.be.undefined;
        expect(Object.keys(handlers)).to.eql(['XXX']);
        expect(reports).to.eql([{ manufacturer: 'XXX', message: '4 field(s)', error: false }]);
    });

    it('shows one of every kind a field can be', () => {
        const [spec] = Object.values(readDescriptions(EXAMPLE_DESCRIPTION).descriptions);
        const fields = /** @type {Record<string, unknown>[]} */ (spec);

        expect(fields.filter(field => 'bit' in field)).to.have.lengthOf(1);
        expect(fields.filter(field => 'flags' in field)).to.have.lengthOf(1);
        expect(fields.filter(field => 'bytes' in field)).to.have.lengthOf(1);
        expect(fields.filter(field => 'bits' in field && 'values' in field)).to.have.lengthOf(1);
        // and it says how to keep a state id stable
        expect(fields.filter(field => 'legacyName' in field)).to.have.lengthOf(1);
    });
});

describe('Manufacturer specific descriptions: what the parser makes of them', () => {
    /*
     * A configured description has to reach the states, and the id of such a
     * state is generated from the description of its field - which is why
     * legacyName matters for anything that should keep its id.
     */
    const smokeDetector =
        '4e44972678563412001a7a211300002f2f066d1220ee483200077f80802002533e170c' +
        '0f0000010100000101000001012927283418311b39000001010000010100000000' +
        '14310f370d00460100002f';

    /** @param {Record<string, unknown>} descriptions */
    async function decode(descriptions) {
        const { handlers } = buildHandlers(descriptions);
        const parsed = await new WirelessMbusParser({ manufacturerSpecificHandlers: handlers }).parse(
            Buffer.from(smokeDetector, 'hex'),
            { verbose: true, containsCrc: false },
        );
        return WirelessMbusParser.toLegacyResult(parsed);
    }

    it('decodes a blob with a configured description', async () => {
        const result = await decode({
            ITW: [
                { byte: 4, description: 'Battery', unit: 'month', legacyName: 'VIF_BATTERY_MONTHS' },
                { byte: 6, bits: [0, 1], description: 'Status bits' },
            ],
        });

        const derived = result.dataRecord.slice(2);
        expect(derived.map(record => `${record.number}-${record.storageNo}-${record.type}`)).to.eql([
            '3-0-VIF_BATTERY_MONTHS',
            '4-0-VIF_STATUS_BITS',
        ]);
        expect(derived[0].value).to.equal(83);
        expect(derived[0].unit).to.equal('month');
    });

    it('takes precedence over the description the parser ships', async () => {
        const configured = await decode({ ITW: [{ byte: 5, description: 'Product code' }] });
        const builtIn = await decode({});

        // the built-in description of that detector holds 26 values
        expect(builtIn.dataRecord).to.have.lengthOf(28);
        expect(configured.dataRecord).to.have.lengthOf(3);
        expect(configured.dataRecord[2].value).to.equal(62);
    });

    it('writes nothing extra for a manufacturer nobody described', async () => {
        const result = await decode({ ACM: [{ byte: 0, description: 'Flag' }] });

        // ACM describes no ITW blob, and the built-in handler is not reached
        // because a configured description replaces it per manufacturer only
        expect(result.dataRecord).to.have.lengthOf(28);
    });
});
