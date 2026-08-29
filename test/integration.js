const path = require('node:path');
const fs = require('node:fs');
const { tests } = require('@iobroker/testing');
const { expect } = require('chai');
const net = require('node:net');

const port = 5000;

function copyMocks(harness) {
    // The published package does not contain test/, so the mocks have to be
    // copied into the installed adapter before the receivers can use them.
    fs.mkdirSync(`${harness.testAdapterDir}/test/receiver`, { recursive: true });
    const files = fs.readdirSync(`${harness.adapterDir}/test/receiver`, { withFileTypes: true });
    files.forEach(file => {
        if (file.isDirectory()) {
            return;
        }

        fs.writeFileSync(
            `${harness.testAdapterDir}/test/receiver/${file.name}`,
            fs.readFileSync(`${harness.adapterDir}/test/receiver/${file.name}`),
        );
    });
}

async function prepareAdapter(harness) {
    try {
        await harness.objects.getObject('system.adapter.wireless-mbus.0', async (err, obj) => {
            obj.native.deviceType = 'TcpReceiver.js';
            obj.native.serialPort = port;
            obj.native.aeskeys = [
                { id: 'ELS-1234567', key: 'FFF102030405060708090A0B0C0D0E0F' },
                { id: 'ELS-12345678', key: '000102030405060708090A0B0C0D0E0F' },
                { id: 'RAD-112233', key: '000102030405060708090A0B0C0D0E0F' },
            ];
            obj.native.blacklist = [{ id: 'SEN-20222542' }];
            harness.objects.setObject(obj._id, obj);
        });
    } catch (e) {
        console.dir(e);
    }
}

async function prepareAdapterWithMock(harness, mockType, forceFail) {
    try {
        await harness.objects.getObject('system.adapter.wireless-mbus.0', async (err, obj) => {
            const classFile = fs.readFileSync(`${harness.testAdapterDir}/lib/receiver/SerialDevice.js`, 'utf-8');
            // relative to lib/receiver/SerialDevice.js, where the require lives
            const patchedClass = classFile.replace("'serialport'", `'../../test/receiver/${mockType}DeviceMock'`);
            fs.writeFileSync(`${harness.testAdapterDir}/lib/receiver/SerialDevice.js`, patchedClass);

            if (forceFail) {
                if (mockType === 'Cul') {
                    obj.native.deviceType = 'amber';
                } else {
                    obj.native.deviceType = 'cul';
                }
            } else {
                obj.native.deviceType = mockType.toLowerCase();
            }
            obj.native.serialPort = '/dev/mockPort';
            harness.objects.setObject(obj._id, obj);
        });
    } catch (e) {
        console.dir(e);
    }
}

// harness.objects/states use node-style callbacks. Wrapping them here keeps
// the assertions in the async test body, where a failing expect() rejects the
// test properly instead of being swallowed by a promise executor.
function getObject(harness, id) {
    return new Promise((resolve, reject) => {
        harness.objects.getObject(id, (err, obj) => (err ? reject(new Error(`Error return ${err}`)) : resolve(obj)));
    });
}

function getState(harness, id) {
    return new Promise((resolve, reject) => {
        harness.states.getState(id, (err, state) => (err ? reject(new Error(`Error return ${err}`)) : resolve(state)));
    });
}

