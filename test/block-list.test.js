'use strict';

const { expect } = require('chai');
const BlockList = require('../src/lib/BlockList').default;
const { AUTO_BLOCK_AFTER_FAILURES } = require('../src/lib/BlockList');

/** Collects what was logged, so the quiet blocking can be told apart. */
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

describe('Block list', () => {
    let log;

    beforeEach(() => {
        log = recordingLog();
    });

    describe('the configured list', () => {
        it('blocks a device that is on it', () => {
            const list = new BlockList([{ id: 'AAA-12345678' }], {}, log);
            expect(list.isBlocked('AAA-12345678')).to.be.true;
            expect(list.isBlocked('AAA-87654321')).to.be.false;
        });

        it('survives a configuration that has no list at all', () => {
            for (const configured of [undefined, null, 'nonsense', {}]) {
                const list = new BlockList(/** @type {any} */ (configured), {}, log);
                expect(list.isBlocked('AAA-12345678'), String(configured)).to.be.false;
            }
        });

        it('ignores rows without an id', () => {
            const list = new BlockList([{}, { id: 'AAA-12345678' }], {}, log);
            expect(list.isBlocked('AAA-12345678')).to.be.true;
        });

        it('matches the whole id, not a prefix of it', () => {
            // unlike the key list, where a prefix stands for a series of meters
            const list = new BlockList([{ id: 'AAA-1234' }], {}, log);
            expect(list.isBlocked('AAA-12345678')).to.be.false;
        });
    });

    describe('the automatic list', () => {
        it('blocks a device after enough failures in a row', () => {
            const list = new BlockList([], { auto: true }, log);

            for (let i = 1; i < AUTO_BLOCK_AFTER_FAILURES; i++) {
                list.noteFailure('AAA-12345678');
                expect(list.isBlocked('AAA-12345678'), `after ${i} failure(s)`).to.be.false;
            }

            list.noteFailure('AAA-12345678');
            expect(list.isBlocked('AAA-12345678')).to.be.true;
            expect(log.lines.warn).to.have.lengthOf(1);
        });

        it('counts only failures in a row', () => {
            const list = new BlockList([], { auto: true }, log);

            for (let i = 0; i < AUTO_BLOCK_AFTER_FAILURES - 1; i++) {
                list.noteFailure('AAA-12345678');
            }
            list.noteSuccess('AAA-12345678');
            list.noteFailure('AAA-12345678');

            expect(list.isBlocked('AAA-12345678')).to.be.false;
        });

        it('counts every device for itself', () => {
            const list = new BlockList([], { auto: true }, log);

            for (let i = 0; i < AUTO_BLOCK_AFTER_FAILURES; i++) {
                list.noteFailure('AAA-12345678');
                list.noteFailure('BBB-87654321');
                list.noteSuccess('BBB-87654321');
            }

            expect(list.isBlocked('AAA-12345678')).to.be.true;
            expect(list.isBlocked('BBB-87654321')).to.be.false;
        });

        it('does nothing at all while it is switched off', () => {
            const list = new BlockList([], { auto: false }, log);

            for (let i = 0; i < AUTO_BLOCK_AFTER_FAILURES * 2; i++) {
                list.noteFailure('AAA-12345678');
            }

            expect(list.isBlocked('AAA-12345678')).to.be.false;
            expect(log.lines.warn).to.be.empty;
        });

        it('says so once rather than with every further telegram', () => {
            const list = new BlockList([], { auto: true }, log);

            for (let i = 0; i < AUTO_BLOCK_AFTER_FAILURES * 3; i++) {
                list.noteFailure('AAA-12345678');
            }

            expect(log.lines.warn).to.have.lengthOf(1);
        });

        it('blocks without a word when the device is to be ignored', () => {
            const list = new BlockList([], { auto: true }, log);

            for (let i = 0; i < AUTO_BLOCK_AFTER_FAILURES; i++) {
                list.noteFailure('AAA-12345678', true);
            }

            expect(list.isBlocked('AAA-12345678')).to.be.true;
            expect(log.lines.warn).to.be.empty;
            expect(log.lines.debug).to.have.lengthOf(1);
        });
    });
});
