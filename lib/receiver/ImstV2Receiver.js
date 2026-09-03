'use strict';

const HciMessageV2 = require('./HciMessageV2');
const SerialDevice = require('./SerialDevice');
const END = require('./SlipEncoder').END;

//DestinationId
const SAP_DEVMGMT = 0x01;
const SAP_WMBUS = 0x09;

const DEVMGMT_OFFSET = 0x100;

//messageId
const PING_REQ = 0x01 + DEVMGMT_OFFSET;
const PING_RSP = 0x02 + DEVMGMT_OFFSET;
const FW_INFO_REQ = 0x05 + DEVMGMT_OFFSET;
const FW_INFO_RSP = 0x06 + DEVMGMT_OFFSET;

const GET_ACTIVE_CONFIG_REQ = 0x01;
const GET_ACTIVE_CONFIG_RSP = 0x02;
const SET_ACTIVE_CONFIG_REQ = 0x03;
const SET_ACTIVE_CONFIG_RSP = 0x04;

const RX_MESSAGE_IND = 0x20;

// END <destinationId> <messageId> <crc16> END - the shortest frame there can be
const MIN_FRAME_LENGTH = 6;

// How long to wait for the tail of a frame that was already on the wire when
// the port was opened, before dropping it (msec)
const STALE_DATA_TIMEOUT = 100;

//Link modes
const LINK_MODE_S = 0x01;
const LINK_MODE_T = 0x02;
const LINK_MODE_CT = 0x03;
const LINK_MODE_C = 0x05;
const LINK_MODE_TX = 0x06;

