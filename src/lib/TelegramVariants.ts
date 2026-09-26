'use strict';

/*
 * The telegram variants of the devices: which layouts of data records a meter
 * sends, how often, and since when.
 *
 * Most meters send one layout. Some send a second one now and then - the
 * values of the last billing period, or setup data - and a few alternate
 * between several. The parser identifies a layout by the crc of its record
 * headers, which a compact telegram carries as well, so the full and the
 * compact telegrams of a layout are one variant.
 *
 * None of the variants is better than another, so the adapter does not pick
 * one: it counts them, the admin UI shows them, and a variant somebody does not
 * want can be ignored in the configuration.
 */

/**
 * How many variants are kept per device. The one seen least recently is
 * dropped when another one turns up, so that a meter that keeps changing its
 * layout cannot grow its device object without end.
 */
const MAX_VARIANTS_PER_DEVICE = 8;

/**
 * How often the counters of a device are written to its object. A new variant
 * is written right away; the counters of a known one would otherwise cost an
 * object write per telegram, and losing an hour of them to a restart does no
 * harm.
 */
const PERSIST_INTERVAL = 60 * 60 * 1000;

/**
 * What a device address looks like: the manufacturer code and the ID of the
 * meter, which the parser writes as eight hex digits.
 */
const DEVICE_ADDRESS = /^[A-Z]{3}-[0-9A-Fa-f]{8}$/;

export type FrameKind = 'full' | 'compact';

export interface TelegramVariant {
    /** the crc of the data record headers, as the parser reports it */
    crc: number;
    frames: FrameKind[];
    /** the states the records of the variant are written to, e.g. "2-0-VIF_VOLUME" */
    states: string[];
    firstSeen: number;
    lastSeen: number;
    count: number;
}

/** A row of the configured list of variants to ignore. */
export interface IgnoredVariantRow {
    id?: string;
    variant?: string;
}

/** A row of the table the admin UI shows. */
export interface VariantRow {
    device: string;
    variant: string;
    frames: string;
    telegrams: number;
    firstSeen: string;
    lastSeen: string;
    states: string;
    ignored: string;
}

interface DeviceVariants {
    variants: TelegramVariant[];
    /** when the variants of the device were last written to its object */
    persistedAt: number;
}

/**
 * @param crc
 * @returns the name of a variant as the admin UI shows it and the
 * configuration takes it
 */
