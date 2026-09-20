'use strict';

/*
 * The AES keys the user configured, and the devices that asked for one the
 * configuration does not have.
 *
 * The two belong together: a telegram is decoded with the key found here, and
 * the parser saying that it needed a key is what puts a device on the list the
 * admin UI offers to fill in.
 */

/** The key the admin UI writes for a device whose key is not known yet. */
export const KEY_PLACEHOLDER = 'UNKNOWN';

/** The parser error that says a telegram is encrypted and no key was given. */
const NO_KEY_ERROR = 'NO_AES_KEY';

/** A row of the configured key list. */
export interface AesKeyRow {
    id: string;
    key: string;
}

class AesKeys {
    private readonly rows: AesKeyRow[];
    private readonly log: ioBroker.Logger;

    /** devices that asked for a key the configuration does not have */
    readonly needsKey: Set<string>;
    /** devices whose configured key was reported as unusable */
    private readonly reportedInvalid: Set<string>;

    constructor(rows: AesKeyRow[] | undefined, log: ioBroker.Logger) {
        this.rows = Array.isArray(rows) ? rows : [];
        this.log = log;

        this.needsKey = new Set();
        this.reportedInvalid = new Set();

        // The rows the admin UI added for devices that asked for a key keep
        // the placeholder until somebody fills them in, so they are still
        // devices without a key.
        for (const row of this.rows) {
            if (row.key === KEY_PLACEHOLDER) {
                this.needsKey.add(row.id);
            }
        }
    }

    /**
     * The configured key of a device. A configured id that the device id only
     * starts with counts as well, so one row can stand for a series of
     * meters - and the longest of them wins, which makes the exact match the
     * best possible one.
     *
     * @param id the device the telegram came from
     * @returns the key as it is configured, or undefined if there is none
     */
    getKey(id: string): string | undefined {
        const candidates = this.rows.filter(row => typeof row.id !== 'undefined' && id.startsWith(row.id));

        if (!candidates.length) {
            return undefined;
        }

        return candidates.reduce((longest, row) => (row.id.length > longest.id.length ? row : longest)).key;
    }

    /**
     * Resolve the configured key of a device into the Buffer the parser
     * expects. Keys are stored either as 32 hex characters or as a 16
     * character plain text key.
     *
     * @param id the device the telegram came from
     * @returns the key, or undefined if there is none or it is unusable
     */
    getKeyBuffer(id: string): Buffer | undefined {
        const key = this.getKey(id);

        if (typeof key === 'undefined' || key === KEY_PLACEHOLDER) {
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

        // Once is enough, the telegrams keep coming
        if (!this.reportedInvalid.has(id)) {
            this.reportedInvalid.add(id);
            this.log.error(`Invalid AES key configured for device ${id} - key rejected!`);
        }

        return undefined;
    }

    /**
     * Take note of a device whose telegram could not be decoded for lack of a
     * key, so the admin UI can offer to add a row for it.
     *
     * @param id the device the telegram came from
     * @param errorName the name of the error the parser threw
     */
    checkWrongKey(id: string, errorName: string): void {
        if (errorName === NO_KEY_ERROR) {
            this.needsKey.add(id);
        }
    }

    /**
     * Merge the devices that asked for a key into a key list, each with the
     * placeholder key, and say how many rows that added.
     *
     * @param rows the list to merge into
     */
    mergeInto(rows: AesKeyRow[]): { aeskeys: AesKeyRow[]; added: number } {
        const aeskeys = [...rows];
        let added = 0;

        for (const id of this.needsKey) {
            if (aeskeys.findIndex(item => item.id === id) === -1) {
                aeskeys.push({ id: id, key: KEY_PLACEHOLDER });
                added++;
            }
        }

        return { aeskeys, added };
    }
}

export default AesKeys;
