'use strict';

const SerialDevice = require('./SerialDevice');

const CMD_END = '\r\n';
const CMD_SET_DATA_REPORTING_AND_MODE = 'X21\r\nbr';
const CMD_VERSION = 'V';

const TELEGRAM_LINE = 0x62; // 'b' - the first character of a telegram line
const FRAME_TYPE_B_LINE = 0x59; // 'Y' - marks a type B frame in such a line

// Extraction puts one of these in front of a telegram, so that a telegram can
// still be told from the response to a command afterwards: a response is
// printable text and can never start with either of them
const FRAME_TYPE_A = 0x01;
const FRAME_TYPE_B = 0x00;

// How long to wait for the rest of the line that was already being sent when
// the port was opened, before dropping it (msec)
const STALE_DATA_TIMEOUT = 100;

class CulReceiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('CUL');

        // The CUL keeps the reporting mode of the previous adapter run, so it
        // is usually in the middle of a line when the port is opened. Such a
        // fragment is indistinguishable from the response to a command.
        this.staleDataTimeout = STALE_DATA_TIMEOUT;
    }

    buildPayloadPackage(command, payload) {
        const s = command + (payload ? payload : '') + CMD_END;
        return Buffer.from(s);
    }

    /**
     * The CUL is line based and sends one telegram or one command response per
     * line, so several of them can share a chunk. Taking the whole buffer as
     * one message dropped everything after the first line without a trace -
     * Buffer.from(..., 'hex') stops at the first character that is not a hex
     * digit instead of complaining about it. Take one line at a time.
     */
    checkAndExtractMessage() {
        for (;;) {
            const end = this.parserBuffer.indexOf(CMD_END);
            if (end === -1) {
                return null;
            }

            const line = this.parserBuffer.subarray(0, end);
            this.parserBuffer = this.parserBuffer.subarray(end + CMD_END.length);

            if (!line.length) {
                continue;
            }

            if (line[0] !== TELEGRAM_LINE) {
                // Not a telegram, so it is the response to a command
                return line;
            }

            // Remove the leading 'b' and, for a type B frame, its 'Y' marker
            const isFrameTypeB = line[1] === FRAME_TYPE_B_LINE;
            const hexString = line.toString('ascii', isFrameTypeB ? 2 : 1);
            const data = Buffer.from(hexString, 'hex');

            if (data.length * 2 !== hexString.length) {
                this.log.debug(`Discarding line with invalid hex data: ${hexString}`);
                continue;
            }

            return Buffer.concat([Buffer.from([isFrameTypeB ? FRAME_TYPE_B : FRAME_TYPE_A]), data]);
        }
    }

    /**
     * Which of the two a message is cannot be seen from the message itself: a
     * telegram is binary and a response is whatever the firmware answers. The
     * marker that extraction put in front of a telegram says it, and without
     * that a telegram arriving between a command and its response was taken
     * for the response and failed the command.
     */
    isTelegramMessage(messageBuffer) {
        return messageBuffer[0] === FRAME_TYPE_A || messageBuffer[0] === FRAME_TYPE_B;
    }

    parseRawMessage(messageBuffer) {
        let rssi = messageBuffer[messageBuffer.length - 1];
        rssi = rssi >= 0x80 ? (rssi - 0x100) / 2 - 74 : rssi / 2 - 74;

        const frameType = messageBuffer[0] === FRAME_TYPE_B ? 'B' : 'A';
        const payload = messageBuffer.subarray(1, messageBuffer.length - 1);

        return {
            frameType: frameType,
            containsCrc: true,
            rawData: payload,
            rssi: rssi,
            ts: new Date().getTime(),
        };
    }

    async setDataReportingAndMode() {
        const m = this.mode.toLowerCase();
        if (m != 's' && m != 't' && m != 'c') {
            throw new Error('Unknown mode!');
        }

        const response = await this.sendPackage(CMD_SET_DATA_REPORTING_AND_MODE, m);

        if (!response.toString('ascii').endsWith(`${m.toUpperCase()}MODE`)) {
            throw new Error(`Response was ${response.toString('ascii')}`);
        } else {
            this.log.info(`Receiver set to ${m.toUpperCase()}-MODE and data reporting with RSSI`);
        }
    }

    async checkVersion() {
        try {
            const version = await this.sendPackage(CMD_VERSION);
            this.log.info(`Version: ${version.toString('ascii')}`);
        } catch (error) {
            this.log.info(`Error getting CUL version: ${error}`);
        }
    }

    async initDevice() {
        await this.checkVersion();
        await this.setDataReportingAndMode();
    }
}

module.exports = CulReceiver;
