'use strict';

const SerialDevice = require('./SerialDevice');

const CMD_END = '\n';
const CARRIAGE_RETURN = 0x0d;

class SimpleReceiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('SIMPLE');
        this.frameType = 'A';
    }

    /** One telegram per line - and a chunk can hold more than one of them. */
    checkAndExtractMessage() {
        for (;;) {
            const end = this.parserBuffer.indexOf(CMD_END);
            if (end === -1) {
                return null;
            }

            let line = this.parserBuffer.subarray(0, end);
            this.parserBuffer = this.parserBuffer.subarray(end + CMD_END.length);

            if (line.length && line[line.length - 1] === CARRIAGE_RETURN) {
                line = line.subarray(0, line.length - 1);
            }

            if (line.length) {
                return line;
            }
        }
    }

    parseRawMessage(messageBuffer) {
        const withCrc = messageBuffer[0] == 0x5a;
        // The line separator is no longer part of the message
        const payload = Buffer.from(messageBuffer.toString('ascii', withCrc ? 1 : 0), 'hex');

        return {
            frameType: this.frameType,
            containsCrc: withCrc,
            rawData: payload,
            rssi: -1,
            ts: new Date().getTime(),
        };
    }

    async initDevice() {
        if (this.mode == 'B') {
            this.frame_type = 'B';
        }
    }
}

module.exports = SimpleReceiver;
