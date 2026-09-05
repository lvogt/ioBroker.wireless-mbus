'use strict';

/*
 * The devices that have an object tree, with the data record layouts of their
 * telegrams - kept in the native part of their device objects, so that they
 * survive a restart of the adapter.
 *
 * A compact telegram carries only a signature of the record layout, the layout
 * itself comes from a full telegram received earlier. Handing the stored
 * layouts to a new parser decodes the compact telegrams that arrive before the
 * meter sends a full one again, which used to be dropped.
 */

/**
 * How many record layouts are kept per device. A meter usually has one, a few
 * send a second one for the values of the last billing period. The oldest is
 * dropped when another one turns up, so that a meter that varies its layout
 * cannot grow its device object without end.
 */
const MAX_LAYOUTS_PER_DEVICE = 4;

/**
 * @typedef {import('wireless-mbus-parser').DataRecordHeadersCacheEntry} DataRecordHeadersCacheEntry
 * @typedef {{ layouts: DataRecordHeadersCacheEntry[] }} DeviceEntry
 */

/**
 * A cache entry is handed back to the parser, which rejects anything it does
 * not understand. Whatever ended up in the object - an entry written by a
 * newer version of the adapter, or one somebody edited - is dropped here
 * rather than in the parser, where it would cost every device its layouts.
 *
 * @param {unknown} layout
 * @returns {boolean} whether the parser can be given the entry
 */
function isValidLayout(layout) {
    const entry = /** @type {Partial<DataRecordHeadersCacheEntry>} */ (layout);

    return (
        typeof layout === 'object' &&
        layout !== null &&
        entry.version === 'v1' &&
        typeof entry.crc === 'number' &&
        Array.isArray(entry.cachedDataRecordHeaders)
    );
}

class DeviceRegistry {
    constructor() {
        /** @type {Map<string, DeviceEntry>} */
        this.devices = new Map();
    }

    /**
     * Register a device that has an object tree, with what its device object
     * remembers about it.
     *
     * @param {string} deviceId id of the device object, e.g. ELS-12345678
     * @param {Record<string, unknown>} [native] the native part of that object
     */
    add(deviceId, native = {}) {
        if (!this.devices.has(deviceId)) {
            this.devices.set(deviceId, { layouts: [] });
        }

        const layouts = Array.isArray(native.dataRecordHeaders) ? native.dataRecordHeaders : [];
        for (const layout of layouts.filter(isValidLayout)) {
            this.learnLayout(deviceId, layout);
        }
    }

    /**
     * @param {string} deviceId
     * @returns {boolean} whether the device has an object tree
     */
    has(deviceId) {
        return this.devices.has(deviceId);
    }

    /**
     * Take over the record layout of a telegram.
     *
     * @param {string} deviceId
     * @param {DataRecordHeadersCacheEntry} layout
     * @returns {boolean} whether the layout was a new one
     */
    learnLayout(deviceId, layout) {
        const entry = this.devices.get(deviceId);
        if (!entry || !isValidLayout(layout) || entry.layouts.some(known => known.crc === layout.crc)) {
            return false;
        }

        entry.layouts.push(layout);
        entry.layouts.splice(0, entry.layouts.length - MAX_LAYOUTS_PER_DEVICE);
        return true;
    }

    /**
     * The record layouts of all devices, as the parser takes them.
     *
     * @returns {DataRecordHeadersCacheEntry[]} every layout that is known
     */
    layouts() {
        return [...this.devices.values()].flatMap(entry => entry.layouts);
    }

    /**
     * What to store in the native part of the device object.
     *
     * @param {string} deviceId
     * @returns {{ dataRecordHeaders: DataRecordHeadersCacheEntry[] }} what the device object keeps
     */
    nativeOf(deviceId) {
        return { dataRecordHeaders: this.devices.get(deviceId)?.layouts ?? [] };
    }
}

module.exports = DeviceRegistry;
module.exports.MAX_LAYOUTS_PER_DEVICE = MAX_LAYOUTS_PER_DEVICE;
