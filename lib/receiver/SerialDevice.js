'use strict';

const { SerialPort } = require('serialport');
const net = require('net');
const SimpleLogger = require('../SimpleLogger');

class SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        this.log = new SimpleLogger(loggerFunction);

        if (typeof onMessage !== 'function') {
            throw new Error('onMessage must be of type "function(data)"');
        }

        this.options = options;
        this.port = null;
        this.mode = mode;
        this.closeRequested = false;

        this.parserBuffer = Buffer.alloc(0);
        this.maxParserBufferLength = 1024;

        this.readTimeout = 3000;
        this.readPromises = [];

        this.onMessage = onMessage;
        this.onError = onError;
    }

    /* eslint-disable no-unused-vars */

    buildPayloadPackage(command, payload) {
        throw new Error('buildPayloadPackage is unimplemented!');
    }

    validateResponse(pkg, response) { }

    checkAndExtractMessage() {
        throw new Error('checkAndExtractMessage is unimplemented!');
    }

    parseRawMessage(messageBuffer) {
        throw new Error('parseRawMessage is unimplemented!');
    }

    /* eslint-enable no-unused-vars */

    initDevice() {
        throw new Error('initDevice is unimplemented!');
    }

    async readResponse() {
        let timeoutHandle;
        const timeoutPromise = new Promise((resolve, reject) => {
            timeoutHandle = setTimeout(() => {
                this.readPromises.pop();
                reject('Timeout waiting for response');
            }, this.readTimeout);
        });

        const waitForReadPromise = new Promise((resolve) => {
            this.readPromises.push((data) => {
                resolve(data);
            });
        });

        return Promise.race([
            waitForReadPromise,
            timeoutPromise,
        ]).then((result) => {
            clearTimeout(timeoutHandle);
            return result;
        });
    }

    async sendPackage(command, payload) {
        const pkg = this.buildPayloadPackage(command, payload);
        this.log.debug(`TX: ${Buffer.isBuffer(pkg) ? pkg.toString('hex') : pkg}`);

        return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
            if (this.port == null) {
                throw new Error('The serial connection has not been created yet or creation was unsuccessful!');
            }

            // @ts-ignore
            this.port.write(pkg, async (error) => {
                if (error) {
                    reject('Error writing to serial connection');
                    return;
                }

                try {
                    const response = await this.readResponse();
                    this.validateResponse(pkg, response);
                    resolve(response);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    concatAndTrimParserBuffer(data) {
        this.parserBuffer = Buffer.concat([this.parserBuffer, data]);
        if (this.parserBuffer.length > this.maxParserBufferLength) {
            this.log.debug('Buffer too large - cutting to max length!');
            this.parserBuffer = this.parserBuffer.subarray(-1 * this.maxParserBufferLength);
        }
    }

    onData(data) {
        this.log.debug(`RX: ${data.toString('hex')}`);

        this.concatAndTrimParserBuffer(data);

        let messageBuffer = this.checkAndExtractMessage();

        while (messageBuffer !== null) {
            if (!this.isTelegramMessage(messageBuffer) && this.readPromises.length) {
                this.readPromises.shift()(messageBuffer);
            } else {
                this.emitMessage(messageBuffer);
            }
            messageBuffer = this.checkAndExtractMessage();
        }
    }

    // eslint-disable-next-line no-unused-vars
    isTelegramMessage(_messageBuffer) {
        return false;
    }

    emitMessage(messageBuffer) {
        this.log.debug(`Message received: ${messageBuffer.toString('hex')}`);
        const messageObject = this.parseRawMessage(messageBuffer);
        this.onMessage(messageObject);
    }

    initDeviceConnection() {
        if (!this.options.isTcp) {
            this.port = new SerialPort(this.options);

            this.port.on('data', this.onData.bind(this));
            this.port.on('error', this.onError);
        } else {
            this.closeRequested = false;
            this.port = new net.Socket();
            this.port.setKeepAlive(true, 0);

            this.port.connect(this.options.port, this.options.host);
            this.port.on('data', this.onData.bind(this));
            this.port.on('close', this.handleTcpClose.bind(this));
            this.port.on('error', this.onError);
        }
    }

    handleTcpClose(hadError) {
        if (hadError) {
            this.log.error('TCP socket was closed due to an transmission error');
        }
        if (!this.closeRequested) {
            this.log.debug('Reconnecting TCP socket');
            this.init();
        }
    }

    closeConnection() {
        if (this.port) {
            if (this.port instanceof SerialPort) {
                this.port.close();
            } else {
                this.closeRequested = true;
                this.port.end();
            }
        }
    }

    async init() {
        this.initDeviceConnection();

        try {
            await this.initDevice();
        } catch (error) {
            this.log.error(`Failed to init device: ${error}`);
            this.closeConnection();

            throw (error);
        }
    }
}

module.exports = SerialDevice;
