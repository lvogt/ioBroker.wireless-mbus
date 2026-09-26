#!/usr/bin/env node
'use strict';

/*
 * Fill a running dev-server with devices - see tools/README.md.
 *
 *   node tools/seed-dev-server.js [options]
 *
 *   --profile <name>    the dev-server profile (default "default")
 *   --port <port>       local port of the TCP receiver (default 5100)
 *   --interval <msec>   wait between two telegrams (default 1500)
 *
 * Needs "npx dev-server watch" running. Points the instance at the TCP
 * receiver and adds the key of the "encrypted" sample, restarts the adapter
 * if that changed anything, and sends the telegrams of SCENARIO. It can run
 * any number of times: what is configured already stays as it is.
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SAMPLES, sendOverTcp } = require('./send-telegram');

const INSTANCE = 'system.adapter.wireless-mbus.0';
const ENCRYPTED_KEY = { id: 'ELS-12345678', key: '000102030405060708090A0B0C0D0E0F' };

/**
 * What is sent, in this order. The Sensus meter sends three layouts, so its
 * object tree has the states of two of them side by side and a record that
 * does not match its state, and its telegram variants have something to show.
 */
const SCENARIO = [
    'plain',
    'plain-maximum',
    'plain-other',
    'plain',
    'plain-other',
    'plain',
    'volume',
    'encrypted',
    'itron',
    'unknown-key',
];

const ROOT = path.join(__dirname, '..');

function usage(message) {
    if (message) {
        console.error(`${message}\n`);
    }
    console.error(
        fs
            .readFileSync(__filename, 'utf-8')
            .split('/*')[1]
            .split('*/')[0]
            .replace(/^ \* ?/gm, ''),
    );
    process.exit(message ? 1 : 0);
}

function parseArguments(argv) {
    const options = { profile: 'default', port: 5100, interval: 1500 };

    while (argv.length) {
        const argument = argv.shift();
        switch (argument) {
            case '--help':
                usage();
                break;
            case '--profile':
                options.profile = argv.shift();
                break;
            case '--port':
            case '--interval':
                options[argument.slice(2)] = Number(argv.shift());
                break;
            default:
                usage(`Unknown argument ${argument}`);
        }
    }

    return options;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function iob(profileDir, args) {
    return execFileSync(path.join(profileDir, 'iob'), args, {
        cwd: profileDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function readInstance(profileDir) {
    return JSON.parse(iob(profileDir, ['object', 'get', INSTANCE]));
}

/**
 * @returns whether something is listening on the port
 */
function isListening(port) {
    return new Promise(resolve => {
        const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('error', () => resolve(false));
    });
}

async function waitFor(what, check, timeout) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
        if (await check()) {
            return;
        }
        await delay(2000);
    }
    throw new Error(`Gave up waiting for ${what}`);
}

/**
 * The part of the instance configuration that has to change, or undefined if
 * it is set up already.
 */
function missingConfiguration(native, port) {
    const changes = {};

    if (native.deviceType !== 'tcp' || String(native.serialPort) !== String(port)) {
        changes.deviceType = 'tcp';
        changes.serialPort = String(port);
    }

    const keys = Array.isArray(native.aeskeys) ? native.aeskeys : [];
    if (!keys.some(row => row.id === ENCRYPTED_KEY.id)) {
        // extendObject replaces an array rather than merging it
        changes.aeskeys = [...keys, ENCRYPTED_KEY];
    }

    return Object.keys(changes).length ? changes : undefined;
}

/**
 * The adapter runs in the dev-server process under "watch", which restarts it
 * when a file under build/ changes. "iob restart" would enable the instance
 * in js-controller and start a second copy next to it.
 */
function restartAdapter() {
    const now = new Date();
    fs.utimesSync(path.join(ROOT, 'build', 'main.js'), now, now);
}

async function configure(profileDir, port) {
    const instance = readInstance(profileDir);

    if (instance.common.enabled) {
        // what the dev-server keeps it at, so that js-controller does not
        // start a second copy of the adapter
        console.log('The instance is enabled in js-controller - disabling it again');
        iob(profileDir, ['object', 'extend', INSTANCE, JSON.stringify({ common: { enabled: false } })]);
    }

    const changes = missingConfiguration(instance.native, port);
    if (changes) {
        console.log(`Configuring the instance: ${Object.keys(changes).join(', ')}`);
        iob(profileDir, ['object', 'extend', INSTANCE, JSON.stringify({ native: changes })]);

        // the change can reach the objects database a good while after the
        // command has returned, and the adapter must start with it
        await waitFor(
            'the configuration to arrive',
            () => !missingConfiguration(readInstance(profileDir).native, port),
            180000,
        );
    }

    if (changes || !(await isListening(port))) {
        console.log('Restarting the adapter');
        restartAdapter();
        // the adapter that is running may still hold the port for a moment
        await delay(3000);
    }

    try {
        await waitFor(`the TCP receiver on port ${port}`, () => isListening(port), 60000);
    } catch {
        throw new Error(`Nothing listens on port ${port} - is "npx dev-server watch" running?`);
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const profileDir = path.join(ROOT, '.dev-server', options.profile);

    if (!fs.existsSync(path.join(profileDir, 'iob'))) {
        usage(`There is no dev-server profile "${options.profile}" - run "npx dev-server setup" first`);
    }

    await configure(profileDir, options.port);

    for (const name of SCENARIO) {
        const sample = SAMPLES[name];
        await sendOverTcp(String(options.port), {
            frameType: sample.frameType,
            containsCrc: sample.containsCrc,
            data: sample.data,
        });
        console.log(`sent ${name.padEnd(14)} ${sample.description}`);
        await delay(options.interval);
    }

    console.log('\nDone - the devices are in the object tree of wireless-mbus.0.');
}

main().catch(error => {
    console.error(`${error.message || error}`);
    process.exit(1);
});
