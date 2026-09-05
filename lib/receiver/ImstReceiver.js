'use strict';

const HciMessage = require('./HciMessage');
const SerialDevice = require('./SerialDevice');

//Endpoint Identifier
const DEVMGMT_ID = 0x01;
const RADIOLINK_ID = 0x02;
const RADIOLINKTEST_ID = 0x03;
const HWTEST_ID = 0x04;

//Device Management Message Identifier
const DEVMGMT_MSG_SET_CONFIG_REQ = 0x03;
const DEVMGMT_MSG_SET_CONFIG_RSP = 0x04;

//Radio Link Message Identifier
const RADIOLINK_MSG_WMBUSMSG_IND = 0x03;

//Link modes
const LINK_MODE_S1 = 0x00;
const LINK_MODE_S1m = 0x01;
const LINK_MODE_S2 = 0x02;
const LINK_MODE_T1 = 0x03;
const LINK_MODE_T2 = 0x04;
const LINK_MODE_R2 = 0x05;
const LINK_MODE_C1A = 0x06;
const LINK_MODE_C1B = 0x07;
const LINK_MODE_C2A = 0x08;
const LINK_MODE_C2B = 0x09;

class ImstReceiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('IMST');

        this.frameType = 'A';
    }

    buildPayloadPackage(command, payload) {
        return new HciMessage().setPayload(DEVMGMT_ID, command, payload).setCrc(true).build();
    }

    checkAndExtractMessage() {
        return this.extractMessageByLength(HciMessage.START_BYTE, HciMessage.tryToGetLength, messageBuffer =>
            this.isMessageIntact(messageBuffer),
        );
    }

    /**
     * Whether a message decodes and, if it carries a CRC, whether that CRC is
     * correct. The module can be configured to send messages without one, and
     * then the start of frame byte and a self consistent length are all there
     * is to go by.
     */
    isMessageIntact(messageBuffer) {
        try {
            const parseResult = new HciMessage().parse(messageBuffer);
            if (parseResult === true) {
                return true;
            }
            this.log.debug(`${parseResult} - looking for the next start byte`);
        } catch (error) {
            this.log.debug(`${error} - looking for the next start byte`);
        }
        return false;
    }

    /**
     * Without this a telegram that arrives between a command and its response
     * is taken for the response and fails the command with a message id
     * mismatch.
     */
    isTelegramMessage(messageBuffer) {
        const message = new HciMessage();
        message.parse(messageBuffer);
        return message.endpointId === RADIOLINK_ID && message.messageId === RADIOLINK_MSG_WMBUSMSG_IND;
    }

    validateResponse(pkg, response) {
        const mPkg = new HciMessage();
        mPkg.parse(pkg);

        const mResponse = new HciMessage();
        mResponse.parse(response);

        if (mPkg.setupResponse().messageId != mResponse.messageId) {
            throw new Error('MessageId mismatch!');
        }
    }

    parseRawMessage(messageBuffer) {
        const hciMessage = new HciMessage();
        const parseResult = hciMessage.parse(messageBuffer);
        if (parseResult !== true) {
            this.log.debug(parseResult);
        }

        return {
            frameType: this.frameType,
            containsCrc: false,
            rawData: this.prefixPayloadWithLength(hciMessage.payload),
            rssi: hciMessage.rssi,
            ts: hciMessage.hasTimestamp ? hciMessage.timestamp : new Date().getTime(),
        };
    }

    prefixPayloadWithLength(payload) {
        return Buffer.concat([Buffer.from([payload.length]), payload]);
    }

    getMode() {
        switch (this.mode) {
            case 'S':
                return LINK_MODE_S1;
            case 'CA':
                return LINK_MODE_C1A;
            case 'CB':
                return LINK_MODE_C1B;
            default:
                return LINK_MODE_T1;
        }
    }

    async setModeAndDisableSleepMode() {
        const mode = this.getMode();
        this.frameType = mode == LINK_MODE_C1B ? 'B' : 'A';
        if (mode > 0x09) {
            throw new Error(`Invalid mode! ${mode}`);
        }
        await this.sendPackage(DEVMGMT_MSG_SET_CONFIG_REQ, Buffer.from([0x00, 0x03, 0x00, mode, 0x08, 0x00]));
        this.log.info(`Receiver set to ${this.mode}-MODE`);
    }

    async initDevice() {
        await this.setModeAndDisableSleepMode();
    }
}

module.exports = ImstReceiver;
