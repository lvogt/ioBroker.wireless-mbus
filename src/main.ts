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

import * as utils from '@iobroker/adapter-core';

import { WirelessMbusParser, guessDeviceId } from 'wireless-mbus-parser';
import { getReceiver } from './lib/receiver';
import ObjectHelper from './lib/ObjectHelper';
import DataStates, { dataStateId, dataStateName } from './lib/DataStates';
import TelegramVariants, { variantName } from './lib/TelegramVariants';
import DeviceRegistry from './lib/DeviceRegistry';
import AesKeys from './lib/AesKeys';
import BlockList from './lib/BlockList';
import AdminMessages from './lib/AdminMessages';
import { buildHandlers } from './lib/ManufacturerSpecific';
import type SerialDevice from './lib/receiver/SerialDevice';
import type TcpReceiver from './lib/receiver/TcpReceiver';
import type { LegacyResult, ManufacturerSpecificDataRecordHandler, ParserResultVerbose } from 'wireless-mbus-parser';
import type { ReceiverRegistryEntry } from './lib/receiver';
import type { ReceivedTelegram, SerialDeviceOptions } from './lib/receiver/SerialDevice';

// The build emits a source map next to every file, and they carry the source
// along - so a stack in the log can name the line of the TypeScript it came
// from instead of the transpiled one. Nothing else switches this on: the
// adapter is started by js-controller, which does not pass --enable-source-maps.
process.setSourceMapsEnabled(true);

/** Every receiver the registry can hand out. */
type Receiver = SerialDevice | TcpReceiver;

// Parse errors that are expected during normal operation and must not count
// towards the auto blocklist. A compact frame (CI 0x79) can only be decoded
// once a full frame with the same header signature has primed the parser's
// cache, so the first one from every device always fails.
const EXPECTED_PARSER_ERRORS = ['DATA_RECORD_CACHE_MISSING'];

// The CI field of a compact telegram, which carries its data records without
// their headers
const CI_COMPACT_FRAME = 0x79;

// Delays between two attempts to connect to the receiver (msec). The first
// ones are quick, because the usual reason for a failed start is a telegram
// that was in flight; a receiver that stays away is asked every five minutes.
const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 300000;

class WirelessMbus extends utils.Adapter {
    objectHelper: ObjectHelper;
    dataStates: DataStates;
    adminMessages: AdminMessages;
    /**
     * Whether the receiver is connected - not to be confused with the
     * "connected" of the adapter class, which says whether the adapter reaches
     * the databases. js-controller stops an adapter that cannot reach them,
     * and decides that by a flag of that name.
     *
     * Undefined until the first answer, so that onReady() reports a receiver
     * that is not connected yet rather than leaving the state of the run
     * before - which said "connected" whenever that run ended while it was.
     */
    receiverConnected: boolean | undefined;
    receiver: Receiver | null;
    reconnectTimeout: ioBroker.Timeout | undefined;
    reconnectDelay: number;
    reconnectAttempts: number;
    parser: WirelessMbusParser;
    aesKeys: AesKeys;
    blockList: BlockList;
    createdDevices: Set<string>;
    deviceRegistry: DeviceRegistry;
    telegramVariants: TelegramVariants;
    manufacturerSpecificHandlers: Record<string, ManufacturerSpecificDataRecordHandler>;
    stateValues: Record<string, unknown>;

    constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'wireless-mbus',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));

        this.objectHelper = new ObjectHelper(this);
        this.dataStates = new DataStates(this, this.objectHelper);

        this.receiverConnected = undefined;
        this.receiver = null;
        this.reconnectTimeout = null;
        this.reconnectDelay = INITIAL_RECONNECT_DELAY;
        this.reconnectAttempts = 0;
        // One long lived instance: the parser caches data record headers per
        // instance to decode compact frames, so it must survive between
        // telegrams. onReady() replaces it with one that knows the record
        // layouts of the devices that already exist.
        this.parser = new WirelessMbusParser();

        // Both read the configuration, which onReady() has not seen yet - so
        // they are replaced there with ones that know it.
        this.aesKeys = new AesKeys([], this.log);
        this.blockList = new BlockList([], {}, this.log);
        this.telegramVariants = new TelegramVariants([]);
        this.adminMessages = new AdminMessages(this, this.aesKeys, this.telegramVariants);

        // Devices whose objects have been created or verified in this run
        this.createdDevices = new Set();
        // The devices that have an object tree - which is what
        // "ignoreUnknownDevices" goes by - and the record layouts of their
        // telegrams
        this.deviceRegistry = new DeviceRegistry();
        // Configured descriptions of manufacturer specific data records, as
        // the handlers the parser takes
        this.manufacturerSpecificHandlers = {};
        this.stateValues = {};
    }

    async closeReceiver(): Promise<void> {
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

    async onUnload(callback: () => void): Promise<void> {
        // An adapter timeout would be cleared by js-controller anyway, but
        // serialError() schedules one too and must not leave it behind.
        if (this.reconnectTimeout) {
            this.clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        await this.closeReceiver();
        callback && callback();
    }

    async onReady(): Promise<void> {
        await this.objectHelper.createObject('info.connection', {
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
        });

        await this.objectHelper.createObject('info.rawdata', {
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
        });

        this.aesKeys = new AesKeys(this.config.aeskeys, this.log);
        this.blockList = new BlockList(this.config.blacklist, { auto: this.config.autoBlocklist }, this.log);
        this.telegramVariants = new TelegramVariants(this.config.ignoredVariants, this.log);
        this.adminMessages = new AdminMessages(this, this.aesKeys, this.telegramVariants);

        this.loadManufacturerSpecificDescriptions();
        await this.loadKnownDevices();
        // what is known about the objects has to follow what is deleted
        await this.subscribeObjectsAsync('*');

        await this.setConnected(false);

        await this.connectReceiver();
    }

    /**
     * Take over the descriptions of manufacturer specific data records.
     *
     * A description the parser rejects is reported and left out rather than
     * taken along: it is configuration somebody typed, and the meters of the
     * other descriptions have nothing to do with it. This has to happen before
     * the parser is created.
     */
    loadManufacturerSpecificDescriptions(): void {
        const { handlers, reports, error } = buildHandlers(this.config.manufacturerSpecific);

        if (error) {
            this.log.warn(`The manufacturer specific descriptions are ignored: they are ${error}`);
        }

        for (const report of reports.filter(entry => entry.error)) {
            this.log.warn(`The description of ${report.manufacturer} is ignored: it ${report.message}`);
        }

        const manufacturers = Object.keys(handlers);
        if (manufacturers.length) {
            this.log.info(`Describing the manufacturer specific data of ${manufacturers.join(', ')}`);
        }

        this.manufacturerSpecificHandlers = handlers;
    }

    /**
     * Take over the devices that already have an object tree.
     *
     * They are what "ignoreUnknownDevices" decides by, and their objects are
     * the only place where the record layouts of their telegrams survive a
     * restart - so this has to happen before the receiver is opened. The same
     * goes for the data states, which say what record each of them stands for.
     */
    async loadKnownDevices(): Promise<void> {
        let devices: ioBroker.DeviceObject[] = [];

        try {
            devices = await this.getDevicesAsync();
        } catch (error) {
            this.log.warn(`Could not read the devices that already exist: ${error}`);
        }

        for (const device of devices) {
            const deviceId = device._id.substring(this.namespace.length + 1);
            this.deviceRegistry.add(deviceId, device.native);
            this.telegramVariants.add(deviceId, device.native);
        }

        this.log.debug(`Found ${devices.length} device(s) with an object tree`);
        this.parser = this.createParser();

        await this.dataStates.load();
    }

    /**
     * A parser that knows the record layouts of all known devices, so that a
     * compact telegram is decoded right away rather than after the next full
     * telegram of the same meter.
     */
    createParser(): WirelessMbusParser {
        const cachedDataRecordHeaders = this.deviceRegistry.layouts();

        try {
            return new WirelessMbusParser({
                cachedDataRecordHeaders,
                manufacturerSpecificHandlers: this.manufacturerSpecificHandlers,
            });
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
    async connectReceiver(): Promise<void> {
        const port = typeof this.config.serialPort !== 'undefined' ? this.config.serialPort : '/dev/ttyWMBUS';
        // the admin UI may store this as a string, so go through String()
        const baud =
            typeof this.config.serialBaudRate !== 'undefined' ? parseInt(String(this.config.serialBaudRate)) : 9600;
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

            await this.receiver?.init();
            await this.setConnected(true);
            this.reconnectDelay = INITIAL_RECONNECT_DELAY;
            this.reconnectAttempts = 0;
        } catch (error) {
            this.logConnectionFailure(`Error opening serial port ${port} with baudrate ${baud}: ${error}`);
            await this.setConnected(false);
            await this.closeReceiver();
            this.scheduleReconnect();
        }
    }

    /**
     * The first failure of an outage is worth an error, the attempts after it
     * are not: a receiver that stays unreachable would otherwise fill the log
     * with the same line for as long as it is away.
     */
    logConnectionFailure(message: string): void {
        if (this.reconnectAttempts) {
            this.log.debug(message);
        } else {
            this.log.error(message);
        }
    }

    scheduleReconnect(): void {
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
    resolveMode(receiverInfo: ReceiverRegistryEntry, configuredMode: string): string {
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

    createOptions(port: string, baud: number): SerialDeviceOptions {
        const matches = String(port).match(/tcp:\/\/([^:]+):(\d+)/);
        if (matches) {
            return { isTcp: true, host: matches[1], port: parseInt(matches[2]) };
        }
        return { path: port, baudRate: baud };
    }

    async serialError(err: Error): Promise<void> {
        this.logConnectionFailure(`Serialport error: ${err.message}`);

        // A second error for the same connection finds this.receiver already
        // cleared - the connection is closed and a retry is pending already.
        if (!this.receiver) {
            return;
        }

        await this.setConnected(false);
        await this.closeReceiver();
        this.scheduleReconnect();
    }

    async setConnected(isConnected: boolean): Promise<void> {
        if (this.receiverConnected === isConnected) {
            return;
        }

        this.receiverConnected = isConnected;

        try {
            await this.setStateAsync('info.connection', this.receiverConnected, true);
            this.log.debug(`connected set to ${this.receiverConnected}`);
        } catch (error) {
            this.log.error(`Can not update connected state: ${error}`);
        }
    }

    /**
     * The callback the receivers report a telegram to. Nobody waits for it, so
     * an exception in here would be an unhandled rejection - and adapter-core
     * terminates the adapter over one of those.
     */
    async dataReceived(data: ReceivedTelegram): Promise<void> {
        try {
            await this.handleTelegram(data);
        } catch (error) {
            this.log.error(`Error while handling a telegram: ${error}`);
        }
    }

    async handleTelegram(data: ReceivedTelegram): Promise<void> {
        await this.setConnected(true);

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
        if (this.blockList.isBlocked(id)) {
            this.log.debug(`Device is blocked: ${id}`);
            return;
        }

        const key = this.aesKeys.getKeyBuffer(id);

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
            await this.handleParserError(id, data, error);
            return;
        }

        this.blockList.noteSuccess(id);

        const deviceId = `${result.deviceInformation.Manufacturer}-${result.deviceInformation.Id}`;

        if (this.config.ignoreUnknownDevices && !this.deviceRegistry.has(deviceId)) {
            this.log.debug(`Device has no object tree and is ignored: ${deviceId}`);
            return;
        }

        // Only known once the telegram is decoded: the crc of its record
        // headers is what tells the variants of a meter apart
        if (this.telegramVariants.isIgnored(deviceId, parsed.dataRecordHeadersCrc)) {
            this.log.debug(`Ignoring telegram variant ${variantName(parsed.dataRecordHeadersCrc)} of ${deviceId}`);
            await this.noteTelegramVariant(deviceId, parsed, result);
            return;
        }

        await this.updateDevice(deviceId, result, parsed);
        await this.rememberDataRecordHeaders(deviceId, parsed);
        await this.noteTelegramVariant(deviceId, parsed, result);
    }

    /**
     * Count the telegram with the variant it belongs to - an ignored one as
     * well, so that the admin UI shows it still arrives.
     *
     * @param deviceId
     * @param parsed
     * @param result
     */
    async noteTelegramVariant(deviceId: string, parsed: ParserResultVerbose, result: LegacyResult): Promise<void> {
        const frame = parsed.applicationLayer.ci === CI_COMPACT_FRAME ? 'compact' : 'full';
        const states = result.dataRecord.map(dataStateName);
        const persist = this.telegramVariants.note(deviceId, parsed.dataRecordHeadersCrc, frame, states);

        // A device without an object tree has no object to keep them in: its
        // only telegrams so far were ignored ones
        if (persist && this.deviceRegistry.has(deviceId)) {
            await this.objectHelper.updateDeviceNative(deviceId, this.telegramVariants.nativeOf(deviceId));
        }
    }

    /**
     * Keep the layout of the data records of a telegram with the device, so
     * that its compact telegrams can be decoded after a restart.
     *
     * @param deviceId
     * @param parsed
     */
    async rememberDataRecordHeaders(deviceId: string, parsed: ParserResultVerbose): Promise<void> {
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

    async handleParserError(id: string, data: ReceivedTelegram, error: unknown): Promise<void> {
        // the parser throws a ParserError, but a telegram can trip anything
        const thrown = error instanceof Error ? error : undefined;
        const name = thrown?.name || 'UNKNOWN_ERROR';
        const isExpected = EXPECTED_PARSER_ERRORS.includes(name);

        if (isExpected) {
            // A compact frame that arrived before the matching full frame is
            // normal - do not treat it as a device failure.
            this.log.debug(`Waiting for a full frame to decode compact telegrams of device ${id} (${name})`);
            return;
        }

        this.log.debug(`Parser failed to parse telegram from device ${id}: ${name} - ${thrown?.message}`);

        // A device without an object tree is none of the user's business while
        // "ignoreUnknownDevices" is on: a telegram of one that decodes is
        // dropped, so one that does not must not be reported either. The
        // address is the one of the link layer, because a telegram that failed
        // has told nothing else about itself.
        const muted = this.config.ignoreUnknownDevices && !this.deviceRegistry.has(id);

        // Worth it either way - it saves the decoding of every telegram the
        // device sends from now on - but a device nobody wants to hear about
        // is blocked without a word.
        this.blockList.noteFailure(id, muted);

        if (muted) {
            return;
        }

        await this.setState('info.rawdata', data.rawData.toString('hex'), true);
        this.aesKeys.checkWrongKey(id, name);
    }

    async updateDevice(deviceId: string, result: LegacyResult, parsed: ParserResultVerbose): Promise<void> {
        if (!this.createdDevices.has(deviceId)) {
            await this.createDeviceObjects(deviceId, result);
        }

        await this.updateDeviceStates(deviceId, result, parsed);
    }

    async createDeviceObjects(deviceId: string, data: LegacyResult): Promise<void> {
        this.log.debug(`Creating device: ${deviceId}`);
        await this.objectHelper.createDeviceOrChannel('device', deviceId);
        await this.objectHelper.createDeviceOrChannel('channel', `${deviceId}.data`);
        await this.objectHelper.createDeviceOrChannel('channel', `${deviceId}.info`);

        for (const key of Object.keys(data.deviceInformation)) {
            await this.objectHelper.createInfoState(deviceId, key);
        }

        await this.objectHelper.createInfoState(deviceId, 'Updated');

        this.createdDevices.add(deviceId);
        this.deviceRegistry.add(deviceId);
    }

    /**
     * @param deviceId
     * @param data
     * @param parsed the same telegram as the parser decoded it: the legacy
     * result has the n-th of its records at position n - 1 of the data records
     * there, and the values decoded from manufacturer specific data behind them
     */
    async updateDeviceStates(deviceId: string, data: LegacyResult, parsed: ParserResultVerbose): Promise<void> {
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
            // The state of a record is checked with every telegram, not only
            // when the device is created: a meter can send records that its
            // first telegram did not have
            if (!(await this.dataStates.verify(deviceId, item, parsed.dataRecords[item.number - 1]))) {
                continue;
            }

            const name = dataStateId(deviceId, item);
            if (
                this.config.alwaysUpdate ||
                typeof this.stateValues[name] === 'undefined' ||
                this.stateValues[name] !== item.value
            ) {
                this.stateValues[name] = item.value;

                // A record of an energy unit carries a number; anything else
                // would have been divided into a NaN.
                let val = item.value;
                if (this.config.forcekWh && typeof val === 'number') {
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
     * An object of the instance was deleted - by somebody in the object tree,
     * as the adapter itself deletes nothing.
     *
     * What the adapter knows about the objects it created is only read at the
     * start, and without this a deleted state was written to without an object
     * until the next one. Now the next telegram of the device creates what is
     * missing again: the device objects, as they are set up for a device that
     * is new in this run, and the data states, which are checked with every
     * telegram anyway.
     *
     * A deleted device is forgotten as well. With "ignoreUnknownDevices" on it
     * stays gone right away rather than after the next start, and otherwise the
     * next telegram brings it back like any device that is new.
     *
     * @param id
     * @param obj undefined or null for a deleted object
     */
    onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
        const prefix = `${this.namespace}.`;
        if (obj || !id.startsWith(prefix)) {
            return;
        }

        const relativeId = id.substring(prefix.length);
        const deviceId = relativeId.split('.')[0];
        if (deviceId === 'info') {
            // the states of the instance, which it creates at every start
            return;
        }

        this.createdDevices.delete(deviceId);
        this.dataStates.forget(relativeId);
        delete this.stateValues[relativeId];

        if (relativeId === deviceId) {
            this.log.debug(`The object tree of ${deviceId} was deleted`);
            this.deviceRegistry.remove(deviceId);
        }
    }

    onMessage(obj: ioBroker.Message): void {
        this.adminMessages.handle(obj);
    }
}

if (require.main !== module) {
    module.exports = options => new WirelessMbus(options);
} else {
    new WirelessMbus();
}
