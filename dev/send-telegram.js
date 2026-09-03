#!/usr/bin/env node
'use strict';

/*
 * Feed telegrams into a running adapter - see dev/README.md.
 *
 *   node dev/send-telegram.js <sample|hex> [options]
 *
 *   --to <target>       tcp:[host:]port of the TCP receiver, or the path of a
 *                       pipe or virtual serial port read by the Simple
 *                       Hexstring receiver (default tcp:5000)
 *   --frame-type <A|B>  frame type of the telegram (default A)
 *   --crc               the telegram carries the block CRCs
 *   --repeat <count>    send it more than once (default 1)
 *   --interval <msec>   wait between two of them (default 1000)
 *   --list              show the samples and stop
 */

const fs = require('node:fs');
const net = require('node:net');

/*
 * Telegrams from the test suite, with what the adapter needs to read them.
 * The device ids are what they show up as in the object tree.
 */
const SAMPLES = {
    plain: {
        description: 'LSE-58511882, no key needed',
        frameType: 'A',
        containsCrc: false,
        data: '2C446532821851582C067AE1000000046D1906D9180C1334120000426CBF1C4C1300000000326CFFFF01FD7300',
    },
    volume: {
        description: 'CEN-12345678, a volume in m³, frame type B',
        frameType: 'B',
        containsCrc: true,
        data: '1444AE0C7856341201078C2027780B134365877AC5',
    },
    encrypted: {
        description: 'ELS-12345678, needs the key 000102030405060708090A0B0C0D0E0F',
        frameType: 'A',
        containsCrc: true,
        data: '434493157856341233037AC98C2075900F002C25B30A000021924D4FBA372FB66E017A75002007109058475F4BC9D1281DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1',
    },
    'unknown-key': {
        description: 'KAM-63452869, encrypted with a key nobody has - ends up in the "needs key" list',
        frameType: 'A',
        containsCrc: false,
        data: '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689',
    },
};

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
    const options = { to: 'tcp:5000', repeat: 1, interval: 1000 };

    while (argv.length) {
        const argument = argv.shift();
        switch (argument) {
            case '--list':
                Object.entries(SAMPLES).forEach(([name, sample]) =>
                    console.log(`${name.padEnd(12)} ${sample.description}`),
                );
                process.exit(0);
                break;
            case '--help':
                usage();
                break;
            case '--to':
            case '--frame-type':
                options[argument === '--to' ? 'to' : 'frameType'] = argv.shift();
                break;
            case '--crc':
                options.containsCrc = true;
                break;
            case '--repeat':
            case '--interval':
                options[argument.slice(2)] = Number(argv.shift());
                break;
            default:
                if (argument.startsWith('--')) {
                    usage(`Unknown option ${argument}`);
                }
                options.telegram = argument;
        }
    }

    return options;
}

function buildTelegram(options) {
    if (!options.telegram) {
        usage('Nothing to send - name a sample or pass a telegram as hex');
    }

    const sample = SAMPLES[options.telegram];
    const telegram = sample
        ? { frameType: sample.frameType, containsCrc: sample.containsCrc, data: sample.data }
        : { frameType: 'A', containsCrc: false, data: options.telegram };

    if (!/^[0-9a-fA-F]+$/.test(telegram.data) || telegram.data.length % 2) {
        usage(`"${options.telegram}" is neither a sample nor a telegram in hex`);
    }

    // What is given on the command line wins over the sample
    if (options.frameType) {
        telegram.frameType = options.frameType.toUpperCase();
    }
    if (options.containsCrc) {
        telegram.containsCrc = true;
    }

    return telegram;
}

function sendOverTcp(target, telegram) {
    const parts = target.split(':');
    const port = Number(parts.pop());
    const host = parts.join(':') || '127.0.0.1';

    return new Promise((resolve, reject) => {
        // One connection per telegram: the receiver reads a whole chunk as one
        // JSON document
        const socket = net.createConnection({ host, port }, () =>
            socket.end(JSON.stringify(telegram), () => resolve(true)),
        );
        socket.on('error', reject);
    });
}

async function send(options, telegram) {
    if (options.to.startsWith('tcp:')) {
        await sendOverTcp(options.to.slice('tcp:'.length), telegram);
    } else {
        // The Simple Hexstring receiver reads one line of hex per telegram and
        // takes a leading 'Z' for "the data carries its CRCs"
        fs.appendFileSync(options.to, `${telegram.containsCrc ? 'Z' : ''}${telegram.data}\n`);
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const telegram = buildTelegram(options);

    for (let sent = 0; sent < options.repeat; sent++) {
        await send(options, telegram);
        console.log(
            `sent ${telegram.data.length / 2} bytes to ${options.to}` +
                ` (frame type ${telegram.frameType}${telegram.containsCrc ? ', with CRC' : ''})` +
                `${options.repeat > 1 ? ` [${sent + 1}/${options.repeat}]` : ''}`,
        );

        if (options.interval && sent + 1 < options.repeat) {
            await new Promise(resolve => setTimeout(resolve, options.interval));
        }
    }
}

main().catch(error => {
    console.error(`${error}`);
    process.exit(1);
});
