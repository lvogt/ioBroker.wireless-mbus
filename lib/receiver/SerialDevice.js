'use strict';

const { SerialPort } = require('serialport');
const net = require('node:net');
const SimpleLogger = require('../SimpleLogger');

/**
 * The timer functions the receivers use, always through this.timers and never
 * as the global functions: when the adapter passes in its own ones,
 * js-controller keeps track of the pending timers and clears them while
 * unloading the adapter - so a receiver waiting for a device response cannot
 * keep the process alive or fire a callback into a torn down adapter.
 * Standalone use falls back to the global timers.
 *
 * A handle must always be released with the clearTimeout that belongs to the
 * setTimeout which created it - the adapter hands out its own handle objects.
 *
 * @typedef {object} TimerFunctions
 * @property {(callback: () => void, ms: number) => TimerHandle} setTimeout schedules a callback and returns the handle to cancel it with
 * @property {(handle: TimerHandle) => void} clearTimeout cancels a scheduled callback
 */

/**
 * @typedef {NodeJS.Timeout | ioBroker.Timeout | undefined} TimerHandle
 */

class SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        this.log = new SimpleLogger(loggerFunction);

        if (typeof onMessage !== 'function') {
            throw new Error('onMessage must be of type "function(data)"');
        }

        // Two hooks the host can hand in: the unit tests emulate a device with a
        // SerialPortStream subclass, and the adapter provides its own timer
        // functions. Both are kept out of the options passed to the port
        // itself, which only knows about path, baudRate and the like.
        const { serialPortImpl, timers, ...portOptions } = options ?? {};
        /** @type {typeof SerialPort} */
        this.SerialPortImpl = serialPortImpl || SerialPort;
        /** @type {TimerFunctions} */
        this.timers = {
            setTimeout: typeof timers?.setTimeout === 'function' ? timers.setTimeout : globalThis.setTimeout,
            clearTimeout: typeof timers?.clearTimeout === 'function' ? timers.clearTimeout : globalThis.clearTimeout,
        };

        this.options = portOptions;
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

    buildPayloadPackage(_command, _payload) {
        throw new Error('buildPayloadPackage is unimplemented!');
    }

    validateResponse(_pkg, _response) {}

    checkAndExtractMessage() {
        throw new Error('checkAndExtractMessage is unimplemented!');
    }

    parseRawMessage(_messageBuffer) {
        throw new Error('parseRawMessage is unimplemented!');
    }

    initDevice() {
        throw new Error('initDevice is unimplemented!');
    }

    /**
     * Wait for the given number of milliseconds.
     *
     * The returned promise never settles if the adapter is unloaded while it is
     * pending, because the timer is then cleared without firing. That is
     * intended: whatever waited for it stops right there instead of continuing
     * to talk to a device that is being shut down.
     *
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => this.timers.setTimeout(() => resolve(), ms));
    }

    async readResponse() {
        let timeoutHandle;
        const timeoutPromise = new Promise((resolve, reject) => {
            timeoutHandle = this.timers.setTimeout(() => {
                this.readPromises.pop();
                reject('Timeout waiting for response');
            }, this.readTimeout);
        });

        const waitForReadPromise = new Promise(resolve => {
            this.readPromises.push(data => {
                resolve(data);
            });
        });

        return Promise.race([waitForReadPromise, timeoutPromise]).then(result => {
            this.timers.clearTimeout(timeoutHandle);
            return result;
        });
    }

    async sendPackage(command, payload) {
        const pkg = this.buildPayloadPackage(command, payload);
        this.log.debug(`TX: ${Buffer.isBuffer(pkg) ? pkg.toString('hex') : pkg}`);

        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            if (this.port == null) {
                throw new Error('The serial connection has not been created yet or creation was unsuccessful!');
            }

            // @ts-expect-error port is SerialPort | net.Socket - both have write(), but with different overloads
            this.port.write(pkg, async error => {
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
            this.port = new this.SerialPortImpl(this.options);

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

    async closeConnection() {
        // Must be set before the socket goes down: handleTcpClose() reconnects
        // unless a close was explicitly requested.
        this.closeRequested = true;

        const port = this.port;
        this.port = null;

        if (!port) {
            return;
        }

        await new Promise(resolve => {
            if (port instanceof this.SerialPortImpl) {
                // the callback reports an already closed port as an error,
                // which is not interesting while shutting down
                port.close(() => resolve(true));
            } else {
                // net.Socket has no close(), only end()
                port.end(() => resolve(true));
            }
        });
    }

    async init() {
        this.initDeviceConnection();

        try {
            await this.initDevice();
        } catch (error) {
            this.log.error(`Failed to init device: ${error}`);
            await this.closeConnection();

            throw error;
        }
    }
}

module.exports = SerialDevice;
