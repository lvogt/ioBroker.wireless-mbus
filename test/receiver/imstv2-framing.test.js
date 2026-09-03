'use strict';

const { expect } = require('chai');
const HciMessageV2 = require('../../lib/receiver/HciMessageV2');
const ImstV2Receiver = require('../../lib/receiver/ImstV2Receiver');

/*
 * Regression tests for the SLIP framing of the IMST iU891A-XL receiver.
 *
 * Issues #308 and #309: a truncated telegram frame - the device drops bytes
 * when many meters transmit at once, and an adapter restart starts reading in
 * the middle of a frame - used to take the frame behind it down as well,
 * because extracting a frame consumed the END marker that starts the next one.
 * When that next frame was the response to a command, initDevice() ran into
 * "Timeout waiting for response" and the receiver stayed dead until somebody
 * restarted the adapter by hand.
 */

const emptyLogger = { info: () => {}, error: () => {}, debug: () => {} };

const telegram = '2C446532821851582C067AE1000000046D1906D9180C1334120000426CBF1C4C1300000000326CFFFF01FD7300';

/*
 * The three chunks of received data logged in issue #308: the tail of a frame
 * that was already being sent when the port was opened, a telegram frame that
 * ends 28 bytes before the length announced in its wM-Bus header, and the
 * PING_RSP that the pending initDevice() was waiting for.
 */
const ISSUE_308_CHUNKS = [
    '5f3500824b00356d1d79f6d7bc4066bbfd4db9adee22ba4f2de13b26d48a3ef13b78d269880bb150aafd9b37d181b50f1b7bed27f9c56e046d040c42396fa0c0' +
        'c0092091be7e380000059f9644fa123875163100067af5000020046d012c423904131903000002fd17000001fd481e426c000044130000000084011306030000',
    'c4011345020000840213a3000000c402132d00000084031300000000c403130000000084041300000000c404130000000084051300000000c405130000000084061300000000c406' +
        'c00102',
    '00a0afc0',
];

function buildPingResponse() {
    return new HciMessageV2().setDestinationId(0x01).setMessageId(0x02).setPayload(Buffer.alloc(1)).build();
}

function buildTelegramFrame(dataHex) {
    const payload = Buffer.alloc(8 + dataHex.length / 2);
    payload.writeUInt32LE(1234567890);
    payload[6] = 2; // frame type A
    payload.writeInt8(-55, 7);
    Buffer.from(dataHex, 'hex').copy(payload, 8);

    return new HciMessageV2().setDestinationId(0x09).setMessageId(0x20).setPayload(payload).build();
}

async function expectRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return expect.fail('the promise was expected to be rejected');
}

describe('IMSTv2 SLIP framing', () => {
    let receiver;
    let messages;
    let responses;

    beforeEach(() => {
        messages = [];
        responses = [];
        receiver = new ImstV2Receiver(
            { path: '/dev/mockPort', baudRate: 115200, serialPortImpl: function () {} },
            'CT',
            message => messages.push(message),
            () => {},
            emptyLogger,
        );
    });

    /** Pretend a command was sent and is waiting for its response. */
    function expectResponse() {
        receiver.readPromises.push(data => responses.push(data));
    }

    function receive(...chunks) {
        for (const chunk of chunks) {
            receiver.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'hex'));
        }
    }

    it('hands the response behind a truncated telegram to the pending command (#308)', () => {
        expectResponse();

        receive(...ISSUE_308_CHUNKS);

        expect(
            responses.map(response => response.toString('hex')),
            'the response was swallowed',
        ).to.eql(['c0010200a0afc0']);
        expect(messages, 'the truncated telegram should not be dispatched').to.be.empty;
    });

    it('does not lose a telegram that follows a truncated one', () => {
        const truncated = buildTelegramFrame(telegram);

        receive(truncated.subarray(0, truncated.length - 20), buildTelegramFrame(telegram));

        expect(messages).to.have.lengthOf(1);
        expect(messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('drops a frame with a broken CRC instead of dispatching it', () => {
        expectResponse();

        const broken = buildPingResponse();
        broken[3] ^= 0xff;

        receive(broken, buildPingResponse());

        expect(responses.map(response => response.toString('hex'))).to.eql([buildPingResponse().toString('hex')]);
        expect(messages).to.be.empty;
    });

    it('extracts frames that share their END marker', () => {
        for (let i = 0; i < 4; i++) {
            expectResponse();
        }

        // The device sends "END <frame> END", so two frames in a row share the
        // marker between them whether or not it is actually sent twice
        const response = buildPingResponse();
        receive(Buffer.concat([response, response]), Buffer.concat([response, response.subarray(1)]));

        expect(responses.map(received => received.toString('hex'))).to.eql(Array(4).fill(response.toString('hex')));
    });

    it('extracts a frame that arrives byte by byte', () => {
        expectResponse();

        const response = buildPingResponse();
        for (const byte of response) {
            receive(Buffer.from([byte]));
        }

        expect(responses).to.have.lengthOf(1);
        expect(responses[0].toString('hex')).to.equal(response.toString('hex'));
    });

    it('skips leading garbage without eating the frame behind it', () => {
        expectResponse();

        receive(Buffer.concat([Buffer.from('1234567890abcdef', 'hex'), buildPingResponse()]));

        expect(responses).to.have.lengthOf(1);
    });

    it('never throws out of the data handler', () => {
        // Whatever goes wrong while processing received data, it happens in the
        // "data" handler of the port, where an exception is uncaught and takes
        // the adapter down with it
        receiver.emitMessage = () => {
            throw new Error('parsing went wrong');
        };

        expect(() => receive(buildTelegramFrame(telegram))).to.not.throw();
        expect(receiver.parserBuffer, 'the buffer should be dropped to resynchronise').to.have.lengthOf(0);
    });

    it('only removes its own reader when a command times out', async () => {
        receiver.readTimeout = 30;
        const timingOut = receiver.readResponse();

        receiver.readTimeout = 5000;
        const nextCommand = receiver.readResponse();

        expect(await expectRejection(timingOut)).to.equal('Timeout waiting for response');
        expect(receiver.readPromises, 'the reader of the next command was removed as well').to.have.lengthOf(1);

        // ... so the next command still gets its response
        receive(buildPingResponse());
        expect((await nextCommand).toString('hex')).to.equal(buildPingResponse().toString('hex'));
    });

    it('discards the remains of the frame that was on the wire when the port was opened', async () => {
        expectResponse();
        receiver.staleDataTimeout = 10;

        // The tail of a telegram the device was sending before anyone listened
        receive('046d012c423904131903000002fd17000001fd481e426c0000441300000000c0');
        await receiver.discardStaleData();

        expect(receiver.parserBuffer).to.have.lengthOf(0);
        expect(responses, 'a fragment is no answer to a command').to.be.empty;
        expect(messages, 'and no telegram either').to.be.empty;
    });
});
