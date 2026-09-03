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

        // Receivers that are streaming telegrams by the time the port is
        // opened set this to the number of msec to wait for the leftovers of a
        // frame before the first command is sent
        this.staleDataTimeout = 0;

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

    /**
     * Take the next message out of the parser buffer, for the protocols that
     * announce the length of a message in its header.
     *
     * A message is only accepted where it is complete and intact, so that the
     * receiver finds its way back into the stream after a byte was lost or
     * added. Without that, every message after such a glitch is cut at the
     * wrong place and the garbage is handed out as the answer to a command or
     * emitted as a telegram of a device that does not exist.
     *
     * A candidate that announces more than has arrived is kept, because it may
     * be a message that is still being received. It loses that benefit of the
     * doubt as soon as a valid message follows it: bytes arrive in order, so
     * something complete behind it proves that it never was the start of one.
     *
     * @param {number|null} startByte the byte every message starts with, or
     * null if the protocol has no such marker and every position in the buffer
     * is a candidate
     * @param {(candidate: Buffer) => number} getLength the length of the
     * message the candidate starts with: -1 while its header is incomplete, 0
     * if the candidate cannot be the start of a message at all
     * @param {(message: Buffer) => boolean} isIntact whether a complete
     * message is intact - it must not accept a slice that only looks the part
     * @returns {Buffer|null} the next message, or null if the buffer holds none
     */
    extractMessageByLength(startByte, getLength, isIntact) {
        const findStart = from => {
            if (startByte === null) {
                return from < this.parserBuffer.length ? from : -1;
            }
            return this.parserBuffer.indexOf(startByte, from);
        };

        // Where the first message that may only be partly received starts
        let incompleteStart = -1;

        for (let start = findStart(0); start !== -1; start = findStart(start + 1)) {
            const candidate = this.parserBuffer.subarray(start);
            const expectedLength = getLength(candidate);

            if (expectedLength === 0) {
                continue;
            }

            if (expectedLength === -1 || candidate.length < expectedLength) {
                if (incompleteStart === -1) {
                    incompleteStart = start;
                }
                continue;
            }

            const messageBuffer = candidate.subarray(0, expectedLength);

            if (isIntact(messageBuffer)) {
                this.parserBuffer = candidate.subarray(expectedLength);
                return messageBuffer;
            }
        }

        const keepFrom = incompleteStart === -1 ? this.parserBuffer.length : incompleteStart;
        if (keepFrom) {
            this.log.debug(`Discarding ${keepFrom} byte(s) that start no message`);
            this.parserBuffer = this.parserBuffer.subarray(keepFrom);
        }
        return null;
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
        /** @type {(data: Buffer) => void} */
        let reader;
        const waitForReadPromise = new Promise(resolve => {
            reader = data => resolve(data);
            this.readPromises.push(reader);
        });

        let timeoutHandle;
        const timeoutPromise = new Promise((_resolve, reject) => {
            timeoutHandle = this.timers.setTimeout(() => {
                // Remove this reader, not whichever happens to be the last one:
                // a response that arrives late must not be handed out as the
                // answer to the next command.
                const index = this.readPromises.indexOf(reader);
                if (index !== -1) {
                    this.readPromises.splice(index, 1);
                }
                reject('Timeout waiting for response');
            }, this.readTimeout);
        });

        try {
            return await Promise.race([waitForReadPromise, timeoutPromise]);
        } finally {
            this.timers.clearTimeout(timeoutHandle);
        }
    }

    async sendPackage(command, payload) {
        const pkg = this.buildPayloadPackage(command, payload);
        this.log.debug(`TX: ${Buffer.isBuffer(pkg) ? pkg.toString('hex') : pkg}`);

        const port = this.port;
        if (port == null) {
            // Throwing rejects the promise of this async function, which is
            // what the caller waits for. Inside a promise executor it would be
            // an unhandled rejection instead, and adapter-core terminates the
            // adapter over one of those.
            throw new Error('The serial connection has not been created yet or creation was unsuccessful!');
        }

        await new Promise((resolve, reject) => {
            // @ts-expect-error port is SerialPort | net.Socket - both have write(), but with different overloads
            port.write(pkg, error => (error ? reject('Error writing to serial connection') : resolve(true)));
        });

        const response = await this.readResponse();
        this.validateResponse(pkg, response);
        return response;
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

        try {
            this.dispatchMessages();
        } catch (error) {
            // This runs in the "data" handler of the port, where an exception
            // is an uncaught exception and takes the whole adapter down. Drop
            // what is in the buffer and resynchronise on the next message.
            this.log.error(`Error while processing received data: ${error}`);
            this.parserBuffer = Buffer.alloc(0);
        }
    }

    dispatchMessages() {
        let messageBuffer = this.checkAndExtractMessage();

        while (messageBuffer !== null) {
            if (this.isTelegramMessage(messageBuffer)) {
                this.emitMessage(messageBuffer);
            } else if (this.readPromises.length) {
                this.readPromises.shift()(messageBuffer);
            } else {
                // The answer to a command that has given up waiting, or a
                // notification the adapter does not use: handing it to the
                // telegram parser produces nonsense at best. Logged rather
                // than passed over in silence, because it is also the only
                // trace left if a receiver ever reports telegrams in a way
                // that isTelegramMessage() does not recognise.
                const hex = Buffer.isBuffer(messageBuffer) ? messageBuffer.toString('hex') : messageBuffer;
                this.log.info(`Nothing is waiting for this message - dropped: ${hex}`);
            }

            messageBuffer = this.checkAndExtractMessage();
        }
    }

    /**
     * Whether a message is a telegram rather than the answer to a command.
     *
     * The default is the best a protocol that does not mark the difference can
     * do: whatever arrives while a command is waiting for its answer is that
     * answer, and everything else is a telegram. Receivers whose messages say
     * what they are override it - only then can a message that nobody expects
     * be recognised as one and dropped.
     */
    isTelegramMessage(_messageBuffer) {
        return this.readPromises.length === 0;
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

        if (this.closeRequested) {
            return;
        }

        // Report the close instead of calling init() again: the adapter then
        // closes this receiver and connects a new one, with a delay that grows
        // while the connection keeps failing. Reconnecting from here meant an
        // init() whose rejection nobody was waiting for - and a receiver that
        // came back but stayed silent terminated the adapter with an unhandled
        // rejection, while the adapter still believed it was connected.
        this.log.debug('TCP socket was closed');
        this.onError(new Error('TCP connection closed'));
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

    /**
     * A receiver that is still in receive mode keeps sending telegrams, so the
     * first bytes read after opening the port are usually the tail of a frame.
     * After an adapter restart that is the normal case rather than the
     * exception, so wait for them and drop them instead of letting the first
     * command deal with the fragment.
     */
    async discardStaleData() {
        if (!this.staleDataTimeout) {
            return;
        }

        await this.delay(this.staleDataTimeout);

        if (this.parserBuffer.length) {
            this.log.debug(`Discarding stale data: ${this.parserBuffer.toString('hex')}`);
            this.parserBuffer = Buffer.alloc(0);
        }
    }

    async init() {
        this.initDeviceConnection();

        try {
            await this.discardStaleData();
            await this.initDevice();
        } catch (error) {
            this.log.error(`Failed to init device: ${error}`);
            await this.closeConnection();

            throw error;
        }
    }
}

module.exports = SerialDevice;
