'use strict';

const SimpleLogger = require('../SimpleLogger');
const net = require('node:net');

class TcpReceiver {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        this.log = new SimpleLogger(loggerFunction);
        this.log.prefix = 'TCP';

        if (typeof onMessage !== 'function') {
            throw new Error('onMessage must be of type "function(data)"');
        }

        this.options = options;
        this.mode = mode;

        this.onMessage = onMessage;
        this.onError = onError;

        this.port = { on: () => {}, close: () => {} };

        this.parserBuffer = Buffer.alloc(0);

        this.server = net.createServer();
        this.server.on('connection', socket => {
            socket.on('data', this.onData.bind(this));
        });
    }

    onData(data) {
        const jsonString = data.toString('utf-8');
        this.log.debug(`Message received: ${jsonString}`);

        let message;
        try {
            const json = JSON.parse(jsonString);

            message = {
                frameType: json.frameType,
                containsCrc: json.containsCrc,
                rawData: Buffer.from(json.data, 'hex'),
                rssi: -1,
                ts: new Date().getTime(),
            };
        } catch (error) {
            // This is the data handler of a socket, where an exception is an
            // uncaught exception and terminates the adapter. It does not take a
            // sender with bad intentions either: a chunk can hold half a
            // telegram, or two of them.
            this.log.error(`Cannot read the telegram: ${error}`);
            return;
        }

        this.onMessage(message);
    }

    async init() {
        this.server.listen(Number(this.options.path), '127.0.0.1');
        this.log.info(`Listening on local port ${this.options.path}`);

        this.port = {
            on: () => {},
            close: () => {
                this.server.close();
            },
        };
    }

    async closeConnection() {
        // Without this the listening socket survives an adapter restart and
        // the next init() fails with EADDRINUSE.
        await new Promise(resolve => this.server.close(() => resolve(true)));
    }
}

module.exports = TcpReceiver;
