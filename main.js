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
const DeviceRegistry = require('./lib/DeviceRegistry.js');
const { SerialPort } = require('serialport');

// Parse errors that are expected during normal operation and must not count
// towards the auto blocklist. A compact frame (CI 0x79) can only be decoded
// once a full frame with the same header signature has primed the parser's
// cache, so the first one from every device always fails.
const EXPECTED_PARSER_ERRORS = ['DATA_RECORD_CACHE_MISSING'];

// How many telegrams of a device may fail to decode before the automatic
// block list rejects it
const AUTO_BLOCK_AFTER_FAILURES = 10;

// Delays between two attempts to connect to the receiver (msec). The first
// ones are quick, because the usual reason for a failed start is a telegram
// that was in flight; a receiver that stays away is asked every five minutes.
const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 300000;

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
        this.reconnectTimeout = null;
        this.reconnectDelay = INITIAL_RECONNECT_DELAY;
        this.reconnectAttempts = 0;
        // One long lived instance: the parser caches data record headers per
        // instance to decode compact frames, so it must survive between
        // telegrams. onReady() replaces it with one that knows the record
        // layouts of the devices that already exist.
        this.parser = new WirelessMbusParser();

        // Device id -> how many of its telegrams failed to decode in a row
        this.failedDevices = new Map();
        // Devices the automatic block list rejected, until the adapter is
        // restarted. Kept apart from this.config, which stays what the user
        // configured.
        this.blockedDevices = new Set();
        // Devices that asked for a key the configuration does not have
        this.needsKey = new Set();
        // Devices whose configured key was reported as unusable - once is
        // enough, the telegrams keep coming
        this.reportedInvalidKeys = new Set();

        // Devices whose objects have been created or verified in this run
        this.createdDevices = new Set();
        // The devices that have an object tree - which is what
        // "ignoreUnknownDevices" goes by - and the record layouts of their
        // telegrams
        this.deviceRegistry = new DeviceRegistry();
        this.stateValues = {};
    }

    async closeReceiver() {
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
        }
    }

    async onUnload(callback) {
        // An adapter timeout would be cleared by js-controller anyway, but
        // serialError() schedules one too and must not leave it behind.
        if (this.reconnectTimeout) {
            this.clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        await this.closeReceiver();
        callback && callback();
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
                // "value" is for numbers - this one holds a telegram as hex
                role: 'text',
                name: 'Telegram raw data if parser failed',
                type: 'string',
                read: true,
                write: false,
                def: '',
            },
            native: {},
        };
        await this.objectHelper.createObject(objRaw._id, objRaw);

        if (typeof this.config.aeskeys !== 'undefined') {
            this.config.aeskeys.forEach(item => {
                if (item.key === 'UNKNOWN') {
                    this.needsKey.add(item.id);
                }
            });
        }

        await this.loadKnownDevices();

        this.receivers = listReceivers();
        this.setConnected(false);

        await this.connectReceiver();
    }

    /**
     * Take over the devices that already have an object tree.
     *
     * They are what "ignoreUnknownDevices" decides by, and their objects are
     * the only place where the record layouts of their telegrams survive a
     * restart - so this has to happen before the receiver is opened.
     */
    async loadKnownDevices() {
        /** @type {ioBroker.DeviceObject[]} */
        let devices = [];

        try {
            devices = await this.getDevicesAsync();
        } catch (error) {
            this.log.warn(`Could not read the devices that already exist: ${error}`);
        }

        for (const device of devices) {
            this.deviceRegistry.add(device._id.substring(this.namespace.length + 1), device.native);
        }

        this.log.debug(`Found ${devices.length} device(s) with an object tree`);
        this.parser = this.createParser();
    }

    /**
     * A parser that knows the record layouts of all known devices, so that a
     * compact telegram is decoded right away rather than after the next full
     * telegram of the same meter.
     */
    createParser() {
        const cachedDataRecordHeaders = this.deviceRegistry.layouts();

        try {
            return new WirelessMbusParser({ cachedDataRecordHeaders });
        } catch (error) {
            // A stored layout the parser rejects must not cost the adapter its
            // ability to receive anything at all
            this.log.warn(`Stored data record headers were rejected by the parser: ${error}`);
            return new WirelessMbusParser();
        }
    }

    /**
     * Create the configured receiver and initialise the device.
     *
     * Initialisation can fail for a reason that is gone again a few seconds
     * later: a telegram that is in flight while the port is opened costs the
     * first command its response, which is the normal outcome of restarting
     * the adapter while the receiver is still in receive mode. Such a failure
     * used to leave the instance idle until someone restarted it by hand, so
     * keep trying with a growing delay instead.
     */
    async connectReceiver() {
        const port = typeof this.config.serialPort !== 'undefined' ? this.config.serialPort : '/dev/ttyWMBUS';
        // @ts-expect-error serialBaudRate is typed as number, but the admin UI may store it as a string
        const baud = typeof this.config.serialBaudRate !== 'undefined' ? parseInt(this.config.serialBaudRate) : 9600;
        const options = this.createOptions(port, baud);

        const receiverInfo = getReceiver(this.config.deviceType);

        if (!receiverInfo) {
            // Retrying cannot help - only a new configuration can
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
                    warn: this.log.warn,
                    error: this.log.error,
                },
            );
            this.log.debug(`Created device of type: ${receiverInfo.name}`);

            await this.receiver.init();
            this.setConnected(true);
            this.reconnectDelay = INITIAL_RECONNECT_DELAY;
            this.reconnectAttempts = 0;
        } catch (error) {
            this.logConnectionFailure(`Error opening serial port ${port} with baudrate ${baud}: ${error}`);
            this.setConnected(false);
            await this.closeReceiver();
            this.scheduleReconnect();
        }
    }

    /**
     * The first failure of an outage is worth an error, the attempts after it
     * are not: a receiver that stays unreachable would otherwise fill the log
     * with the same line for as long as it is away.
     */
    logConnectionFailure(message) {
        if (this.reconnectAttempts) {
            this.log.debug(message);
        } else {
            this.log.error(message);
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimeout) {
            // A failing connection reports itself twice more often than not:
            // the port emits an error and the pending command times out
            return;
        }

        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);

        const message = `Trying to connect to the receiver again in ${Math.round(delay / 1000)} seconds`;
        if (this.reconnectAttempts) {
            this.log.debug(message);
        } else {
            this.log.info(message);
        }
        this.reconnectAttempts++;

        this.reconnectTimeout = this.setTimeout(() => {
            this.reconnectTimeout = null;
            this.connectReceiver().catch(error => this.log.error(`Failed to connect to the receiver: ${error}`));
        }, delay);
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
        this.logConnectionFailure(`Serialport error: ${err.message}`);

        // A second error for the same connection finds this.receiver already
        // cleared - the connection is closed and a retry is pending already.
        if (!this.receiver) {
            return;
        }

        this.setConnected(false);
        await this.closeReceiver();
        this.scheduleReconnect();
    }

    async setConnected(isConnected) {
        if (this.connected === isConnected) {
            return;
        }

        this.connected = isConnected;

        try {
            await this.setStateAsync('info.connection', this.connected, true);
            this.log.debug(`connected set to ${this.connected}`);
        } catch (error) {
            this.log.error(`Can not update connected state: ${error}`);
        }
    }

    /**
     * The callback the receivers report a telegram to. Nobody waits for it, so
     * an exception in here would be an unhandled rejection - and adapter-core
     * terminates the adapter over one of those.
     */
    async dataReceived(data) {
        try {
            await this.handleTelegram(data);
        } catch (error) {
            this.log.error(`Error while handling a telegram: ${error}`);
        }
    }

    async handleTelegram(data) {
        this.setConnected(true);

        const id = guessDeviceId(data.rawData);

        if (data.rawData.length < 11) {
            if (id == 'ERR-XXXXXXXX') {
                this.log.debug(`Invalid telegram received? ${data.rawData.toString('hex')}`);
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

        let parsed;
        let result;
        try {
            // verbose is required by toLegacyResult()
            parsed = await this.parser.parse(data.rawData, {
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

        if (this.config.ignoreUnknownDevices && !this.deviceRegistry.has(deviceId)) {
            this.log.debug(`Device has no object tree and is ignored: ${deviceId}`);
            return;
        }

        await this.updateDevice(deviceId, result);
        await this.rememberDataRecordHeaders(deviceId, parsed);
    }

    /**
     * Keep the layout of the data records of a telegram with the device, so
     * that its compact telegrams can be decoded after a restart.
     *
     * @param {string} deviceId
     * @param {import('wireless-mbus-parser').ParserResultVerbose} parsed
     */
    async rememberDataRecordHeaders(deviceId, parsed) {
        const layout = WirelessMbusParser.getDataRecordHeadersCacheEntry(parsed);

        if (!this.deviceRegistry.learnLayout(deviceId, layout)) {
            return;
        }

        // The parser takes record layouts when it is created, and it keeps the
        // ones it decodes itself only after a compact telegram has asked for
        // them - so replace it with one that knows all of them, which is what
        // decodes the next compact telegram of this meter.
        this.parser = this.createParser();
        await this.objectHelper.updateDeviceNative(deviceId, this.deviceRegistry.nativeOf(deviceId));
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

        // A device without an object tree is none of the user's business while
        // "ignoreUnknownDevices" is on: a telegram of one that decodes is
        // dropped, so one that does not must not be reported either. The
        // address is the one of the link layer, because a telegram that failed
        // has told nothing else about itself.
        const muted = this.config.ignoreUnknownDevices && !this.deviceRegistry.has(id);

        if (this.config.autoBlocklist) {
            // Worth it either way - it saves the decoding of every telegram
            // the device sends from now on - but a device nobody wants to hear
            // about is blocked without a word.
            this.checkAutoBlocklist(id, muted);
        }

        if (muted) {
            return;
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

        if (!this.reportedInvalidKeys.has(id)) {
            this.reportedInvalidKeys.add(id);
            this.log.error(`Invalid AES key configured for device ${id} - key rejected!`);
        }

        return undefined;
    }

    isDeviceBlocked(id) {
        if (this.blockedDevices.has(id)) {
            return true;
        }

        if (!Array.isArray(this.config.blacklist)) {
            return false;
        }

        return this.config.blacklist.some(item => typeof item.id !== 'undefined' && item.id == id);
    }

    /**
     * @param {string} id
     * @param {boolean} [quiet] report the block in the debug log only
     */
    checkAutoBlocklist(id, quiet = false) {
        const failures = (this.failedDevices.get(id) ?? 0) + 1;
        this.failedDevices.set(id, failures);

        if (failures >= AUTO_BLOCK_AFTER_FAILURES && !this.blockedDevices.has(id)) {
            this.blockedDevices.add(id);
            const message = `Device ${id} is now blocked until adapter restart!`;
            if (quiet) {
                this.log.debug(message);
            } else {
                this.log.warn(message);
            }
        }
    }

    resetAutoBlocklist(id) {
        this.failedDevices.delete(id);
    }

    checkWrongKey(id, errorName) {
        if (errorName === 'NO_AES_KEY') {
            this.needsKey.add(id);
        }
    }

    /**
     * The configured key of a device. A configured id that the device id only
     * starts with counts as well, so one row can stand for a series of
     * meters - and the longest of them wins, which makes the exact match the
     * best possible one.
     */
    getAesKey(id) {
        const rows = Array.isArray(this.config.aeskeys) ? this.config.aeskeys : [];
        const candidates = rows.filter(row => typeof row.id !== 'undefined' && id.startsWith(row.id));

        if (!candidates.length) {
            return undefined;
        }

        return candidates.reduce((longest, row) => (row.id.length > longest.id.length ? row : longest)).key;
    }

    async updateDevice(deviceId, result) {
        if (!this.createdDevices.has(deviceId)) {
            await this.createDeviceObjects(deviceId, result);
        }

        await this.updateDeviceStates(deviceId, result);
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

        this.createdDevices.add(deviceId);
        this.deviceRegistry.add(deviceId);
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
     * Merge the devices that asked for a key into the key list, so they only
     * need the key filled in.
     *
     * The list to merge into comes from the open form, which the jsonConfig
     * control sends along - not from the saved configuration. Merging into
     * what the adapter has saved replaced whatever was in the form: rows typed
     * since the last save were lost, and so were saved rows whenever the
     * running instance had not picked them up yet.
     *
     * The result goes to a sendTo control with "useNative", which puts the
     * returned aeskeys into the open form without saving anything -
     * deliberately no "saveConfig", because the added rows still carry the
     * placeholder key and saving now would restart the instance for a
     * configuration the user has not finished editing.
     */
    importNeedsKeyNative(message) {
        const configured = message && Array.isArray(message.aeskeys) ? message.aeskeys : this.config.aeskeys;
        const aeskeys = Array.isArray(configured) ? [...configured] : [];
        let added = 0;

        for (const id of this.needsKey) {
            if (aeskeys.findIndex(item => item.id === id) === -1) {
                aeskeys.push({ id: id, key: 'UNKNOWN' });
                added++;
            }
        }

        // The result names a text of the jsonConfig control: a plain string
        // would not be shown at all next to a native that is used
        return {
            native: { aeskeys },
            result: added ? 'devicesAdded' : 'noNewDevices',
            args: [added],
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
                    this.sendTo(obj.from, obj.command, this.importNeedsKeyNative(obj.message), obj.callback);
                    break;
                case 'needsKey':
                    // A Set does not survive the message box
                    this.sendTo(obj.from, obj.command, [...this.needsKey], obj.callback);
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
