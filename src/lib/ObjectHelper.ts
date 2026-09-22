'use strict';

class ObjectHelper {
    adapter: ioBroker.Adapter;

    constructor(adapter: ioBroker.Adapter) {
        this.adapter = adapter;
    }

    async createObject(name: string, obj: ioBroker.SettableObject): Promise<void> {
        try {
            await this.adapter.setObjectNotExistsAsync(name, obj);
        } catch (err) {
            this.adapter.log.error(`Error creating state object: ${err}`);
        }
    }

    async updateState(name: string, value: ioBroker.StateValue): Promise<void> {
        try {
            await this.adapter.setStateAsync(name, value, true);
        } catch (err) {
            this.adapter.log.error(`Error updating state ${name}: ${err}`);
        }
    }

    /**
     * What the adapter learned about a device is kept in the native part of
     * its device object: invisible in the object tree, but there again after a
     * restart. extendObject replaces the arrays it is given rather than
     * merging them element by element, so a layout that was dropped is gone.
     *
     * @param deviceId
     * @param native
     */
    async updateDeviceNative(deviceId: string, native: Record<string, unknown>): Promise<void> {
        try {
            await this.adapter.extendObjectAsync(deviceId, { native });
        } catch (err) {
            this.adapter.log.error(`Error updating device object ${deviceId}: ${err}`);
        }
    }

    async updateObject(name: string, changes: Partial<ioBroker.StateObject>): Promise<void> {
        try {
            await this.adapter.extendObjectAsync(name, changes);
        } catch (err) {
            this.adapter.log.error(`Error updating state object ${name}: ${err}`);
        }
    }

    async createDeviceOrChannel(type: 'device' | 'channel', name: string): Promise<void> {
        await this.createObject(name, {
            type: type,
            common: {
                name: name,
            },
            native: {},
        });
    }

    async createInfoState(deviceId: string, name: string): Promise<void> {
        await this.createObject(`${deviceId}.info.${name}`, {
            type: 'state',
            common: {
                name: name,
                role: 'value',
                type: 'mixed',
                read: true,
                write: false,
            },
            native: {
                id: `.info.${name}`,
            },
        });
    }
}

export default ObjectHelper;