function sendToAdapter(harness, command, message) {
    return new Promise(resolve => harness.sendTo('wireless-mbus.0', command, message, resolve));
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function sendTelegram(telegram) {
    return new Promise(function (resolve) {
        const client = new net.Socket();
        client.on('connect', () => {
            client.write(JSON.stringify(telegram));
            client.end();
            resolve(true);
        });

        setTimeout(() => {
            client.connect({ port: port, host: '127.0.0.1' });
        }, 1000);
    });
}

tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],

    defineAdditionalTests({ suite }) {
        const testedReceiver = ['Amber', 'Cul', 'Ebi', 'Imst', 'ImstV2', 'Simple'][Math.floor(Math.random() * 6)];

        suite('Test receiver with mocks', getHarness => {
            it(`Test ${testedReceiver}`, async () => {
                const harness = getHarness();

                copyMocks(harness);
                await prepareAdapterWithMock(harness, testedReceiver);
                await harness.startAdapterAndWait();

                await delay(2000);

                const state = await getState(harness, 'wireless-mbus.0.info.connection');
                expect(state.ack).to.be.true;
                expect(state.val).to.equal(true);
            }).timeout(10000);
        });

        suite('Test receiver with mocks', getHarness => {
            it('Test receiver fails', async () => {
                const harness = getHarness();

                await prepareAdapterWithMock(harness, testedReceiver, true);
                await harness.startAdapterAndWait();

                await delay(2000);

                const state = await getState(harness, 'wireless-mbus.0.info.connection');
                expect(state.ack).to.be.true;
                expect(state.val).to.equal(false);
            }).timeout(10000);
        });

        suite('Test sendTo()', getHarness => {
            let harness;
            before(async () => {
                harness = getHarness();
                await prepareAdapter(harness);
                await harness.startAdapterAndWait();
            });

            it('Test listUart', async () => {
                const ports = await sendToAdapter(harness, 'listUart', null);
                expect(ports).to.have.lengthOf.at.least(0);
            }).timeout(10000);

            it('Test listReceiver', async () => {
                await delay(2000);

                // jsonConfig selectSendTo expects [{ label, value }]
                const receivers = await sendToAdapter(harness, 'listReceiver', null);
                expect(receivers).to.be.an('array');
                expect(receivers.map(r => r.value).sort()).to.eql(['amber', 'cul', 'ebi', 'imst', 'imstv2', 'simple']);
                receivers.forEach(r => expect(r.label).to.be.a('string').and.not.be.empty);
            }).timeout(15000);

            it('Test listWmbusMode', async () => {
                const modes = await sendToAdapter(harness, 'listWmbusMode', { deviceType: 'amber' });
                expect(modes.map(m => m.value).sort()).to.eql(['C', 'CT', 'S', 'T']);

                const unknown = await sendToAdapter(harness, 'listWmbusMode', { deviceType: 'nope' });
                expect(unknown).to.eql([]);
            }).timeout(15000);

            it('Test needsKey', async () => {
                const telegram = {
                    frameType: 'A',
                    containsCrc: false,
                    data: '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689',
                };
                await sendTelegram(telegram);

                await delay(2000);

                const devices = await sendToAdapter(harness, 'needsKey', null);
                expect(devices).to.have.lengthOf(1);
                expect(devices[0]).to.equal('KAM-63452869');
            }).timeout(15000);
        });

        suite('Test telegrams', getHarness => {
            let harness;
            before(async () => {
                harness = getHarness();
                await prepareAdapter(harness);
                await harness.startAdapterAndWait();
            });

            it('Test telegram', async () => {
                const telegram = {
                    frameType: 'B',
                    containsCrc: true,
                    data: '1444AE0C7856341201078C2027780B134365877AC5',
                };
                await sendTelegram(telegram);

                await delay(2000);

                const obj = await getObject(harness, 'wireless-mbus.0.CEN-12345678.data.1-0-VIF_VOLUME');
                expect(obj.type).to.equal('state');
                expect(obj.common.unit).to.equal('m³');
            }).timeout(10000);

            it('Test encrypted telegram', async () => {
                const telegram = {
                    frameType: 'A',
                    containsCrc: true,
                    data: '434493157856341233037AC98C2075900F002C25B30A000021924D4FBA372FB66E017A75002007109058475F4BC9D1281DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1',
                };
                await sendTelegram(telegram);

                await delay(2000);

                const obj = await getObject(harness, 'wireless-mbus.0.ELS-12345678');
                expect(obj.type).to.equal('device');
                expect(obj.common.name).to.equal('ELS-12345678');
            }).timeout(10000);
        });

        suite('Test telegrams', getHarness => {
            it('Test encrypted telegram with radio adapter', async () => {
                const harness = getHarness();

                await prepareAdapter(harness);
                await harness.startAdapterAndWait();

                const telegram = {
                    frameType: 'A',
                    containsCrc: true,
                    data: '53082448443322110337D0468E80753A63665544330A31900F002C25E00AB30A0000AF5D74DF73A600D972785634C027129315330375002007109058475F4BC955CF1DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1',
                };
                await sendTelegram(telegram);

                await delay(2000);

                const obj = await getObject(harness, 'wireless-mbus.0.ELS-12345678');
                expect(obj.type).to.equal('device');
                expect(obj.common.name).to.equal('ELS-12345678');
            }).timeout(10000);
        });

        suite('Other tests', getHarness => {
            let harness;
            before(async () => {
                harness = getHarness();
                await prepareAdapter(harness);
                await harness.startAdapterAndWait();
            });

            it('Test wmbus decoder failed', async () => {
                const telegramCutOff = {
                    frameType: 'A',
                    containsCrc: true,
                    data: '53082448443322110337D0468E80753A63665544',
                };

                await sendTelegram(telegramCutOff);
                await delay(2000);

                const state = await getState(harness, 'wireless-mbus.0.info.rawdata');
                expect(state.ack).to.be.true;
                expect(state.val.toUpperCase()).to.equal('53082448443322110337D0468E80753A63665544');
            }).timeout(10000);

            it('Test blocking of device', async () => {
                const telegram = {
                    frameType: 'A',
                    containsCrc: false,
                    data: '1844AE4C4225222068077A670000000413CFE20100023B0000',
                };

                await sendTelegram(telegram);
                await delay(2000);

                const obj = await getObject(harness, 'wireless-mbus.0.SEN-20222542');
                expect(obj, 'Device should have been rejected!').to.be.null;
            }).timeout(10000);

            it('Test temporary block of device', async () => {
                const telegramCutOff = {
                    frameType: 'A',
                    containsCrc: true,
                    data: '53082448443322110337D0468E80753A63665544',
                };

                for (let i = 0; i < 10; i++) {
                    await sendTelegram(telegramCutOff);
                    await delay(2000);
                }

                const telegram = {
                    frameType: 'A',
                    containsCrc: true,
                    data: '53082448443322110337D0468E80753A63665544330A31900F002C25E00AB30A0000AF5D74DF73A600D972785634C027129315330375002007109058475F4BC955CF1DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1',
                };

                await sendTelegram(telegram);
                await delay(2000);

                const obj = await getObject(harness, 'wireless-mbus.0.ELS-12345678');
                expect(obj, 'Device should have been rejected!').to.be.null;
            }).timeout(60000);
        });
    },
});
