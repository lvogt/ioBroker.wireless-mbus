/*
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * ioBroker wmbus adapter
 *
 * Copyright (c) 2019 ISFH
 * This work is licensed under the terms of the GPL2 license.
 * See NOTICE for detailed listing of other contributors
 *
 * This file contains large portions from the ioBroker mbus adapter
 * by Apollon77 which is originally published under the MIT License.
 *
 * Adapter loading data from an wM-Bus devices
 *
 */

'use strict';

const utils = require('@iobroker/adapter-core');

const { WirelessMbusParser, guessDeviceId } = require('wireless-mbus-parser');
const { listReceivers, getReceiver } = require('./lib/receiver');
const ObjectHelper = require('./lib/ObjectHelper.js');
const { SerialPort } = require('serialport');

// Parse errors that are expected during normal operation and must not count
// towards the auto blocklist. A compact frame (CI 0x79) can only be decoded
// once a full frame with the same header signature has primed the parser's
// cache, so the first one from every device always fails.
const EXPECTED_PARSER_ERRORS = ['DATA_RECORD_CACHE_MISSING'];

class WirelessMbus extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'wireless-mbus',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.objectHelper = new ObjectHelper(this);

        this.receivers = {};

        this.connected = false;
        this.receiver = null;
        // One long lived instance: the parser caches data record headers per
        // instance to decode compact frames, so it must survive between
        // telegrams.
        this.parser = new WirelessMbusParser();

        this.failedDevices = [];
        this.needsKey = [];

        this.createdDevices = [];
        this.stateValues = {};
    }

    async onUnload(callback) {
        const receiver = this.receiver;
        this.receiver = null;

        try {
            // closeConnection() rather than port.close(): it also marks the
            // close as requested, without which a serial-over-TCP connection
            // reconnects itself while the adapter is shutting down.
            if (receiver) {
                await receiver.closeConnection();
            }
        } catch (error) {
            this.log.warn(`Error while closing the receiver connection: ${error}`);
        } finally {
            callback && callback();
        }
    }

    async onReady() {
        const objConnection = {
            _id: 'info.connection',
            type: 'state',
            common: {
                role: 'indicator.connected',
                name: 'If connected to wM-Bus receiver',
                type: 'boolean',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        };
        await this.objectHelper.createObject(objConnection._id, objConnection);

        const objRaw = {
            _id: 'info.rawdata',
            type: 'state',
            common: {
                role: 'value',
                name: 'Telegram raw data if parser failed',
                type: 'string',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        };
        await this.objectHelper.createObject(objRaw._id, objRaw);

        if (typeof this.config.aeskeys !== 'undefined') {
            this.config.aeskeys.forEach(item => {
                if (item.key === 'UNKNOWN') {
                    this.needsKey.push(item.id);
                }
            });
        }

        this.receivers = listReceivers();
        this.setConnected(false);

        const port = typeof this.config.serialPort !== 'undefined' ? this.config.serialPort : '/dev/ttyWMBUS';
        // @ts-expect-error serialBaudRate is typed as number, but the admin UI may store it as a string
        const baud = typeof this.config.serialBaudRate !== 'undefined' ? parseInt(this.config.serialBaudRate) : 9600;
        const options = this.createOptions(port, baud);

        const receiverInfo = getReceiver(this.config.deviceType);

        if (!receiverInfo) {
            this.log.error(`No or unknown adapter type selected! ${this.config.deviceType}`);
            return;
        }

        const mode = this.resolveMode(receiverInfo, this.config.wmbusMode);

        try {
            this.receiver = new receiverInfo.ReceiverClass(
                {
                    ...options,
                    // Timers created through the adapter are cleared by
                    // js-controller when the adapter is unloaded.
                    timers: {
                        setTimeout: this.setTimeout.bind(this),
                        clearTimeout: this.clearTimeout.bind(this),
                    },
                },
                mode,
                this.dataReceived.bind(this),
                this.serialError.bind(this),
                {
                    debug: this.log.debug,
                    info: this.log.info,
                    error: this.log.error,
                },
            );
            this.log.debug(`Created device of type: ${receiverInfo.name}`);

            await this.receiver.init();
            this.setConnected(true);
        } catch (e) {
            this.log.error(`Error opening serial port ${port} with baudrate ${baud}`);
            // @ts-expect-error the catch binding is `unknown`, log.error expects a string
            this.log.error(e);
            this.setConnected(false);
            return;
        }
    }

    /**
     * A configured mode can belong to a different receiver - the admin UI
     * resets it when the receiver changes, but a configuration written before
     * that, or edited outside the UI, can still carry a stale value. Falling
     * back to the receiver's first mode beats initialising the hardware with
     * one it does not know.
     */
    resolveMode(receiverInfo, configuredMode) {
        const modes = Object.keys(receiverInfo.modes);

        if (modes.includes(configuredMode)) {
            return configuredMode;
        }

        if (!modes.length) {
            return configuredMode;
        }

        this.log.warn(
            `Mode "${configuredMode}" is not supported by ${receiverInfo.name} - falling back to "${modes[0]}"`,
        );
        return modes[0];
    }

    createOptions(port, baud) {
        const matches = String(port).match(/tcp:\/\/([^:]+):(\d+)/);
        if (matches) {
            return { isTcp: true, host: matches[1], port: parseInt(matches[2]) };
        }
        return { path: port, baudRate: baud };
    }

    async serialError(err) {
        this.log.error(`Serialport error: ${err.message}`);
        this.setConnected(false);
        // A second error for the same connection finds this.receiver already
        // cleared and becomes a no-op.
        await this.onUnload();
    }

    setConnected(isConnected) {
        if (this.connected !== isConnected) {
            this.connected = isConnected;
            this.setState('info.connection', this.connected, true, err => {
                if (err) {
                    this.log.error(`Can not update connected state: ${err}`);
                } else {
                    this.log.debug(`connected set to ${this.connected}`);
                }
            });
        }
    }

    async dataReceived(data) {
        this.setConnected(true);

        const id = guessDeviceId(data.rawData);

        if (data.rawData.length < 11) {
            if (id == 'ERR-XXXXXXXX') {
                this.log.info(`Invalid telegram received? ${data.rawData.toString('hex')}`);
            } else {
                this.log.debug(`Beacon of device: ${id}`);
            }
            return;
        }

        // check block list
        if (this.isDeviceBlocked(id)) {
            this.log.debug(`Device is blocked: ${id}`);
            return;
        }

        const key = this.getAesKeyBuffer(id);

        let result;
        try {
            // verbose is required by toLegacyResult()
            const parsed = await this.parser.parse(data.rawData, {
                verbose: true,
                containsCrc: data.containsCrc,
                key: key,
            });
            result = WirelessMbusParser.toLegacyResult(parsed);
        } catch (error) {
            this.handleParserError(id, data, error);
            return;
        }

        this.resetAutoBlocklist(id);

        const deviceId = `${result.deviceInformation.Manufacturer}-${result.deviceInformation.Id}`;
        await this.updateDevice(deviceId, result);
    }

    handleParserError(id, data, error) {
        const name = error && error.name ? error.name : 'UNKNOWN_ERROR';
        const isExpected = EXPECTED_PARSER_ERRORS.includes(name);

        if (isExpected) {
            // A compact frame that arrived before the matching full frame is
            // normal - do not treat it as a device failure.
            this.log.debug(`Waiting for a full frame to decode compact telegrams of device ${id} (${name})`);
            return;
        }

        this.log.debug(`Parser failed to parse telegram from device ${id}: ${name} - ${error && error.message}`);
        if (this.config.autoBlocklist) {
            this.checkAutoBlocklist(id);
        }

        this.setState('info.rawdata', data.rawData.toString('hex'), true);
        this.checkWrongKey(id, name);
    }

    /**
     * Resolve the configured AES key for a device into the Buffer the parser
     * expects. Keys are stored either as 32 hex characters or as a 16
     * character plain text key.
     */
    getAesKeyBuffer(id) {
        const key = this.getAesKey(id);

        if (typeof key === 'undefined' || key === 'UNKNOWN') {
            return undefined;
        }

        if (key.length === 32) {
            const buffer = Buffer.from(key, 'hex');
            if (buffer.length === 16) {
                this.log.debug(`Found AES key for device ${id}`);
                return buffer;
            }
        } else if (key.length === 16) {
            this.log.debug(`Found AES key for device ${id}`);
            return Buffer.from(key, 'latin1');
        }

        this.log.error(`Invalid AES key configured for device ${id} - key rejected!`);
        return undefined;
    }

    isDeviceBlocked(id) {
        if (typeof this.config.blacklist === 'undefined' || !this.config.blacklist.length) {
            return false;
        }

        const found = this.config.blacklist.find(item => {
            if (typeof item.id === 'undefined') {
                return false;
            }
            return item.id == id;
        });

        if (typeof found !== 'undefined') {
            // found
            return true;
        }
        return false;
    }

    checkAutoBlocklist(id) {
        const i = this.failedDevices.findIndex(dev => dev.id == id);
        if (i === -1) {
            this.failedDevices.push({ id: id, count: 1 });
        } else {
            this.failedDevices[i].count++;
            if (this.failedDevices[i].count >= 10) {
                this.config.blacklist.push({ id: id });
                this.log.warn(`Device ${id} is now blocked until adapter restart!`);
            }
        }
    }

    resetAutoBlocklist(id) {
        const i = this.failedDevices.findIndex(dev => dev.id == id);
        if (i !== -1 && this.failedDevices[i].count) {
            this.failedDevices[i].count = 0;
        }
    }

    checkWrongKey(id, errorName) {
        if (errorName === 'NO_AES_KEY') {
            if (typeof this.needsKey.find(el => el == id) === 'undefined') {
                this.needsKey.push(id);
            }
        }
    }

    getAesKey(id) {
        if (typeof this.config.aeskeys === 'undefined' || !this.config.aeskeys.length) {
            return undefined;
        }

        // look for perfect match
        const perfectMatch = this.config.aeskeys.find(item => {
            if (typeof item.id === 'undefined') {
                return false;
            }
            return item.id == id;
        });

        if (typeof perfectMatch !== 'undefined') {
            // found
            return perfectMatch.key;
        }

        // which device names start with our id
        const candidates = this.config.aeskeys.filter(item => {
            if (typeof item.id === 'undefined') {
                return false;
            }
            return id.startsWith(item.id);
        });

        if (candidates.length == 1) {
            // only 1 match - take it
            return candidates[0].key;
        }

        if (candidates.length > 1) {
            // more than one, find the best
            let len = candidates[0].id.length;
            let pos = 0;
            for (let i = 1; i < candidates.length; i++) {
                if (candidates[i].id.length > len) {
                    len = candidates[i].id.length;
                    pos = i;
                }
            }
            return candidates[pos].key;
        }

        return undefined;
    }

    async updateDevice(deviceId, result) {
        if (this.createdDevices.indexOf(deviceId) == -1) {
            await this.createDeviceObjects(deviceId, result);
        }

        this.updateDeviceStates(deviceId, result);
    }

    async createDeviceObjects(deviceId, data) {
        this.log.debug(`Creating device: ${deviceId}`);
        await this.objectHelper.createDeviceOrChannel('device', deviceId);
        await this.objectHelper.createDeviceOrChannel('channel', `${deviceId}.data`);
        await this.objectHelper.createDeviceOrChannel('channel', `${deviceId}.info`);

        for (const key of Object.keys(data.deviceInformation)) {
            await this.objectHelper.createInfoState(deviceId, key);
        }

        await this.objectHelper.createInfoState(deviceId, 'Updated');

        for (const item of data.dataRecord) {
            await this.objectHelper.createDataState(deviceId, item);
        }

        this.createdDevices.push(deviceId);
    }

    async updateDeviceStates(deviceId, data) {
        this.log.debug(`Updating device: ${deviceId}`);
        for (const key of Object.keys(data.deviceInformation)) {
            const name = `${deviceId}.info.${key}`;
            if (
                typeof this.stateValues[name] === 'undefined' ||
                this.stateValues[name] !== data.deviceInformation[key]
            ) {
                this.stateValues[name] = data.deviceInformation[key];
                await this.objectHelper.updateState(name, data.deviceInformation[key]);
            }
        }

        await this.objectHelper.updateState(`${deviceId}.info.Updated`, Math.floor(Date.now() / 1000));

        for (const item of data.dataRecord) {
            const name = `${deviceId}.data.${item.number}-${item.storageNo}-${item.type}`;
            if (
                this.config.alwaysUpdate ||
                typeof this.stateValues[name] === 'undefined' ||
                this.stateValues[name] !== item.value
            ) {
                this.stateValues[name] = item.value;

                let val = item.value;
                if (this.config.forcekWh) {
                    if (item.unit == 'Wh') {
                        val = val / 1000;
                    } else if (item.unit == 'J') {
                        val = val / 3600000;
                    }
                }

                this.log.debug(`Value ${name}: ${val}`);
                await this.objectHelper.updateState(name, val);
            }
        }
    }

    /**
     * The serial ports as jsonConfig selectSendTo options. The control is
     * configured with "manual": true, so a port that is not listed - a
     * tcp://host:port address for instance - can still be typed in.
     */
    async listUartOptions() {
        if (!SerialPort) {
            this.log.warn('Module serialport is not available');
            return [];
        }

        try {
            const ports = await SerialPort.list();
            this.log.debug(`Found serial ports: ${JSON.stringify(ports)}`);
            return ports.map(port => ({
                label: port.manufacturer ? `${port.path} (${port.manufacturer})` : port.path,
                value: port.path,
            }));
        } catch (error) {
            this.log.error(`Could not list the serial ports: ${error}`);
            return [];
        }
    }

    /** The modes of one receiver as jsonConfig selectSendTo options. */
    listWmbusModeOptions(deviceType) {
        const receiver = getReceiver(deviceType);
        if (!receiver) {
            return [];
        }

        return Object.entries(receiver.modes).map(([value, label]) => ({ label, value }));
    }

    /**
     * Merge the devices that asked for a key into the configured key list, so
     * they only need the key filled in.
     *
     * The result goes to a jsonConfig sendTo control with "useNative", which
     * puts the returned native into the open form without saving anything -
     * deliberately no "saveConfig", because the added rows still carry the
     * placeholder key and saving now would restart the instance for a
     * configuration the user has not finished editing.
     *
     * The merge starts from the saved configuration, which is all the running
     * adapter knows about, so rows added in the form but not yet saved are
     * replaced. The button asks before doing that.
     */
    importNeedsKeyNative() {
        const aeskeys = Array.isArray(this.config.aeskeys) ? [...this.config.aeskeys] : [];
        let added = 0;

        for (const id of this.needsKey) {
            if (aeskeys.findIndex(item => item.id === id) === -1) {
                aeskeys.push({ id: id, key: 'UNKNOWN' });
                added++;
            }
        }

        return {
            native: { aeskeys },
            result: added ? `Added ${added} device(s)` : 'No new devices found',
        };
    }

    onMessage(obj) {
        if (typeof obj === 'object' && obj.callback) {
            switch (obj.command) {
                case 'listUart':
                    this.listUartOptions().then(options => this.sendTo(obj.from, obj.command, options, obj.callback));
                    break;
                case 'listReceiver':
                    this.sendTo(
                        obj.from,
                        obj.command,
                        Object.entries(this.receivers).map(([value, receiver]) => ({
                            label: receiver.name,
                            value,
                        })),
                        obj.callback,
                    );
                    break;
                case 'listWmbusMode':
                    this.sendTo(
                        obj.from,
                        obj.command,
                        this.listWmbusModeOptions(obj.message && obj.message.deviceType),
                        obj.callback,
                    );
                    break;
                case 'importNeedsKey':
                    this.sendTo(obj.from, obj.command, this.importNeedsKeyNative(), obj.callback);
                    break;
                case 'needsKey':
                    this.sendTo(obj.from, obj.command, this.needsKey, obj.callback);
                    break;
            }
        }
    }
}

if (require.main !== module) {
    module.exports = options => new WirelessMbus(options);
} else {
    new WirelessMbus();
}