export function variantName(crc: number): string {
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * @param row
 * @returns the key of a configured row, or undefined for one that names no variant
 */
function keyOfRow(row: IgnoredVariantRow): string | undefined {
    const id = String(row?.id ?? '').trim();
    const variant = String(row?.variant ?? '')
        .trim()
        .replace(/^0x/i, '')
        .toUpperCase();

    if (!id || !/^[0-9A-F]{1,8}$/.test(variant)) {
        return undefined;
    }

    return `${id}/${variant.padStart(4, '0')}`;
}

/**
 * A row that cannot match any telegram is left out without a word otherwise,
 * and the easy mistake is the ID of the meter without its manufacturer code -
 * which is what the meter itself has printed on it.
 *
 * @param row
 * @returns why the row can never match, or undefined for one that can - and
 * for an empty one, which the table leaves behind when a row is added and not
 * filled in
 */
export function problemOfRow(row: IgnoredVariantRow): string | undefined {
    const id = String(row?.id ?? '').trim();
    const variant = String(row?.variant ?? '').trim();

    if (!id && !variant) {
        return undefined;
    }
    if (!DEVICE_ADDRESS.test(id)) {
        return `"${id}" is no device address, which is the manufacturer code and the ID, e.g. LSE-58511882`;
    }
    if (keyOfRow(row) === undefined) {
        return `"${variant}" is no variant, which is the hex number the table of telegram variants shows, e.g. 3A7F`;
    }

    return undefined;
}

/**
 * Whatever ended up in the native part of a device object - written by a
 * newer version of the adapter, or edited by somebody - is only taken for a
 * variant if it is one.
 *
 * @param value
 * @returns whether the value is a telegram variant
 */
function isVariant(value: unknown): value is TelegramVariant {
    const variant = value as Partial<TelegramVariant>;

    return (
        typeof value === 'object' &&
        value !== null &&
        typeof variant.crc === 'number' &&
        Array.isArray(variant.frames) &&
        variant.frames.every(frame => frame === 'full' || frame === 'compact') &&
        Array.isArray(variant.states) &&
        variant.states.every(state => typeof state === 'string') &&
        typeof variant.firstSeen === 'number' &&
        typeof variant.lastSeen === 'number' &&
        typeof variant.count === 'number'
    );
}

function formatTime(ms: number): string {
    const date = new Date(ms);
    const pad = (value: number): string => String(value).padStart(2, '0');

    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

class TelegramVariants {
    private readonly devices: Map<string, DeviceVariants>;
    /** "<device id>/<variant>" of every variant the configuration ignores */
    private readonly ignored: Set<string>;

    /**
     * @param ignored the configured list of variants to ignore
     * @param log where a row that can never match is reported - the rows of
     * the open form in the admin UI are read without one
     */
    constructor(ignored: IgnoredVariantRow[] | undefined, log?: ioBroker.Logger) {
        this.devices = new Map();
        this.ignored = TelegramVariants.keysOf(ignored);

        for (const row of Array.isArray(ignored) ? ignored : []) {
            const problem = problemOfRow(row);
            if (problem && log) {
                log.warn(`An ignored telegram variant is left out: ${problem}`);
            }
        }
    }

    private static keysOf(rows: IgnoredVariantRow[] | undefined): Set<string> {
        const keys = Array.isArray(rows) ? rows.map(keyOfRow) : [];
        return new Set(keys.filter((key): key is string => key !== undefined));
    }

    /**
     * Take over what the object of a device remembers about its variants.
     *
     * @param deviceId
     * @param native the native part of the device object
     */
    add(deviceId: string, native: Record<string, unknown> = {}): void {
        const stored = Array.isArray(native.telegramVariants) ? native.telegramVariants : [];
        const variants = stored.filter(isVariant).slice(-MAX_VARIANTS_PER_DEVICE);

        // what was read is what the object has, so there is nothing to write
        this.devices.set(deviceId, { variants, persistedAt: Date.now() });
    }

    /**
     * @param deviceId
     * @param crc
     * @returns whether the configuration ignores the variant
     */
    isIgnored(deviceId: string, crc: number): boolean {
        return this.ignored.has(`${deviceId}/${variantName(crc)}`);
    }

    /**
     * Count a telegram of a device.
     *
     * @param deviceId
     * @param crc the crc of its data record headers
     * @param frame whether it was a full or a compact telegram
     * @param states the states its records are written to
     * @param now
     * @returns whether the variants of the device should be written to its
     * object now - which they are then taken to be
     */
    note(deviceId: string, crc: number, frame: FrameKind, states: string[], now = Date.now()): boolean {
        let device = this.devices.get(deviceId);
        if (!device) {
            // a device that turns up for the first time has nothing stored yet
            device = { variants: [], persistedAt: 0 };
            this.devices.set(deviceId, device);
        }

        let changed = false;
        let variant = device.variants.find(known => known.crc === crc);

        if (!variant) {
            variant = { crc, frames: [], states, firstSeen: now, lastSeen: now, count: 0 };
            device.variants.push(variant);
            changed = true;

            if (device.variants.length > MAX_VARIANTS_PER_DEVICE) {
                device.variants.sort((a, b) => a.lastSeen - b.lastSeen);
                device.variants.shift();
            }
        }

        if (!variant.frames.includes(frame)) {
            variant.frames.push(frame);
            changed = true;
        }

        // a compact telegram has the layout of the full one, and a full one
        // may name other states once a description of its manufacturer
        // specific data has changed
        variant.states = states;
        variant.lastSeen = now;
        variant.count++;

        if (changed || now - device.persistedAt >= PERSIST_INTERVAL) {
            device.persistedAt = now;
            return true;
        }

        return false;
    }

    /**
     * What to store in the native part of the device object.
     *
     * @param deviceId
     * @returns what the device object keeps
     */
    nativeOf(deviceId: string): { telegramVariants: TelegramVariant[] } {
        return { telegramVariants: this.devices.get(deviceId)?.variants ?? [] };
    }

    /**
     * The variants of all devices as the admin UI shows them.
     *
     * @param ignored the list of ignored variants of the open form, which may
     * differ from the one this instance runs with
     * @returns one row per variant, by device and with the one seen last first
     */
    rows(ignored: IgnoredVariantRow[] | undefined): VariantRow[] {
        const ignoredKeys = TelegramVariants.keysOf(ignored);
        const rows: VariantRow[] = [];

        for (const deviceId of [...this.devices.keys()].sort()) {
            const variants = [...(this.devices.get(deviceId)?.variants ?? [])];

            for (const variant of variants.sort((a, b) => b.lastSeen - a.lastSeen)) {
                const name = variantName(variant.crc);
                rows.push({
                    device: deviceId,
                    variant: name,
                    frames: variant.frames.join(', '),
                    telegrams: variant.count,
                    firstSeen: formatTime(variant.firstSeen),
                    lastSeen: formatTime(variant.lastSeen),
                    states: variant.states.join(', '),
                    ignored: ignoredKeys.has(`${deviceId}/${name}`) ? '✓' : '',
                });
            }
        }

        return rows;
    }
}

export default TelegramVariants;
export { MAX_VARIANTS_PER_DEVICE, PERSIST_INTERVAL };
