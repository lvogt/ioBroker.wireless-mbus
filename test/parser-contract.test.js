'use strict';

const { expect } = require('chai');
const { WirelessMbusParser, guessDeviceId } = require('wireless-mbus-parser');

/*
 * The telegram parser itself is tested in the wireless-mbus-parser repository.
 * What matters here is the contract the adapter relies on, because it is what
 * user visible object IDs are built from:
 *
 *   <Manufacturer>-<Id>.data.<number>-<storageNo>-<type>
 *
 * A parser upgrade that renames a legacy VIF, reorders records or changes a
 * storage number silently orphans every existing state and its history, so
 * these tests assert the derived IDs rather than just the values.
 */

function stateId(record) {
    return `${record.number}-${record.storageNo}-${record.type}`;
}

/**
 * @param {InstanceType<typeof WirelessMbusParser>} parser
 * @param {string} hex
 * @param {{ key?: string, containsCrc?: boolean }} [options]
 */
async function parse(parser, hex, options = {}) {
    // containsCrc defaults to false rather than undefined: undefined makes the
    // parser guess, while every receiver states it explicitly.
    const { key, containsCrc = false } = options;
    const parsed = await parser.parse(Buffer.from(hex, 'hex'), {
        verbose: true,
        containsCrc,
        key: key ? Buffer.from(key, 'hex') : undefined,
    });
    return WirelessMbusParser.toLegacyResult(parsed);
}

/**
 * Returns the name of the thrown ParserError, or null if parsing succeeded.
 * ParserError is a type-only export, so the name is the only discriminator.
 *
 * @param {InstanceType<typeof WirelessMbusParser>} parser
 * @param {string} hex
 * @param {{ key?: string, containsCrc?: boolean }} [options]
 */
async function parseErrorName(parser, hex, options = {}) {
    try {
        await parse(parser, hex, options);
        return null;
    } catch (error) {
        // narrowing rather than a JSDoc cast: eslint's jsdoc/check-tag-names
        // considers @type redundant here and --fix deletes it
        return error instanceof Error ? error.name : String(error);
    }
}

describe('Parser contract: device ids', () => {
    it('guessDeviceId matches the id format used for AES keys and the blocklist', () => {
        const cases = [
            [
                '2E44931578563412330333637A2A0020255923C95AAA26D1B2E7493BC2AD013EC4A6F6D3529B520EDFF0EA6DEFC955B29D6D69EBF3EC8A',
                'ELS-12345678',
            ],
            [
                '2C446532821851582C067AE1000000046D1906D9180C1334120000426CBF1C4C1300000000326CFFFF01FD7300',
                'LSE-58511882',
            ],
            ['2644333003000000011B72030000003330011B542000002F2F02FD1701002F2F2F2F2F2F2F2F2F80', 'LAS-00000003'],
            [
                '3F442D2C06357260190C8D207C71032F21255C79DD829283011117650000BFA80000D24F0000B1FB00000000E919FF18F7640000E8FA00000B000000DB111C0B5B',
                'KAM-60723506',
            ],
        ];

        for (const [hex, expected] of cases) {
            expect(guessDeviceId(Buffer.from(hex, 'hex'))).to.equal(expected);
        }
    });

    it('reports the error sentinel for a truncated telegram', () => {
        expect(guessDeviceId(Buffer.alloc(4))).to.equal('ERR-XXXXXXXX');
    });
});

