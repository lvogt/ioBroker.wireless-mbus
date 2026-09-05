'use strict';

const { expect } = require('chai');
const net = require('node:net');
const AmberMessage = require('../../lib/receiver/AmberMessage');
const AmberReceiver = require('../../lib/receiver/AmberReceiver');
const CulReceiver = require('../../lib/receiver/CulReceiver');
const EbiMessage = require('../../lib/receiver/EbiMessage');
const EbiReceiver = require('../../lib/receiver/EbiReceiver');
const HciMessage = require('../../lib/receiver/HciMessage');
const ImstReceiver = require('../../lib/receiver/ImstReceiver');
const SimpleReceiver = require('../../lib/receiver/SimpleReceiver');
const TcpReceiver = require('../../lib/receiver/TcpReceiver');

/*
 * Framing tests for the receivers other than IMSTv2 (see imstv2-framing.test.js
 * for that one). What they have in common: a chunk read from the port is not a
 * message. It can hold several of them, a fragment of one, or - after an
 * adapter restart, when the receiver is still in the mode the previous run
 * configured - the middle of one.
 */

const telegram = '2C446532821851582C067AE1000000046D1906D9180C1334120000426CBF1C4C1300000000326CFFFF01FD7300';

/**
 * @typedef {object} ReceivedTelegram
 * @property {Buffer} rawData the raw wM-Bus telegram
 * @property {number} rssi the signal strength the receiver reported
 */

function createReceiver(ReceiverClass, mode) {
    /** @type {ReceivedTelegram[]} */
    const messages = [];
    /** @type {Buffer[]} */
    const responses = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warns = [];
    /** @type {string[]} */
    const infos = [];
    /** @type {string[]} */
    const debugs = [];

    const receiver = new ReceiverClass(
        { path: '/dev/mockPort', serialPortImpl: function () {} },
        mode,
        message => messages.push(message),
        () => {},
        {
            info: message => infos.push(message),
            warn: message => warns.push(message),
            error: message => errors.push(message),
            debug: message => debugs.push(message),
        },
    );

    return {
        receiver,
        messages,
        responses,
        errors,
        warns,
        infos,
        /**
         * Whether any line of the debug log says this - which is where the
         * trace of a dropped message lives.
         */
        debugged: text => debugs.some(message => message.includes(text)),
        /** Pretend a command was sent and is waiting for its response. */
        expectResponse: () => receiver.readPromises.push(data => responses.push(data)),
        receive: (...chunks) =>
            chunks.forEach(chunk => receiver.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'ascii'))),
    };
}

