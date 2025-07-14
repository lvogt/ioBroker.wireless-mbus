'use strict';

const DeviceMock = require('./DeviceMock');
const HciMessageV2 = require('../HciMessageV2');

class ImstV2DeviceMock extends DeviceMock {
    constructor(options) {
        super(options);

        this.withNoise = false;
        this.noise = Buffer.from('1234567890abcdefc0c00920d2029649000002c92c446532821851582c067ae1000000046d1906d9180c1334120000426cbf1c4c1300000000326cffff01fd7300d94cc0', 'hex');

        this.setDeviceProperties('./ImstV2Receiver.config.json');
    }

    getResponse(data) {
        const m = new HciMessageV2();
        const parseResult = m.parse(data);
        if (parseResult !== true) {
            console.log(parseResult);
        }

        if (m.destinationId == 0x01 && m.messageId === 0x01) {
            return this.addNoise(m
                .setupResponse()
                .setPayload(Buffer.alloc(1))
                .build());
        } else if (m.destinationId == 0x01 && m.messageId === 0x05) {
            return this.addNoise(m
                .setupResponse()
                .setPayload(this.buildGetFwResponsePayload())
                .build());
        } else if(m.destinationId == 0x09 && m.messageId === 0x01) {
            return this.addNoise(m
                .setupResponse()
                .setPayload(this.buildGetActiveConfigurationResponsePayload())
                .build());
        }

        return this.addNoise(m.setupResponse().build());
    }

    addNoise(data) {
        if (this.withNoise) {
            return Buffer.concat([this.noise, data]);
        } else {
            return data;
        }
    }

    sendTelegram(dataString, rssi, frameType, ts) {
        this.sendData(new HciMessageV2()
            .setDestinationId(0x09)
            .setMessageId(0x20)
            .setPayload(this.buildTelegramPayload(dataString, rssi, frameType, ts))
            .build());
    }

    buildTelegramPayload(dataString, rssi, frameType, ts) {
        const payload = Buffer.alloc(dataString.length / 2 + 8);
        payload.writeUInt32LE(ts !== undefined ? ts : new Date().getTime() / 1000);
        payload[6] = frameType === 'B' ? 20 : 2;
        payload.writeInt8(rssi, 7);
        Buffer.from(dataString, 'hex').copy(payload, 8);
        return payload;
    }

    buildGetFwResponsePayload() {
        const payload = Buffer.alloc(25);
        payload[0] = 0; // status
        payload[1] = 9; // minor versio
        payload[2] = 0; // major version
        payload.writeInt16LE(1234, 3); // build count
        payload.write('17.01.2025', 5, 'ascii');
        payload.write('MockDevice', 15, 'ascii');
        return payload;
    }

    buildGetActiveConfigurationResponsePayload() {
        const payload = Buffer.alloc(11);
        payload[0] = 0; // link mode off
        payload[1] = 1; // packet filter enabled
        // everything else is ignored
        payload[5] = 0x0c; // test slip encoder
        return payload;
    }
}

exports.SerialPort = ImstV2DeviceMock;