class ImstV2Receiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('IMSTv2');

        this.staleDataTimeout = STALE_DATA_TIMEOUT;
    }

    buildPayloadPackage(command, payload) {
        const sapId = command >= DEVMGMT_OFFSET ? SAP_DEVMGMT : SAP_WMBUS;
        const messageId = command - DEVMGMT_OFFSET;

        return new HciMessageV2().setDestinationId(sapId).setMessageId(messageId).setPayload(payload).build();
    }

    /**
     * Take the next complete SLIP frame out of the parser buffer.
     *
     * The END marker that closes a frame is deliberately left in the buffer:
     * a sender that does not repeat it uses it as the start marker of the next
     * frame. Consuming it would turn the frame behind it into a fragment
     * without a start marker, which is then dropped up to its own end marker -
     * so a single corrupt frame used to cost the frame following it as well.
     * Losing one command response that way is enough to make initDevice() time
     * out and leave the receiver dead (issues #308 and #309).
     */
    checkAndExtractMessage() {
        for (;;) {
            const start = this.parserBuffer.indexOf(END);
            if (start === -1) {
                // Nothing but the tail of a frame whose start was never seen
                return null;
            }

            if (start > 0) {
                this.parserBuffer = this.parserBuffer.subarray(start);
            }

            const end = this.parserBuffer.indexOf(END, 1);
            if (end === -1) {
                // The frame is still being received
                return null;
            }

            if (end + 1 >= MIN_FRAME_LENGTH) {
                const messageBuffer = this.parserBuffer.subarray(0, end + 1);
                this.parserBuffer = this.parserBuffer.subarray(end);

                if (this.isMessageIntact(messageBuffer)) {
                    return messageBuffer;
                }
                continue;
            }

            // Too short to be a frame: two END markers in a row, or the
            // remains of a frame. Drop it, but keep the marker that ends it.
            this.parserBuffer = this.parserBuffer.subarray(end);
        }
    }

    /**
     * A frame that does not decode or whose CRC is wrong is no frame: it must
     * not be handed to a pending readResponse() as if it were the answer to a
     * command, and it must not reach the telegram parser either - a corrupt
     * telegram would count towards the automatic block list of a device that
     * is working perfectly well.
     */
    isMessageIntact(messageBuffer) {
        try {
            const parseResult = new HciMessageV2().parse(messageBuffer);
            if (parseResult === true) {
                return true;
            }
            this.log.info(parseResult);
        } catch (error) {
            this.log.info(`Malformed message: ${error}`);
        }

        this.log.debug(`Discarded message: ${messageBuffer.toString('hex')}`);
        return false;
    }

    validateResponse(pkg, response) {
        const mPkg = new HciMessageV2();
        mPkg.parse(pkg);

        const mResponse = new HciMessageV2();
        mResponse.parse(response);

        if (mPkg.setupResponse().messageId != mResponse.messageId) {
            throw new Error(
                `MessageId mismatch! actual: ${mResponse.messageId} - expected ${mPkg.setupResponse().messageId}`,
            );
        }
    }

    isTelegramMessage(messageBuffer) {
        const msg = new HciMessageV2();
        msg.parse(messageBuffer);
        return msg.destinationId === 0x09 && msg.messageId === 0x20;
    }

    parseRawMessage(messageBuffer) {
        const hciMessage = new HciMessageV2();
        const parseResult = hciMessage.parse(messageBuffer);
        if (parseResult !== true) {
            this.log.info(parseResult);
        }

        if (hciMessage.messageId !== RX_MESSAGE_IND) {
            this.log.info(`Unhandled message received: 0x${hciMessage.messageId.toString(16)}`);
            this.log.info(hciMessage.payload.toString('hex'));
        }

        const timestamp = hciMessage.payload.readInt32LE(0);
        // hciMessage.payload[4] === decryptionStatus
        // hciMessage.payload[5] === encryptionMode
        const frameType = hciMessage.payload[6] >= 20 ? 'B' : 'A';
        const rssi = hciMessage.payload.readInt8(7);

        return {
            frameType: frameType,
            containsCrc: false,
            rawData: hciMessage.payload.subarray(8),
            rssi: rssi,
            ts: timestamp,
        };
    }

    getMode() {
        switch (this.mode) {
            case 'S':
                return LINK_MODE_S;
            case 'T':
                return LINK_MODE_T;
            case 'CT':
                return LINK_MODE_CT;
            case 'C':
                return LINK_MODE_C;
            case 'Tx':
                return LINK_MODE_TX;
            default:
                return LINK_MODE_CT;
        }
    }

    getModeDescription() {
        switch (this.mode) {
            case 'S':
                return 'S-Mode';
            case 'T':
                return 'T-Mode';
            case 'CT':
                return 'combined C/T-Mode';
            case 'C':
                return 'C-Mode (100 kbps)';
            case 'Tx':
                return 'enhanced T-Mode';
            default:
                return 'combined C/T-Mode';
        }
    }

    logStatus(status) {
        if (status === 0x00) {
            this.log.info('Device status: OK');
        } else {
            this.log.info(`Device status not OK (0x${status.toString(16)})`);
        }
    }

    async ping() {
        const response = await this.sendPackage(PING_REQ, Buffer.alloc(0));
        const m = new HciMessageV2();
        m.parse(response);

        this.logStatus(m.payload[0]);
    }

    async getFwInfo() {
        const response = await this.sendPackage(FW_INFO_REQ, Buffer.alloc(0));
        const m = new HciMessageV2();
        m.parse(response);

        this.logStatus(m.payload[0]);

        const version = `${m.payload[2]}.${m.payload[1]}`;
        const buildCount = m.payload.readUint16LE(3);
        const date = m.payload.toString('utf-8', 5, 15);
        const fwName = m.payload.toString('utf-8', 15);

        this.log.info(`Firmware v${version} --- build count ${buildCount} on ${date} --- ${fwName}`);
    }

    async setModeAndAndEnableReceiveNotification() {
        const response = await this.sendPackage(GET_ACTIVE_CONFIG_REQ, Buffer.alloc(0));
        const m = new HciMessageV2();
        m.parse(response);

        const config = m.payload.subarray(1);
        config[0] = this.getMode();
        config[1] &= 0xfe; // disable address filter
        config[1] |= 0x02; // enable receive notification

        await this.sendPackage(SET_ACTIVE_CONFIG_REQ, config);
        this.log.info(`Receiver set to ${this.getModeDescription()}`);
    }

    async initDevice() {
        await this.ping();
        await this.getFwInfo();
        await this.setModeAndAndEnableReceiveNotification();
    }
}

module.exports = ImstV2Receiver;