describe('AMBER framing', () => {
    // The module reports a telegram without its length field, which the
    // receiver puts back - so this is the telegram as the module sends it
    const buildTelegram = () => new AmberMessage().setPayload(0x03, Buffer.from(telegram.substring(2), 'hex')).build();
    const buildResponse = () =>
        new AmberMessage()
            .setPayload(0x0c, Buffer.from([1, 2, 3]))
            .setupResponse()
            .build();

    it('resynchronises after a byte that does not belong to a message', () => {
        const amber = createReceiver(AmberReceiver, 'T');
        amber.expectResponse();

        // A single junk byte used to desynchronise the receiver for good: it
        // emitted four bogus telegrams, fed one of them to the pending command
        // and lost both real ones
        amber.receive(Buffer.concat([Buffer.from([0x00]), buildTelegram(), buildTelegram()]));

        expect(amber.messages).to.have.lengthOf(2);
        amber.messages.forEach(message => expect(message.rawData).to.eql(Buffer.from(telegram, 'hex')));
        expect(amber.responses, 'a telegram is no answer to a command').to.be.empty;
    });

    it('drops a message whose checksum does not match', () => {
        const amber = createReceiver(AmberReceiver, 'T');

        const corrupt = buildTelegram();
        corrupt[corrupt.length - 2] ^= 0xff;

        amber.receive(Buffer.concat([corrupt, buildTelegram()]));

        expect(amber.messages).to.have.lengthOf(1);
        expect(amber.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('keeps a message that is still being received', () => {
        const amber = createReceiver(AmberReceiver, 'T');
        const frame = buildTelegram();

        amber.receive(frame.subarray(0, 10));
        expect(amber.messages).to.be.empty;
        expect(amber.receiver.parserBuffer, 'the start of the message was dropped').to.have.lengthOf(10);

        amber.receive(frame.subarray(10));
        expect(amber.messages).to.have.lengthOf(1);
        expect(amber.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('still hands a response to the pending command', () => {
        const amber = createReceiver(AmberReceiver, 'T');
        amber.expectResponse();

        amber.receive(buildResponse());

        expect(amber.responses.map(response => response.toString('hex'))).to.eql([buildResponse().toString('hex')]);
        expect(amber.messages).to.be.empty;
    });

    it('discards data without a start byte', () => {
        const amber = createReceiver(AmberReceiver, 'T');

        amber.receive(Buffer.from('0123456789abcdef', 'hex'));

        expect(amber.receiver.parserBuffer).to.have.lengthOf(0);
        expect(amber.messages).to.be.empty;
    });
});

describe('IMST framing', () => {
    // Endpoint 2, message id 3 is a wM-Bus telegram; the module reports it
    // without its length field, which the receiver puts back
    const buildTelegram = () =>
        new HciMessage()
            .setRssi(-55)
            .setTimestamp(1234567890)
            .setCrc(true)
            .setPayload(2, 3, Buffer.from(telegram.substring(2), 'hex'))
            .build();
    const buildResponse = () =>
        new HciMessage()
            .setCrc(true)
            .setPayload(1, 0x04, Buffer.from([0x00]))
            .build();

    it('resynchronises after a byte that does not belong to a message', () => {
        const imst = createReceiver(ImstReceiver, 'T');
        imst.expectResponse();

        // A single junk byte used to make HciMessage.parse() throw "SOF byte is
        // incorrect", straight out of the port's data handler
        imst.receive(Buffer.concat([Buffer.from([0x00]), buildTelegram(), buildTelegram()]));

        expect(imst.messages).to.have.lengthOf(2);
        imst.messages.forEach(message => expect(message.rawData).to.eql(Buffer.from(telegram, 'hex')));
        expect(imst.responses, 'a telegram is no answer to a command').to.be.empty;
    });

    it('drops a message whose CRC does not match', () => {
        const imst = createReceiver(ImstReceiver, 'T');

        const corrupt = buildTelegram();
        corrupt[10] ^= 0xff;

        imst.receive(Buffer.concat([corrupt, buildTelegram()]));

        expect(imst.messages).to.have.lengthOf(1);
        expect(imst.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('keeps a message that is still being received', () => {
        const imst = createReceiver(ImstReceiver, 'T');
        const frame = buildTelegram();

        imst.receive(frame.subarray(0, 10));
        expect(imst.receiver.parserBuffer, 'the start of the message was dropped').to.have.lengthOf(10);

        imst.receive(frame.subarray(10));
        expect(imst.messages).to.have.lengthOf(1);
    });

    it('still hands a response to the pending command', () => {
        const imst = createReceiver(ImstReceiver, 'T');
        imst.expectResponse();

        imst.receive(buildResponse());

        expect(imst.responses.map(response => response.toString('hex'))).to.eql([buildResponse().toString('hex')]);
        expect(imst.messages).to.be.empty;
    });
});

describe('EMBIT framing', () => {
    const buildTelegram = () => {
        const data = Buffer.alloc(2 + telegram.length / 2);
        data.writeUInt16BE(7); // options: neither RSSI nor timestamp
        Buffer.from(telegram, 'hex').copy(data, 2);
        return new EbiMessage().setPayload(0xe0, data).build();
    };
    const buildResponse = () =>
        new EbiMessage()
            .setPayload(0x04, Buffer.from([0x10]))
            .setupResponse()
            .build();

    it('resynchronises after a byte that does not belong to a message', () => {
        const ebi = createReceiver(EbiReceiver, 'T');
        ebi.expectResponse();

        // The protocol has no start marker, so a single junk byte turned the
        // length into a random 16 bit number - the receiver either stalled or
        // threw a RangeError out of the port's data handler
        ebi.receive(Buffer.concat([Buffer.from([0x00]), buildTelegram(), buildTelegram()]));

        expect(ebi.messages).to.have.lengthOf(2);
        ebi.messages.forEach(message => expect(message.rawData).to.eql(Buffer.from(telegram, 'hex')));
        expect(ebi.responses, 'a telegram is no answer to a command').to.be.empty;
    });

    it('drops a message whose checksum does not match', () => {
        const ebi = createReceiver(EbiReceiver, 'T');

        const corrupt = buildTelegram();
        corrupt[corrupt.length - 1] ^= 0xff;

        ebi.receive(Buffer.concat([corrupt, buildTelegram()]));

        expect(ebi.messages).to.have.lengthOf(1);
        expect(ebi.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('keeps a message that is still being received', () => {
        const ebi = createReceiver(EbiReceiver, 'T');
        const message = buildTelegram();

        ebi.receive(message.subarray(0, 10));
        expect(ebi.receiver.parserBuffer, 'the start of the message was dropped').to.have.lengthOf(10);

        ebi.receive(message.subarray(10));
        expect(ebi.messages).to.have.lengthOf(1);
    });

    it('still hands a response to the pending command', () => {
        const ebi = createReceiver(EbiReceiver, 'T');
        ebi.expectResponse();

        ebi.receive(buildResponse());

        expect(ebi.responses.map(response => response.toString('hex'))).to.eql([buildResponse().toString('hex')]);
        expect(ebi.messages).to.be.empty;
    });

    it('discards data that announces an impossible length', () => {
        const ebi = createReceiver(EbiReceiver, 'T');

        ebi.receive(Buffer.from('000000', 'hex'));

        // Only the last byte is kept: it could be the first half of a length
        expect(ebi.receiver.parserBuffer).to.have.lengthOf(1);
        expect(ebi.messages).to.be.empty;
    });
});

describe('CUL framing', () => {
    const line = rssi => `b${telegram}${rssi}\r\n`;

    it('extracts every telegram of a chunk that holds more than one line', () => {
        const cul = createReceiver(CulReceiver, 'T');

        cul.receive(line('c8') + line('c9') + line('ca'));

        expect(cul.messages).to.have.lengthOf(3);
        cul.messages.forEach(message => expect(message.rawData).to.eql(Buffer.from(telegram, 'hex')));
        expect(new Set(cul.messages.map(message => message.rssi)).size, 'the same line three times').to.equal(3);
    });

    it('keeps the rest of an incomplete line for the next chunk', () => {
        const cul = createReceiver(CulReceiver, 'T');
        const complete = line('c8');

        cul.receive(complete.slice(0, 20));
        expect(cul.messages, 'a line without its separator is not a message yet').to.be.empty;

        cul.receive(complete.slice(20));
        expect(cul.messages).to.have.lengthOf(1);
        expect(cul.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('does not mix up a response and a telegram that share a chunk', () => {
        const cul = createReceiver(CulReceiver, 'T');
        cul.expectResponse();

        cul.receive(`V 1.30 CUL868\r\n${line('c8')}`);

        expect(cul.responses.map(response => response.toString('ascii'))).to.eql(['V 1.30 CUL868']);
        expect(cul.messages, 'the telegram behind the response was lost').to.have.lengthOf(1);
    });

    it('takes a telegram for a telegram while a command waits for its answer', () => {
        const cul = createReceiver(CulReceiver, 'T');
        cul.expectResponse();

        // Both used to end up at the pending command, which then failed on an
        // answer that was really a telegram
        cul.receive(`${line('c8')}TMODE\r\n`);

        expect(cul.messages, 'the telegram was eaten by the command').to.have.lengthOf(1);
        expect(cul.responses.map(response => response.toString('ascii'))).to.eql(['TMODE']);
    });

    it('drops a response that nobody asked for', () => {
        const cul = createReceiver(CulReceiver, 'T');

        // Reporting the version of a receiver as a meter reading is worse than
        // dropping a line that arrived too late
        cul.receive(`V 1.30 CUL868\r\n`);

        expect(cul.messages).to.be.empty;
        expect(cul.debugged('Nothing is waiting for this message'), 'dropping a line should leave a trace').to.be.true;
    });

    it('discards a telegram line that is not valid hex', () => {
        const cul = createReceiver(CulReceiver, 'T');

        cul.receive(`b${telegram}xx\r\n${line('c8')}`);

        // Buffer.from(..., 'hex') truncates at the first character that is not
        // a hex digit, so such a line used to become a shortened telegram
        expect(cul.messages).to.have.lengthOf(1);
        expect(cul.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('ignores empty lines', () => {
        const cul = createReceiver(CulReceiver, 'T');
        cul.expectResponse();

        cul.receive(`\r\n\r\nTMODE\r\n`);

        expect(cul.responses.map(response => response.toString('ascii'))).to.eql(['TMODE']);
    });
});

describe('SIMPLE framing', () => {
    it('extracts every telegram of a chunk that holds more than one line', () => {
        const simple = createReceiver(SimpleReceiver, 'A');

        simple.receive(`${telegram}\n${telegram}\n`);

        expect(simple.messages).to.have.lengthOf(2);
        simple.messages.forEach(message => expect(message.rawData).to.eql(Buffer.from(telegram, 'hex')));
    });

    it('accepts lines that end with CRLF', () => {
        const simple = createReceiver(SimpleReceiver, 'A');

        simple.receive(`${telegram}\r\n`);

        expect(simple.messages).to.have.lengthOf(1);
        expect(simple.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });
});

describe('TCP framing', () => {
    it('reads a telegram', () => {
        const tcp = createReceiver(TcpReceiver, 'A');

        tcp.receive(JSON.stringify({ frameType: 'A', containsCrc: false, data: telegram }));

        expect(tcp.messages).to.have.lengthOf(1);
        expect(tcp.messages[0].rawData).to.eql(Buffer.from(telegram, 'hex'));
    });

    it('reports a port that is already taken', async () => {
        const blocker = net.createServer();
        await new Promise(resolve => blocker.listen(0, '127.0.0.1', () => resolve(true)));
        const address = blocker.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        /** @type {string[]} */
        const errors = [];
        const receiver = new TcpReceiver(
            { path: `${port}` },
            'A',
            () => {},
            error => errors.push(`${error}`),
            {
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
            },
        );

        // Listening on a port that is in use used to emit an unhandled error
        // event, which terminates the adapter
        const failed = await receiver.init().then(
            () => false,
            () => true,
        );

        expect(failed, 'init() should report that it cannot listen').to.be.true;

        await receiver.closeConnection();
        await new Promise(resolve => blocker.close(() => resolve(true)));
    });

    it('does not throw on data that is no telegram', () => {
        const tcp = createReceiver(TcpReceiver, 'A');

        // Half a telegram, which is all it takes for JSON.parse() to throw out
        // of the socket's data handler
        expect(() => tcp.receive('{"frameType":"A","containsCrc"')).to.not.throw();

        expect(tcp.messages).to.be.empty;
        // A telegram nobody can read is the sender's problem, not a failure of
        // the adapter - so it is a warning
        expect(tcp.errors).to.be.empty;
        expect(tcp.warns).to.have.lengthOf(1);
    });
});

describe('Message dispatch', () => {
    it('drops a message that nobody is waiting for', () => {
        const amber = createReceiver(AmberReceiver, 'T');

        // The answer to a command that has already given up: it used to be
        // parsed as a telegram, which reported a device that does not exist -
        // or threw, and then cost the whole parser buffer
        amber.receive(
            new AmberMessage()
                .setPayload(0x0c, Buffer.from([1, 2, 3]))
                .setupResponse()
                .build(),
        );

        expect(amber.messages).to.be.empty;
        expect(amber.errors).to.be.empty;
        expect(amber.debugged('Nothing is waiting for this message'), 'dropping a message should leave a trace').to.be
            .true;
    });

    it('takes anything for a telegram where the protocol cannot tell', () => {
        const cul = createReceiver(CulReceiver, 'T');

        // A CUL response is arbitrary text, so "nobody is waiting for an
        // answer, therefore it is a telegram" is the best there is
        cul.receive(`b${telegram}c8\r\n`);

        expect(cul.messages).to.have.lengthOf(1);
    });
});
