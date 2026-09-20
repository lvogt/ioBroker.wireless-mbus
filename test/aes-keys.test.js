'use strict';

const { expect } = require('chai');
const AesKeys = require('../src/lib/AesKeys').default;
const { KEY_PLACEHOLDER } = require('../src/lib/AesKeys');

/** Collects what was logged, so the repeated reports can be counted. */
function recordingLog() {
    /** @type {Record<string, string[]>} */
    const lines = { debug: [], info: [], warn: [], error: [] };
    return {
        lines,
        debug: msg => lines.debug.push(msg),
        info: msg => lines.info.push(msg),
        warn: msg => lines.warn.push(msg),
        error: msg => lines.error.push(msg),
    };
}

const HEX_KEY = '000102030405060708090a0b0c0d0e0f';
const PLAIN_KEY = '0123456789abcdef';

describe('AES keys', () => {
    let log;

    beforeEach(() => {
        log = recordingLog();
    });

    describe('looking a key up', () => {
        it('finds the key of a device', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: HEX_KEY }], log);
            expect(keys.getKey('AAA-12345678')).to.equal(HEX_KEY);
        });

        it('has none for a device that is not configured', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: HEX_KEY }], log);
            expect(keys.getKey('BBB-87654321')).to.be.undefined;
        });

        it('lets one row stand for a series of meters', () => {
            const keys = new AesKeys([{ id: 'AAA-1234', key: HEX_KEY }], log);
            expect(keys.getKey('AAA-12345678')).to.equal(HEX_KEY);
        });

        it('prefers the longest matching id', () => {
            // the exact match is then the best possible one
            const keys = new AesKeys(
                [
                    { id: 'AAA', key: 'aaa' },
                    { id: 'AAA-12345678', key: 'exact' },
                    { id: 'AAA-1234', key: 'series' },
                ],
                log,
            );
            expect(keys.getKey('AAA-12345678')).to.equal('exact');
            expect(keys.getKey('AAA-12349999')).to.equal('series');
            expect(keys.getKey('AAA-99999999')).to.equal('aaa');
        });

        it('survives a configuration that has no list at all', () => {
            for (const rows of [undefined, null, 'nonsense']) {
                const keys = new AesKeys(/** @type {any} */ (rows), log);
                expect(keys.getKey('AAA-12345678'), String(rows)).to.be.undefined;
            }
        });
    });

    describe('turning a key into what the parser takes', () => {
        it('reads a key written as 32 hex characters', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: HEX_KEY }], log);
            expect(keys.getKeyBuffer('AAA-12345678')).to.eql(Buffer.from(HEX_KEY, 'hex'));
        });

        it('reads a key written as 16 plain characters', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: PLAIN_KEY }], log);
            expect(keys.getKeyBuffer('AAA-12345678')).to.eql(Buffer.from(PLAIN_KEY, 'latin1'));
        });

        it('has none for a device that is not configured', () => {
            const keys = new AesKeys([], log);
            expect(keys.getKeyBuffer('AAA-12345678')).to.be.undefined;
            expect(log.lines.error).to.be.empty;
        });

        it('has none for a device that is only waiting for its key', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: KEY_PLACEHOLDER }], log);
            expect(keys.getKeyBuffer('AAA-12345678')).to.be.undefined;
            // the placeholder is not a broken key, it is a reminder
            expect(log.lines.error).to.be.empty;
        });

        it('rejects a key of the wrong length', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: 'too short' }], log);
            expect(keys.getKeyBuffer('AAA-12345678')).to.be.undefined;
            expect(log.lines.error).to.have.lengthOf(1);
        });

        it('rejects 32 characters that are not hex', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: 'z'.repeat(32) }], log);
            expect(keys.getKeyBuffer('AAA-12345678')).to.be.undefined;
            expect(log.lines.error).to.have.lengthOf(1);
        });

        it('reports a broken key once rather than with every telegram', () => {
            const keys = new AesKeys([{ id: 'AAA-12345678', key: 'too short' }], log);
            for (let i = 0; i < 5; i++) {
                keys.getKeyBuffer('AAA-12345678');
            }
            expect(log.lines.error).to.have.lengthOf(1);
        });
    });

    describe('the devices that need a key', () => {
        it('starts with the rows that are waiting for one', () => {
            const keys = new AesKeys(
                [
                    { id: 'AAA-12345678', key: KEY_PLACEHOLDER },
                    { id: 'BBB-87654321', key: HEX_KEY },
                ],
                log,
            );
            expect([...keys.needsKey]).to.eql(['AAA-12345678']);
        });

        it('takes note of a telegram that asked for a key', () => {
            const keys = new AesKeys([], log);
            keys.checkWrongKey('AAA-12345678', 'NO_AES_KEY');
            expect([...keys.needsKey]).to.eql(['AAA-12345678']);
        });

        it('ignores a telegram that failed for another reason', () => {
            const keys = new AesKeys([], log);
            keys.checkWrongKey('AAA-12345678', 'CRC_ERROR');
            expect([...keys.needsKey]).to.be.empty;
        });

        it('merges them into a key list', () => {
            const keys = new AesKeys([], log);
            keys.checkWrongKey('AAA-12345678', 'NO_AES_KEY');
            keys.checkWrongKey('BBB-87654321', 'NO_AES_KEY');

            const { aeskeys, added } = keys.mergeInto([{ id: 'CCC-11112222', key: HEX_KEY }]);

            expect(added).to.equal(2);
            expect(aeskeys).to.eql([
                { id: 'CCC-11112222', key: HEX_KEY },
                { id: 'AAA-12345678', key: KEY_PLACEHOLDER },
                { id: 'BBB-87654321', key: KEY_PLACEHOLDER },
            ]);
        });

        it('leaves a row that is already there alone', () => {
            const keys = new AesKeys([], log);
            keys.checkWrongKey('AAA-12345678', 'NO_AES_KEY');

            const { aeskeys, added } = keys.mergeInto([{ id: 'AAA-12345678', key: HEX_KEY }]);

            expect(added).to.equal(0);
            expect(aeskeys).to.eql([{ id: 'AAA-12345678', key: HEX_KEY }]);
        });

        it('does not write into the list it was given', () => {
            // the list comes from the open admin form, which keeps its own copy
            const keys = new AesKeys([], log);
            keys.checkWrongKey('AAA-12345678', 'NO_AES_KEY');

            const given = [];
            keys.mergeInto(given);

            expect(given).to.be.empty;
        });
    });
});
