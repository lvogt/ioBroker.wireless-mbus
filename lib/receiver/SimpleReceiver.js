'use strict';

const SerialDevice = require('./SerialDevice');

const CMD_END = '\n';
const CARRIAGE_RETURN = 0x0d;
/**
 * A line may start with a 'Z' to say that its telegram carries the block CRCs.
 * The lower case one is taken as well: it is the same promise, typed by
 * somebody whose shift key was not involved.
 */
const CRC_MARKER = ['Z'.charCodeAt(0), 'z'.charCodeAt(0)];

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

            if (!line.length) {
                continue;
            }

            const hexString = this.getHexString(line);
            if (!/^[0-9a-fA-F]+$/.test(hexString) || hexString.length % 2) {
                // Whatever else reaches the line - a sender that says hello, a
                // status it reports, the half of a telegram that a reset cut
                // off - would otherwise become a handful of random bytes and a
                // device that does not exist.
                this.log.debug(`Discarding line with invalid hex data: ${line.toString('ascii')}`);
                continue;
            }

            return line;
        }
    }

    /**
     * The telegram of a line, without the marker that may be in front of it.
     *
     * @param {Buffer} line
     * @returns {string} the telegram as the hex string it was written as
     */
    getHexString(line) {
        return line.toString('ascii', CRC_MARKER.includes(line[0]) ? 1 : 0);
    }

    parseRawMessage(messageBuffer) {
        return {
            frameType: this.frameType,
            // The marker is a promise that the telegram carries its CRCs.
            // Its absence promises nothing: a sender that passes on what it
            // picked up off the air hands them over without announcing them,
            // so let the parser look for them rather than tell it there are
            // none - which made it read the first CRC byte as the CI field
            // (#276).
            containsCrc: CRC_MARKER.includes(messageBuffer[0]) ? true : undefined,
            rawData: Buffer.from(this.getHexString(messageBuffer), 'hex'),
            rssi: -1,
            ts: new Date().getTime(),
        };
    }

    async initDevice() {
        if (this.mode == 'B') {
            this.frameType = 'B';
        }
    }
}

module.exports = SimpleReceiver;