describe('Parser contract: state ids and values', () => {
    let parser;
    beforeEach(() => {
        parser = new WirelessMbusParser();
    });

    it('OMS security profile A', async () => {
        const result = await parse(
            parser,
            '2E44931578563412330333637A2A0020255923C95AAA26D1B2E7493BC2AD013EC4A6F6D3529B520EDFF0EA6DEFC955B29D6D69EBF3EC8A',
            { key: '0102030405060708090A0B0C0D0E0F11', containsCrc: true },
        );

        expect(result.deviceInformation.Manufacturer).to.equal('ELS');
        expect(result.deviceInformation.Id).to.equal('12345678');
        expect(result.deviceInformation.Medium).to.equal('Gas');
        expect(result.dataRecord).to.have.lengthOf(3);
        expect(result.dataRecord.map(stateId)).to.eql([
            '1-0-VIF_VOLUME',
            '2-0-VIF_TIME_POINT_DATE_TIME',
            '3-0-VIF_ERROR_FLAGS',
        ]);
        expect(Number(result.dataRecord[0].value)).to.be.closeTo(28504.27, 0.01);
        expect(result.dataRecord[0].unit).to.equal('m³');
    });

    it('decrypts with the correct key', async () => {
        const result = await parse(
            parser,
            '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689',
            {
                key: '4E5508544202058100DFEFA06B0934A5',
            },
        );

        expect(result.deviceInformation.Manufacturer).to.equal('KAM');
        expect(Number(result.dataRecord[1].value)).to.be.closeTo(474.24, 0.01);
    });

    it('rejects a wrong key without falling back to plain text', async () => {
        const name = await parseErrorName(
            parser,
            '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689',
            { key: '4E5508544202058100DFEFA06B0934AF' },
        );
        expect(name).to.equal('WRONG_AES_KEY');
    });

    it('reports NO_AES_KEY, which is what queues a device for the key prompt', async () => {
        const name = await parseErrorName(
            parser,
            '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689',
        );
        expect(name).to.equal('NO_AES_KEY');
    });

    it('handles frame type B without being told the frame type', async () => {
        const result = await parse(parser, '1444AE0C7856341201078C2027780B134365877AC5', { containsCrc: true });

        expect(result.deviceInformation.Manufacturer).to.equal('CEN');
        expect(result.deviceInformation.Medium).to.equal('Water');
        expect(result.dataRecord).to.have.lengthOf(1);
        // the id asserted by the integration test for this telegram
        expect(stateId(result.dataRecord[0])).to.equal('1-0-VIF_VOLUME');
        expect(Number(result.dataRecord[0].value)).to.be.closeTo(876.543, 0.01);
    });

    it('handles frame type B without CRC', async () => {
        const result = await parse(parser, '1244AE0C7856341201078C2027780B13436587', { containsCrc: false });

        expect(result.deviceInformation.Manufacturer).to.equal('CEN');
        expect(Number(result.dataRecord[0].value)).to.be.closeTo(876.543, 0.01);
    });

    it('exposes numeric values, not preformatted strings', async () => {
        const result = await parse(
            parser,
            '2C44A7320613996707047A821000202F2F0C06000000000C14000000000C22224101000B5A4102000B5E4000F05E',
        );

        const temperature = result.dataRecord[3];
        expect(temperature.type).to.equal('VIF_FLOW_TEMP');
        expect(temperature.value).to.be.a('number');
        expect(temperature.value).to.be.closeTo(24.1, 0.01);
    });

    it('decodes a negative temperature', async () => {
        const result = await parse(
            parser,
            '2C44A7320613996707047A821000202F2F0C06000000000C14000000000C22224101000B5A4102000B5E4000F05E',
        );

        expect(Number(result.dataRecord[4].value)).to.be.closeTo(-4, 0.01);
    });
});

describe('Parser contract: manufacturer specific telegrams', () => {
    /*
     * Techem and Diehl (PRIOS) telegrams are decoded by the library rather
     * than by the wM-Bus rules, and 0.12.0 shipped a version that skipped
     * their first data record: every value of a Techem heat cost allocator
     * ended up under the wrong name, a Techem heat meter threw a RangeError,
     * and a PRIOS water meter reported its volume as a heat cost unit. None of
     * it was noticed because nothing here covered them.
     */
    let parser;
    beforeEach(() => {
        parser = new WirelessMbusParser();
    });

    it('Techem heat cost allocator', async () => {
        const result = await parse(
            parser,
            '33446850942905119480a20f9f257500902d0000018e0a760a000000000000000000000000000000000000000000000000000000',
        );

        expect(result.deviceInformation.Manufacturer).to.equal('TCH');
        expect(result.deviceInformation.Id).to.equal('11052994');
        expect(result.dataRecord.map(stateId)).to.eql([
            '1-1-VIF_TIME_POINT_DATE',
            '2-1-VIF_HCA',
            '3-0-VIF_TIME_POINT_DATE',
            '4-0-VIF_HCA',
            '5-0-VIF_EXTERNAL_TEMP',
            '6-0-VIF_EXTERNAL_TEMP',
            '7-0-VIF_TEMP_DIFF',
        ]);
        expect(result.dataRecord[1].value).to.equal(117);
        expect(Number(result.dataRecord[4].value)).to.be.closeTo(27.02, 0.01);
        expect(result.dataRecord[4].unit).to.equal('°C');
    });

    it('Techem heat meter', async () => {
        const result = await parse(
            parser,
            '36446850626262624543A1009F2777010060780000000A000000000000000000000000000000000000000000000000A0400000B4010000',
        );

        expect(result.deviceInformation.Manufacturer).to.equal('TCH');
        expect(result.deviceInformation.Id).to.equal('62626262');
        expect(result.dataRecord.map(stateId)).to.eql([
            '1-1-VIF_TIME_POINT_DATE',
            '2-1-VIF_ENERGY_WATT',
            '3-0-VIF_TIME_POINT_DATE',
            '4-0-VIF_ENERGY_WATT',
            '5-0-VIF_ENERGY_WATT',
        ]);
        expect(result.dataRecord[4].value).to.equal(495000);
        expect(result.dataRecord[4].unit).to.equal('Wh');
    });

    it('Techem heat meter with a current period energy above 16 bit', async () => {
        const result = await parse(
            parser,
            '36446850626262624543A1009F2777010060780001000A000000000000000000000000000000000000000000000000A0400000B4010000',
        );

        // it used to be truncated to the lower 16 bit
        expect(result.dataRecord[3].value).to.equal(65656000);
    });

    it('PRIOS water meter', async () => {
        const result = await parse(parser, '1944a511780727324120a2211a00136d7417074c0dcb9661a3ab');

        expect(result.deviceInformation.Manufacturer).to.equal('DME');
        expect(result.deviceInformation.Id).to.equal('20413227');
        expect(result.dataRecord.map(stateId)).to.eql([
            '1-0-VIF_VOLUME',
            '2-1-VIF_VOLUME',
            '3-1-VIF_TIME_POINT_DATE',
            '4-0-VIF_BATTERY_REMAINING',
            '5-0-VIF_TRANSMIT_PERIOD',
            '6-0-VIF_ERROR_FLAGS',
            '7-0-VIF_ERROR_FLAGS',
        ]);
        expect(Number(result.dataRecord[0].value)).to.be.closeTo(175.854, 0.001);
        expect(result.dataRecord[0].unit).to.equal('m³');
    });

    it('a PRIOS device is known under two ids', () => {
        // The link layer address is not the id the application layer reports,
        // and the adapter looks up keys and the block list by the first while
        // it names the device in the object tree by the second
        expect(guessDeviceId(Buffer.from('1944a511780727324120a2211a00136d7417074c0dcb9661a3ab', 'hex'))).to.equal(
            'DME-32270778',
        );
    });
});

