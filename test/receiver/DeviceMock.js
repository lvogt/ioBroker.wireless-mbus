'use strict';

const { SerialPortStream } = require('@serialport/stream');
const fs = require('node:fs');

const { EventHelper, MockBinding } = require('./MockBindingHelper');

const IS_DEBUG = process.env.DEBUG === 'true';

class DeviceMock extends SerialPortStream {
    constructor(options) {
        MockBinding.createPort(options.path);
        const opts = {
            binding: MockBinding,
            ...options,
        };
        super(opts);

        EventHelper.emitter.on('write', this.onWrite.bind(this));
        this.communicationLog = [];
    }

    setDeviceProperties(filename) {
        if (fs.existsSync(filename)) {
            const options = JSON.parse(fs.readFileSync(filename, { encoding: 'utf-8' }));
            Object.keys(options).forEach(key => (this[key] = options[key]));
        }
    }

    getResponse(_request) {
        throw new Error('getResponse is unimplemented');
    }

    sendTelegram(_dataString, _rssi, _frameType, _ts, _withCrc) {
        throw new Error('sendTelegram is unimplemented!');
    }

    onWrite(buffer) {
        this.communicationLog.push(`<<< ${buffer.toString('hex')}`);

        const response = this.getResponse(buffer);
        if (Buffer.isBuffer(response)) {
            this.sendData(response);
        }
    }

    sendData(data) {
        if (IS_DEBUG) {
            console.log(`>>> ${data.toString('hex')}`);
        }
        this.communicationLog.push(`>>> ${data.toString('hex')}`);
        // @ts-expect-error emitData is added by the serialport mock binding, not part of the typed interface
        this.port.emitData(data);
    }

    close(callback) {
        // SerialPort.close() calls back when it is done, and SerialDevice
        // waits for that - swallowing the callback here made closeConnection()
        // hang forever against a mocked receiver.
        super.close(callback);
        MockBinding.reset();
    }
}

module.exports = DeviceMock;
