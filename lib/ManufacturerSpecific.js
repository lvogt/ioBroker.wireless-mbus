'use strict';

const { createManufacturerSpecificHandler } = require('wireless-mbus-parser');

/*
 * Meters put values the standard does not describe into manufacturer specific
 * data records: a blob of a few bytes with several values packed into it. The
 * parser decodes such a blob from a description of the fields it holds - which
 * byte, which bits, and what they mean - and it takes one description per
 * manufacturer, so a meter nobody has written code for can be read as well.
 *
 * The descriptions are configured in the admin UI, which means they are
 * whatever somebody typed: a description the parser rejects is reported with
 * the message it rejected it with and left out, so that it costs the
 * descriptions of the other manufacturers nothing.
 */

/** The three letters of a device address, e.g. the ITW of ITW-12345678 */
const MANUFACTURER_PATTERN = /^[A-Z]{3}$/;

/**
 * @typedef {import('wireless-mbus-parser').ManufacturerSpecificDataRecordHandler} Handler
 * @typedef {{ manufacturer: string, message: string, error: boolean }} Report
 * @typedef {{ handlers: Record<string, Handler>, reports: Report[], error?: string }} Result
 */

/**
 * The descriptions as an object, whether they come as the JSON of the admin UI
 * or as the object somebody wrote into the configuration directly.
 *
 * @param {unknown} configured
 * @returns {{ descriptions: Record<string, unknown>, error?: string }} the error if it is none
 */
function readDescriptions(configured) {
    if (configured === undefined || configured === null || configured === '') {
        return { descriptions: {} };
    }

    if (typeof configured === 'string') {
        try {
            return readDescriptions(JSON.parse(configured));
        } catch (error) {
            return { descriptions: {}, error: `not valid JSON (${error instanceof Error ? error.message : error})` };
        }
    }

    if (typeof configured !== 'object' || Array.isArray(configured)) {
        return { descriptions: {}, error: 'expected one description per manufacturer, e.g. { "ITW": [ ... ] }' };
    }

    return { descriptions: /** @type {Record<string, unknown>} */ (configured) };
}

/**
 * What a description holds, for somebody who wants to know whether the one
 * they typed is the one they meant.
 *
 * @param {unknown[]} spec
 * @returns {string} what it holds, in one line
 */
function summarize(spec) {
    let layouts = 0;
    let fields = 0;

    for (const entry of spec) {
        const layout = /** @type {{ fields?: unknown[] }} */ (entry);
        if (layout && Array.isArray(layout.fields)) {
            layouts++;
            fields += layout.fields.length;
        }
    }

    return layouts ? `${layouts} layout(s) with ${fields} field(s)` : `${spec.length} field(s)`;
}

/**
 * Build the handlers the parser takes from the configured descriptions.
 *
 * @param {unknown} configured the descriptions as configured
 * @returns {Result} the handlers, and one report per description
 */
function buildHandlers(configured) {
    const { descriptions, error } = readDescriptions(configured);

    if (error) {
        return { handlers: {}, reports: [], error };
    }

    /** @type {Record<string, Handler>} */
    const handlers = {};
    /** @type {Report[]} */
    const reports = [];

    for (const [manufacturer, spec] of Object.entries(descriptions)) {
        if (!MANUFACTURER_PATTERN.test(manufacturer)) {
            reports.push({
                manufacturer,
                message: 'is no manufacturer code (three capital letters) and can never match a telegram',
                error: true,
            });
            continue;
        }

        try {
            // The parser checks the description itself and says what is wrong
            // with it - a bit outside of its field, a field without a
            // description - which is exactly what its author needs to know.
            const fieldSpec = /** @type {import('wireless-mbus-parser').ManufacturerSpecificFieldSpec[]} */ (spec);
            handlers[manufacturer] = createManufacturerSpecificHandler(fieldSpec);
            reports.push({ manufacturer, message: summarize(fieldSpec), error: false });
        } catch (thrown) {
            reports.push({
                manufacturer,
                message: thrown instanceof Error ? thrown.message : `${thrown}`,
                error: true,
            });
        }
    }

    return { handlers, reports };
}

/**
 * What the admin UI offers somebody who opens the editor on an empty
 * configuration. It describes a meter that does not exist, and it holds one of
 * every kind a field can be: a single bit, a byte of flags, a value over
 * several bytes with an id of its own, and a range of bits with a name per
 * number.
 */
const EXAMPLE_DESCRIPTION = JSON.stringify(
    {
        XXX: [
            { byte: 0, bit: 0, description: 'Backflow detected' },
            { byte: 1, flags: ['Leakage', 'Burst', null, 'Removal'] },
            { byte: 2, bytes: 3, description: 'Volume', unit: 'l', legacyName: 'VIF_VOLUME_RAW' },
            { byte: 5, bits: [0, 1], description: 'Network mode', values: ['Off', 'Walk-by', 'Fixed network'] },
        ],
    },
    null,
    4,
);

module.exports = { buildHandlers, readDescriptions, EXAMPLE_DESCRIPTION };