describe('Parser contract: compact frames', () => {
    // A compact frame carries only a header signature; the record layout comes
    // from a previously seen full frame. The adapter therefore keeps one
    // long lived parser instance and must not treat the first failure as a
    // device fault.
    const short =
        '3F442D2C06357260190C8D207C71032F21255C79DD829283011117650000BFA80000D24F0000B1FB00000000E919FF18F7640000E8FA00000B000000DB111C0B5B';
    const long =
        '5C442D2C06357260190C8D207B70032F21271D7802F9FF15011104061765000004EEFF07BFA8000004EEFF08D24F00000414B1FB000002FD170000026CE919426CFF184406F76400004414E8FA0000043B0B0000000259DB11025D1C0B5B';

    it('fails the first compact frame with DATA_RECORD_CACHE_MISSING', async () => {
        const parser = new WirelessMbusParser();
        expect(await parseErrorName(parser, short)).to.equal('DATA_RECORD_CACHE_MISSING');
    });

    it('decodes the compact frame once a full frame primed the same instance', async () => {
        const parser = new WirelessMbusParser();

        // registers interest in this header signature
        await parse(parser, short).catch(() => {});
        const full = await parse(parser, long);
        const compact = await parse(parser, short);

        expect(full.dataRecord).to.have.lengthOf(13);
        expect(compact.dataRecord).to.have.lengthOf(13);
        // same layout, so the same state ids - this is what makes a compact
        // telegram update the states a full telegram created
        expect(compact.dataRecord.map(stateId)).to.eql(full.dataRecord.map(stateId));
        expect(Number(compact.dataRecord[12].value)).to.be.closeTo(28.44, 0.01);
    });

    it('does not share cached layouts between instances', async () => {
        const primed = new WirelessMbusParser();
        await parse(primed, short).catch(() => {});
        await parse(primed, long);

        const fresh = new WirelessMbusParser();
        expect(await parseErrorName(fresh, short)).to.equal('DATA_RECORD_CACHE_MISSING');
    });

    /*
     * The adapter stores the layout of every full telegram with the device and
     * hands the stored ones to a new parser, which is what decodes a compact
     * telegram that arrives before the meter sent a full one again.
     */
    it('hands out the layout of a full frame, even one it did not cache itself', async () => {
        const parser = new WirelessMbusParser();
        const full = await parser.parse(Buffer.from(long, 'hex'), { verbose: true, containsCrc: false });
        const entry = WirelessMbusParser.getDataRecordHeadersCacheEntry(full);

        // nothing asked for this layout yet, so the parser itself kept nothing
        expect(parser.cache).to.be.empty;
        expect(entry.crc).to.equal(full.dataRecordHeadersCrc);
        expect(entry.cachedDataRecordHeaders).to.have.lengthOf(13);
    });

    it('decodes the first compact frame with a layout that came back from an object', async () => {
        const source = new WirelessMbusParser();
        const full = await source.parse(Buffer.from(long, 'hex'), { verbose: true, containsCrc: false });

        // what a device object stores and gives back after a restart
        const stored = JSON.parse(JSON.stringify(WirelessMbusParser.getDataRecordHeadersCacheEntry(full)));
        const parser = new WirelessMbusParser({ cachedDataRecordHeaders: [stored] });

        const compact = await parse(parser, short);
        expect(compact.dataRecord).to.have.lengthOf(13);
        expect(Number(compact.dataRecord[12].value)).to.be.closeTo(28.44, 0.01);
    });

    it('refuses a stored layout of an unknown version', () => {
        // which is why the adapter checks what it read from the object before
        // it hands it over - one bad entry would cost every device its layouts
        expect(
            () =>
                new WirelessMbusParser({
                    // @ts-expect-error the point of the test is a version the parser does not know
                    cachedDataRecordHeaders: [{ crc: 1, version: 'v2', cachedDataRecordHeaders: [] }],
                }),
        ).to.throw();
    });
});
