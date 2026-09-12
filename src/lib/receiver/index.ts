'use strict';

/*
 * Static registry of the available receivers.
 *
 * The adapter used to build a path from the configured device type, check it
 * with fs.existsSync() and require() it. That had two problems: the path was
 * resolved against the current working directory for the existence check but
 * against this module for the require, and a computed require() cannot be
 * followed by a bundler. Listing the receivers here keeps both the type check
 * and the module graph static.
 */

import AmberReceiver from './AmberReceiver';
import CulReceiver from './CulReceiver';
import EbiReceiver from './EbiReceiver';
import ImstReceiver from './ImstReceiver';
import ImstV2Receiver from './ImstV2Receiver';
import SimpleReceiver from './SimpleReceiver';
import TcpReceiver from './TcpReceiver';

/** What the admin UI is told about a receiver - no class references. */
export interface PublicReceiverInfo {
    name: string;
    js: string;
    modes: Record<string, string>;
}

const receivers = {
    ebi: {
        name: 'Embit EMB-WMB169/868',
        js: 'EbiReceiver.js',
        modes: { C: 'C Mode', S: 'S Mode', T: 'T Mode' },
        ReceiverClass: EbiReceiver,
    },
    amber: {
        name: 'Amber Wireless AMB8465',
        js: 'AmberReceiver.js',
        modes: { C: 'C Mode', S: 'S Mode', T: 'T Mode', CT: 'C/T Mode' },
        ReceiverClass: AmberReceiver,
    },
    imst: {
        name: 'IMST iM871A',
        js: 'ImstReceiver.js',
        modes: {
            CA: 'C Mode (frame type A)',
            CB: 'C Mode (frame type B)',
            S: 'S Mode',
            T: 'T Mode',
        },
        ReceiverClass: ImstReceiver,
    },
    imstv2: {
        name: 'IMST iU891A-XL',
        js: 'ImstV2Receiver.js',
        modes: {
            S: 'S Mode',
            T: 'T Mode',
            'C/T': 'combined C/T-Mode',
            C: 'C-Mode (100 kbps)',
            Tx: 'Enhanced T Mode',
        },
        ReceiverClass: ImstV2Receiver,
    },
    cul: {
        name: 'CUL',
        js: 'CulReceiver.js',
        modes: { S: 'S Mode', T: 'T Mode', C: 'C/T Mode' },
        ReceiverClass: CulReceiver,
    },
    simple: {
        name: 'Simple Hexstring',
        js: 'SimpleReceiver.js',
        modes: { A: 'Frame type A', B: 'Frame type B' },
        ReceiverClass: SimpleReceiver,
    },
};

/*
 * Not offered in the admin UI: this one talks to no hardware at all, it
 * accepts telegrams as JSON on a local TCP socket. It is how the integration
 * tests feed the adapter, and it stays reachable under its legacy
 * "TcpReceiver.js" name.
 */
const internalReceivers = {
    tcp: {
        name: 'TCP (testing only)',
        js: 'TcpReceiver.js',
        modes: {},
        ReceiverClass: TcpReceiver,
    },
};

const allReceivers = { ...receivers, ...internalReceivers };

/**
 * The receivers offered in the admin UI, without the class references so the
 * result can be sent through the message box.
 */
function listReceivers(): Record<string, PublicReceiverInfo> {
    const list: Record<string, PublicReceiverInfo> = {};
    for (const [key, { name, js, modes }] of Object.entries(receivers)) {
        list[key] = { name, js, modes };
    }
    return list;
}

/**
 * Look up a receiver by its key ("amber"). Older configurations may hold the
 * module file name instead ("AmberReceiver.js"), which is still accepted.
 *
 * @returns the registry entry, or undefined for an unknown type
 */
function getReceiver(type) {
    if (typeof type !== 'string' || !type) {
        return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(allReceivers, type)) {
        return allReceivers[type];
    }

    return Object.values(allReceivers).find(receiver => receiver.js === type);
}

export { listReceivers, getReceiver };
