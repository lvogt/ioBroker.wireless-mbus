'use strict';

const { expect } = require('chai');
const TelegramVariants = require('../src/lib/TelegramVariants').default;
const { MAX_VARIANTS_PER_DEVICE, PERSIST_INTERVAL, variantName } = require('../src/lib/TelegramVariants');

const DEVICE = 'LSE-58511882';
const STATES = ['1-0-VIF_TIME_POINT_DATE_TIME', '2-0-VIF_VOLUME'];
const START = new Date(2026, 8, 22, 10, 5).getTime();

/**
 * A variant as the object of a device keeps it.
 *
 * @param [overrides]
 */
function storedVariant(overrides = {}) {
    return {
        crc: 0x3a7f,
        frames: ['full'],
        states: STATES,
        firstSeen: START,
        lastSeen: START,
        count: 3,
        ...overrides,
    };
}

describe('Telegram variants', () => {
    /** @type {TelegramVariants} */
    let variants;
    beforeEach(() => {
        variants = new TelegramVariants([]);
    });

    it('are named by their crc in hex', () => {
        expect(variantName(0x3a7f)).to.equal('3A7F');
        expect(variantName(0x1f)).to.equal('001F');
    });

    describe('counting', () => {
        it('writes a new variant right away', () => {
            expect(variants.note(DEVICE, 0x3a7f, 'full', STATES, START)).to.be.true;

            expect(variants.nativeOf(DEVICE).telegramVariants).to.eql([
                { crc: 0x3a7f, frames: ['full'], states: STATES, firstSeen: START, lastSeen: START, count: 1 },
            ]);
        });

        it('counts a known variant without writing it every time', () => {
            variants.note(DEVICE, 0x3a7f, 'full', STATES, START);

            expect(variants.note(DEVICE, 0x3a7f, 'full', STATES, START + 1000)).to.be.false;

            const [variant] = variants.nativeOf(DEVICE).telegramVariants;
            expect(variant.count).to.equal(2);
            expect(variant.lastSeen).to.equal(START + 1000);
            expect(variant.firstSeen).to.equal(START);
        });

        it('writes the counters again after a while', () => {
            variants.note(DEVICE, 0x3a7f, 'full', STATES, START);

            expect(variants.note(DEVICE, 0x3a7f, 'full', STATES, START + PERSIST_INTERVAL)).to.be.true;
        });

        it('takes the compact telegrams of a layout for the same variant', () => {
            variants.note(DEVICE, 0x3a7f, 'full', STATES, START);

            expect(variants.note(DEVICE, 0x3a7f, 'compact', STATES, START + 1000)).to.be.true;
            expect(variants.nativeOf(DEVICE).telegramVariants).to.have.lengthOf(1);
            expect(variants.nativeOf(DEVICE).telegramVariants[0].frames).to.eql(['full', 'compact']);
        });

        it('drops the variant seen least recently of a meter that keeps changing its layout', () => {
            for (let crc = 0; crc < MAX_VARIANTS_PER_DEVICE; crc++) {
                variants.note(DEVICE, crc, 'full', STATES, START + crc);
            }
            // the first one turns up again before another one arrives
            variants.note(DEVICE, 0, 'full', STATES, START + 100);
            variants.note(DEVICE, 99, 'full', STATES, START + 200);

            const crcs = variants.nativeOf(DEVICE).telegramVariants.map(variant => variant.crc);
            expect(crcs).to.have.lengthOf(MAX_VARIANTS_PER_DEVICE);
            expect(crcs).to.include(0).and.to.include(99);
            expect(crcs).to.not.include(1);
        });
    });

    describe('what a device object kept', () => {
        it('is taken over', () => {
            variants.add(DEVICE, { telegramVariants: [storedVariant()] });

            variants.note(DEVICE, 0x3a7f, 'full', STATES, START + 1000);

            expect(variants.nativeOf(DEVICE).telegramVariants[0].count).to.equal(4);
        });

        it('is not written back right after the start', () => {
            variants.add(DEVICE, { telegramVariants: [storedVariant()] });

            expect(variants.note(DEVICE, 0x3a7f, 'full', STATES)).to.be.false;
        });

        it('leaves out what is no variant', () => {
            variants.add(DEVICE, {
                telegramVariants: [storedVariant(), { crc: 'abc' }, null, storedVariant({ crc: 1, frames: ['x'] })],
            });

            expect(variants.nativeOf(DEVICE).telegramVariants).to.eql([storedVariant()]);
        });

        it('is nothing for a device object without variants', () => {
            variants.add(DEVICE, { dataRecordHeaders: [] });

            expect(variants.nativeOf(DEVICE).telegramVariants).to.eql([]);
        });
    });

    describe('the configured variants to ignore', () => {
        it('are matched by device and variant', () => {
            variants = new TelegramVariants([{ id: DEVICE, variant: '3A7F' }]);

            expect(variants.isIgnored(DEVICE, 0x3a7f)).to.be.true;
            expect(variants.isIgnored(DEVICE, 0x3a70)).to.be.false;
            expect(variants.isIgnored('CEN-12345678', 0x3a7f)).to.be.false;
        });

        it('may be written in lower case, with 0x or without leading zeros', () => {
            variants = new TelegramVariants([
                { id: ` ${DEVICE} `, variant: '0x3a7f' },
                { id: DEVICE, variant: '1f' },
            ]);

            expect(variants.isIgnored(DEVICE, 0x3a7f)).to.be.true;
            expect(variants.isIgnored(DEVICE, 0x1f)).to.be.true;
        });

        it('leave out a row that names no variant', () => {
            variants = new TelegramVariants([{ id: DEVICE, variant: 'xyz' }, { id: '', variant: '3A7F' }, {}]);

            expect(variants.isIgnored(DEVICE, 0x3a7f)).to.be.false;
            expect(variants.isIgnored('', 0x3a7f)).to.be.false;
        });

        it('can be missing altogether', () => {
            variants = new TelegramVariants(undefined);

            expect(variants.isIgnored(DEVICE, 0x3a7f)).to.be.false;
        });
    });

    describe('the rows of the admin UI', () => {
        beforeEach(() => {
            variants.note('KAM-60723506', 0x1111, 'full', ['1-0-VIF_ENERGY_WATT'], START);
            variants.note(DEVICE, 0x3a7f, 'full', STATES, START);
            variants.note(DEVICE, 0x3a7f, 'compact', STATES, START + 60000);
            variants.note(DEVICE, 0x0042, 'full', ['2-0-VIF_FLOW_TEMP'], START + 120000);
        });

        it('are sorted by device, with the variant seen last first', () => {
            const rows = variants.rows([]);

            expect(rows.map(row => `${row.device}/${row.variant}`)).to.eql([
                'KAM-60723506/1111',
                `${DEVICE}/0042`,
                `${DEVICE}/3A7F`,
            ]);
        });

        it('say what was seen', () => {
            const row = variants.rows([]).find(entry => entry.variant === '3A7F');

            expect(row).to.eql({
                device: DEVICE,
                variant: '3A7F',
                frames: 'full, compact',
                telegrams: 2,
                firstSeen: '2026-09-22 10:05',
                lastSeen: '2026-09-22 10:06',
                states: '1-0-VIF_TIME_POINT_DATE_TIME, 2-0-VIF_VOLUME',
                ignored: '',
            });
        });

        it('mark what the given list ignores, not what the instance ignores', () => {
            variants = new TelegramVariants([{ id: DEVICE, variant: '0042' }]);
            variants.note(DEVICE, 0x0042, 'full', STATES, START);
            variants.note(DEVICE, 0x3a7f, 'full', STATES, START);

            const ignored = variants.rows([{ id: DEVICE, variant: '3a7f' }]).filter(row => row.ignored);

            expect(ignored.map(row => row.variant)).to.eql(['3A7F']);
        });
    });
});
