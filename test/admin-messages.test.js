'use strict';

const { expect } = require('chai');
const AdminMessages = require('../src/lib/AdminMessages').default;
const AesKeys = require('../src/lib/AesKeys').default;
const TelegramVariants = require('../src/lib/TelegramVariants').default;
const { KEY_PLACEHOLDER } = require('../src/lib/AesKeys');
const { listReceivers } = require('../src/lib/receiver');

/** @type {any} */
const silentLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * An adapter that only remembers what was sent through the message box.
 *
 * @param [config] what the instance has saved
 */
function fakeAdapter(config = {}) {
    return {
        config,
        log: silentLog,
        /** @type {any[]} */
        sent: [],
        sendTo(from, command, answer, callback) {
            this.sent.push({ from, command, answer, callback });
        },
    };
}

/** A message as the admin UI sends it. */
function request(command, message) {
    return { from: 'system.adapter.admin.0', command, message, callback: { id: 1 } };
}

describe('Admin messages', () => {
    let adapter;
    let aesKeys;
    let messages;

    beforeEach(() => {
        adapter = fakeAdapter();
        aesKeys = new AesKeys([], silentLog);
        messages = new AdminMessages(/** @type {any} */ (adapter), aesKeys, new TelegramVariants([]));
    });

    /** The answer of one command, once it has been sent. */
    async function ask(command, message) {
        messages.handle(/** @type {any} */ (request(command, message)));
        // the dispatch always goes through a promise, even for a sync handler
        await new Promise(resolve => setImmediate(resolve));
        return adapter.sent[0] && adapter.sent[0].answer;
    }

    describe('the dispatch', () => {
        it('answers with the callback of the message', async () => {
            await ask('needsKey');
            expect(adapter.sent).to.have.lengthOf(1);
            expect(adapter.sent[0].from).to.equal('system.adapter.admin.0');
            expect(adapter.sent[0].command).to.equal('needsKey');
            expect(adapter.sent[0].callback).to.eql({ id: 1 });
        });

        it('leaves a command it does not know alone', async () => {
            expect(await ask('somethingElse')).to.be.undefined;
            expect(adapter.sent).to.be.empty;
        });

        it('leaves a message without a callback alone', async () => {
            messages.handle(/** @type {any} */ ({ from: 'x', command: 'needsKey' }));
            await new Promise(resolve => setImmediate(resolve));
            expect(adapter.sent).to.be.empty;
        });

        it('reports a handler that throws instead of letting it escape', async () => {
            const errors = [];
            adapter.log = { ...silentLog, error: msg => errors.push(msg) };
            messages.listWmbusModeOptions = () => {
                throw new Error('boom');
            };

            expect(await ask('listWmbusMode', { deviceType: 'amber' })).to.be.undefined;
            expect(adapter.sent).to.be.empty;
            expect(errors).to.have.lengthOf(1);
            expect(errors[0]).to.contain('listWmbusMode').and.contain('boom');
        });
    });

    describe('the lists the admin UI offers', () => {
        it('offers every receiver with its name', async () => {
            const answer = await ask('listReceiver');
            expect(answer.map(option => option.value).sort()).to.eql(Object.keys(listReceivers()).sort());
            expect(answer.every(option => typeof option.label === 'string' && option.label.length)).to.be.true;
        });

        it('offers the modes of one receiver', async () => {
            const answer = await ask('listWmbusMode', { deviceType: 'amber' });
            expect(answer.map(option => option.value)).to.eql(Object.keys(listReceivers().amber.modes));
        });

        it('offers no mode at all for a receiver it does not know', async () => {
            expect(await ask('listWmbusMode', { deviceType: 'nope' })).to.eql([]);
            expect(await ask('listWmbusMode', {})).to.eql([]);
        });
    });

    describe('the devices that need a key', () => {
        beforeEach(() => {
            aesKeys.checkWrongKey('AAA-12345678', 'NO_AES_KEY');
        });

        it('lists them as an array, which survives the message box', async () => {
            const answer = await ask('needsKey');
            expect(answer).to.eql(['AAA-12345678']);
            expect(() => JSON.stringify(answer)).to.not.throw();
        });

        it('merges them into the list of the open form', async () => {
            // not into the saved one: rows typed since the last save would be lost
            adapter.config.aeskeys = [{ id: 'SAVED-00000000', key: 'a'.repeat(32) }];
            const answer = await ask('importNeedsKey', { aeskeys: [{ id: 'TYPED-11111111', key: '' }] });

            expect(answer.native.aeskeys).to.eql([
                { id: 'TYPED-11111111', key: '' },
                { id: 'AAA-12345678', key: KEY_PLACEHOLDER },
            ]);
            expect(answer.result).to.equal('devicesAdded');
            expect(answer.args).to.eql([1]);
        });

        it('falls back to the saved list when the form sends none', async () => {
            adapter.config.aeskeys = [{ id: 'SAVED-00000000', key: 'a'.repeat(32) }];
            const answer = await ask('importNeedsKey', {});
            expect(answer.native.aeskeys.map(row => row.id)).to.eql(['SAVED-00000000', 'AAA-12345678']);
        });

        it('says so when there is nothing to add', async () => {
            const answer = await ask('importNeedsKey', { aeskeys: [{ id: 'AAA-12345678', key: '' }] });
            expect(answer.result).to.equal('noNewDevices');
            expect(answer.args).to.eql([0]);
        });
    });

    describe('the description editor', () => {
        const DESCRIPTION = JSON.stringify({
            ABC: [{ name: 'Test', byte: 0, type: 'uint8', vif: 0x13 }],
        });

        it('reports what the parser makes of the descriptions of the form', async () => {
            const answer = await ask('checkManufacturerSpecific', { descriptions: DESCRIPTION });
            expect(answer.result).to.contain('ABC');
        });

        it('says so when nothing is configured', async () => {
            expect((await ask('checkManufacturerSpecific', { descriptions: '' })).result).to.contain('No description');
        });

        it('reports descriptions that are not readable at all', async () => {
            const answer = await ask('checkManufacturerSpecific', { descriptions: 'not json' });
            expect(answer.result).to.contain('The descriptions are');
        });

        it('hands out an example while the editor is empty', async () => {
            const answer = await ask('exampleManufacturerSpecific', { descriptions: '' });
            expect(answer.native.manufacturerSpecific).to.be.a('string').and.not.be.empty;
        });

        it('never writes over a description somebody typed', async () => {
            for (const descriptions of [DESCRIPTION, 'not json']) {
                adapter.sent = [];
                const answer = await ask('exampleManufacturerSpecific', { descriptions });
                expect(answer.native, String(descriptions)).to.be.undefined;
                expect(answer.result).to.contain('already');
            }
        });
    });

    describe('the telegram preview', () => {
        // a smoke detector, whose manufacturer specific blob is what the
        // description below gets the battery age out of
        const SMOKE_DETECTOR =
            '4e44972678563412001a7a211300002f2f066d1220ee483200077f80802002533e170c' +
            '0f0000010100000101000001012927283418311b39000001010000010100000000' +
            '14310f370d00460100002f';

        it('answers with the states a telegram would write', async () => {
            const answer = await ask('previewManufacturerSpecific', {
                telegram: SMOKE_DETECTOR,
                descriptions: '',
            });

            expect(answer.result).to.equal('manufacturerSpecificPreviewOk');
            expect(answer.native.manufacturerSpecificPreview).to.not.be.empty;
            for (const row of answer.native.manufacturerSpecificPreview) {
                expect(row.state).to.match(/^ITW-12345678\.data\./);
            }
        });

        it('does not claim a description produced what the parser decodes itself', async () => {
            // this meter's blob has a handler in the parser, so its values turn
            // up with no description configured at all
            const answer = await ask('previewManufacturerSpecific', {
                telegram: SMOKE_DETECTOR,
                descriptions: '',
            });

            const rows = answer.native.manufacturerSpecificPreview;
            expect(rows.filter(row => row.source === 'manufacturer')).to.not.be.empty;
            for (const row of rows) {
                expect(row.source).to.be.oneOf(['telegram', 'manufacturer']);
            }
        });

        it('tells the records of the telegram from what a description derived', async () => {
            const answer = await ask('previewManufacturerSpecific', {
                telegram: SMOKE_DETECTOR,
                descriptions: JSON.stringify({
                    ITW: [{ byte: 4, description: 'Battery', unit: 'month', legacyName: 'VIF_BATTERY_MONTHS' }],
                }),
            });

            const rows = answer.native.manufacturerSpecificPreview;
            const derived = rows.filter(row => row.source === 'manufacturer');

            expect(answer.result).to.equal('manufacturerSpecificPreviewOk');
            // the argument is what the control reports as the number of them
            expect(answer.args).to.eql([derived.length]);
            expect(derived).to.have.lengthOf(1);
            expect(derived[0].state).to.equal('ITW-12345678.data.3-0-VIF_BATTERY_MONTHS');
            expect(derived[0].unit).to.equal('month');
            // the derived rows come behind the records of the telegram
            expect(rows.indexOf(derived[0])).to.equal(rows.length - 1);
        });

        it('says so when there is no telegram to decode', async () => {
            for (const telegram of [undefined, '', 'not hex', 'abc']) {
                adapter.sent = [];
                const answer = await ask('previewManufacturerSpecific', { telegram });
                expect(answer.result, String(telegram)).to.equal('manufacturerSpecificNoTelegram');
                expect(answer.native.manufacturerSpecificPreview).to.be.empty;
            }
        });

        it('reports a telegram the parser cannot decode', async () => {
            const answer = await ask('previewManufacturerSpecific', { telegram: 'deadbeef' });
            expect(answer.result).to.equal('manufacturerSpecificReport');
            expect(answer.args[0]).to.contain('could not be decoded');
        });

        it('reports descriptions that are not readable at all', async () => {
            const answer = await ask('previewManufacturerSpecific', {
                telegram: 'deadbeef',
                descriptions: 'not json',
            });
            expect(answer.result).to.equal('manufacturerSpecificReport');
            expect(answer.args[0]).to.contain('The descriptions are');
        });
    });

    describe('the telegram variants', () => {
        it('are listed into the table of the form', async () => {
            const variants = new TelegramVariants([]);
            variants.note('LSE-58511882', 0x3a7f, 'full', ['2-0-VIF_VOLUME']);
            variants.note('LSE-58511882', 0x0042, 'full', ['2-0-VIF_FLOW_TEMP']);
            messages = new AdminMessages(/** @type {any} */ (adapter), aesKeys, variants);

            const answer = await ask('listTelegramVariants', { ignored: [{ id: 'LSE-58511882', variant: '0042' }] });

            expect(answer.result).to.equal('telegramVariantsListed');
            expect(answer.args).to.eql([2, 1]);
            expect(answer.native.telegramVariants.map(row => [row.variant, row.ignored])).to.have.deep.members([
                ['3A7F', ''],
                ['0042', '✓'],
            ]);
        });

        it('say so when there are none yet', async () => {
            const answer = await ask('listTelegramVariants', {});

            expect(answer.result).to.equal('telegramVariantsNone');
            expect(answer.native).to.eql({ telegramVariants: [] });
        });
    });
});
