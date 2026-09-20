'use strict';

/*
 * Which devices the adapter refuses to decode telegrams of.
 *
 * Two lists feed this: the one the user configured, and the one the adapter
 * fills itself while telegrams keep failing to decode. The second one only
 * lives as long as the adapter runs - it is a way out of wasting the decoding
 * of every telegram of a meter that cannot be decoded anyway, not a decision
 * to keep.
 */

/**
 * How many telegrams of a device may fail to decode before the automatic block
 * list rejects it.
 */
export const AUTO_BLOCK_AFTER_FAILURES = 10;

/** A row of the configured block list. */
export interface BlockListRow {
    id?: string;
}

export interface BlockListOptions {
    /** whether a device that keeps failing is blocked by the adapter itself */
    auto?: boolean;
}

class BlockList {
    private readonly configured: BlockListRow[];
    private readonly auto: boolean;
    private readonly log: ioBroker.Logger;

    /** device id -> how many of its telegrams failed to decode in a row */
    private readonly failures: Map<string, number>;
    /** devices the automatic block list rejected, until the adapter restarts */
    private readonly blocked: Set<string>;

    constructor(configured: BlockListRow[] | undefined, options: BlockListOptions, log: ioBroker.Logger) {
        this.configured = Array.isArray(configured) ? configured : [];
        this.auto = options.auto === true;
        this.log = log;

        this.failures = new Map();
        this.blocked = new Set();
    }

    isBlocked(id: string): boolean {
        if (this.blocked.has(id)) {
            return true;
        }

        // the configured ids come from a table and may be anything, so compare
        // them the way the rest of the configuration is read
        return this.configured.some(item => typeof item.id !== 'undefined' && item.id == id);
    }

    /**
     * Count a telegram that failed to decode, and block the device once too
     * many of them did.
     *
     * @param id the device the telegram came from
     * @param [quiet] report the block in the debug log only
     */
    noteFailure(id: string, quiet = false): void {
        if (!this.auto) {
            return;
        }

        const failures = (this.failures.get(id) ?? 0) + 1;
        this.failures.set(id, failures);

        if (failures >= AUTO_BLOCK_AFTER_FAILURES && !this.blocked.has(id)) {
            this.blocked.add(id);
            const message = `Device ${id} is now blocked until adapter restart!`;
            if (quiet) {
                this.log.debug(message);
            } else {
                this.log.warn(message);
            }
        }
    }

    /**
     * Count a telegram that decoded. The failures have to be consecutive: a
     * meter whose compact telegrams wait for a full one must not collect its
     * way into the block list over days.
     *
     * @param id the device the telegram came from
     */
    noteSuccess(id: string): void {
        this.failures.delete(id);
    }
}

export default BlockList;
