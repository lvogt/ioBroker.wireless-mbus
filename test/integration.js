const path = require('node:path');
const fs = require('node:fs');
const { tests } = require('@iobroker/testing');
const { expect } = require('chai');
const net = require('node:net');

// The receiver of the adapter under test listens on these; WMBUS_TEST_PORT
// moves them out of the way of anything else that holds 5000, a dev-server
// configured for the TCP receiver for instance
const port = Number(process.env.WMBUS_TEST_PORT) || 5000;
const culPort = port + 99;

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

async function prepareAdapter(harness, native = {}) {
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
            Object.assign(obj.native, native);
            harness.objects.setObject(obj._id, obj);
        });
    } catch (e) {
        console.dir(e);
    }
}

/** A device object as an earlier run of the adapter would have left it behind */
function createDeviceObject(harness, deviceId) {
    return new Promise((resolve, reject) =>
        harness.objects.setObject(
            `wireless-mbus.0.${deviceId}`,
            { type: 'device', common: { name: deviceId }, native: {} },
            err => (err ? reject(new Error(`Error return ${err}`)) : resolve(true)),
        ),
    );
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

/**
 * A receiver that answers the two commands a CUL sends while it initialises,
 * and nothing else.
 *
 * @returns a function that stops it again - the adapter keeps its connection
 * open, so the sockets have to go before the server can close
 */
async function startCulServer() {
    /** @type {net.Socket[]} */
    const sockets = [];

    const server = net.createServer(socket => {
        sockets.push(socket);
        socket.on('data', data => {
            const command = data.toString('ascii');
            if (command.startsWith('V')) {
                socket.write('V 1.30 CUL868\r\n');
            } else if (command.includes('br')) {
                socket.write('TMODE\r\n');
            }
        });
    });

    await new Promise(resolve => server.listen(culPort, '127.0.0.1', () => resolve(true)));

    return async () => {
        sockets.forEach(socket => socket.destroy());
        await new Promise(resolve => server.close(() => resolve(true)));
    };
}

async function prepareAdapterForCulOverTcp(harness) {
    return new Promise(resolve =>
        harness.objects.getObject('system.adapter.wireless-mbus.0', (err, obj) => {
            obj.native.deviceType = 'cul';
            obj.native.wmbusMode = 'T';
            obj.native.serialPort = `tcp://127.0.0.1:${culPort}`;
            harness.objects.setObject(obj._id, obj, () => resolve(true));
        }),
    );
}

tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],

    defineAdditionalTests({ suite }) {
        // One receiver per run keeps it short, but a change to the framing has
        // to be tried with every one of them: WMBUS_TEST_RECEIVER picks the one
        // to use instead of leaving it to chance.
        const receivers = ['Amber', 'Cul', 'Ebi', 'Imst', 'ImstV2', 'Simple'];
        const pinnedReceiver = process.env.WMBUS_TEST_RECEIVER;
        const testedReceiver =
            pinnedReceiver && receivers.includes(pinnedReceiver)
                ? pinnedReceiver
                : receivers[Math.floor(Math.random() * receivers.length)];

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

        suite('Test reconnect', getHarness => {
            it('connects on a later attempt once the receiver answers', async () => {
                const harness = getHarness();
                await prepareAdapterForCulOverTcp(harness);

                // Nothing is listening yet, so the first attempt has to fail
                await harness.startAdapterAndWait();
                await delay(2500);
                expect((await getState(harness, 'wireless-mbus.0.info.connection')).val).to.equal(false);

                // The receiver comes back - the first retry is five seconds out
                const stopCulServer = await startCulServer();
                await delay(9000);

                const connected = (await getState(harness, 'wireless-mbus.0.info.connection')).val;
                await stopCulServer();

                expect(connected, 'the adapter never tried again').to.equal(true);
            }).timeout(40000);
        });

        suite('Test reconnect after a drop', getHarness => {
            it('connects again after the connection was lost', async () => {
                const harness = getHarness();
                await prepareAdapterForCulOverTcp(harness);

                let stopCulServer = await startCulServer();
                await harness.startAdapterAndWait();
                await delay(2500);
                expect((await getState(harness, 'wireless-mbus.0.info.connection')).val).to.equal(true);

                // The receiver goes away - and the adapter must notice, rather
                // than reporting a connection it no longer has
                await stopCulServer();
                await delay(1500);
                expect((await getState(harness, 'wireless-mbus.0.info.connection')).val).to.equal(false);

                // ... and comes back
                stopCulServer = await startCulServer();
                await delay(9000);

                const connected = (await getState(harness, 'wireless-mbus.0.info.connection')).val;
                await stopCulServer();

                expect(connected, 'the adapter did not come back').to.equal(true);
            }).timeout(60000);
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

            it('Test importNeedsKey', async () => {
                // The list to merge into is the one in the open form, not the
                // saved configuration: what the user has typed since the last
                // save has to survive, and a saved key the running instance
                // has not picked up yet must not disappear either
                const typed = [{ id: 'ELS-7654321', key: 'FFF102030405060708090A0B0C0D0E0F' }];

                const response = await sendToAdapter(harness, 'importNeedsKey', { aeskeys: typed });

                expect(response.native.aeskeys).to.eql([
                    { id: 'ELS-7654321', key: 'FFF102030405060708090A0B0C0D0E0F' },
                    { id: 'KAM-63452869', key: 'UNKNOWN' },
                ]);
                expect(response.result).to.equal('devicesAdded');
                expect(response.args).to.eql([1]);
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

        suite('Test unknown devices', getHarness => {
            it('only handles devices that already have an object tree', async () => {
                const harness = getHarness();

                await prepareAdapter(harness, { ignoreUnknownDevices: true });
                // the devices of the object tree are read when the adapter
                // starts, so this one has to be there before
                await createDeviceObject(harness, 'LSE-58511882');
                await harness.startAdapterAndWait();

                await sendTelegram({
                    frameType: 'A',
                    containsCrc: false,
                    data: '2C446532821851582C067AE1000000046D1906D9180C1334120000426CBF1C4C1300000000326CFFFF01FD7300',
                });
                await delay(2000);

                const known = await getState(harness, 'wireless-mbus.0.LSE-58511882.data.2-0-VIF_VOLUME');
                expect(known.val, 'the known device was not updated').to.be.closeTo(1.234, 0.001);

                await sendTelegram({
                    frameType: 'B',
                    containsCrc: true,
                    data: '1444AE0C7856341201078C2027780B134365877AC5',
                });
                await delay(2000);

                const unknown = await getObject(harness, 'wireless-mbus.0.CEN-12345678');
                expect(unknown, 'the unknown device should not have been created').to.be.null;

                // ... and a device the adapter cannot decode is just as much
                // none of the user's business
                await sendTelegram({
                    frameType: 'A',
                    containsCrc: false,
                    data: '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689',
                });
                await delay(2000);

                const waiting = await sendToAdapter(harness, 'needsKey', null);
                expect(waiting, 'an unknown device was queued for a key').to.be.empty;

                const rawdata = await getState(harness, 'wireless-mbus.0.info.rawdata');
                expect(rawdata && rawdata.val, 'the telegram of an unknown device was published').to.not.be.ok;
            }).timeout(30000);
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
