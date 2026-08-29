'use strict';

const { expect } = require('chai');
const { listReceivers, getReceiver } = require('../lib/receiver');

describe('Receiver registry', () => {
    it('offers exactly the receivers the admin UI expects', () => {
        expect(Object.keys(listReceivers()).sort()).to.eql(['amber', 'cul', 'ebi', 'imst', 'imstv2', 'simple']);
    });

    it('describes every receiver with a name and at least one mode', () => {
        for (const [key, receiver] of Object.entries(listReceivers())) {
            expect(receiver.name, `${key} has a name`).to.be.a('string').and.not.be.empty;
            expect(Object.keys(receiver.modes), `${key} has modes`).to.not.be.empty;
        }
    });

    it('does not leak class references through the message box', () => {
        // sendTo() serialises the result, so a class reference would be lost
        // or throw depending on the transport.
        for (const receiver of Object.values(listReceivers())) {
            expect(receiver).to.not.have.property('ReceiverClass');
        }
        expect(() => JSON.stringify(listReceivers())).to.not.throw();
    });

    it('resolves a receiver by its configured key', () => {
        const amber = getReceiver('amber');
        expect(amber).to.not.be.undefined;
        expect(amber.name).to.equal('Amber Wireless AMB8465');
        expect(amber.ReceiverClass).to.be.a('function');
    });

    it('still resolves the legacy module file name', () => {
        // older instance configurations stored e.g. "AmberReceiver.js"
        expect(getReceiver('AmberReceiver.js')).to.equal(getReceiver('amber'));
        expect(getReceiver('TcpReceiver.js')).to.equal(getReceiver('tcp'));
    });

    it('exposes the TCP test receiver but keeps it out of the admin list', () => {
        expect(getReceiver('tcp')).to.not.be.undefined;
        expect(listReceivers()).to.not.have.property('tcp');
    });

    it('returns undefined for anything it does not know', () => {
        for (const value of ['', 'nope', 'Nope.js', undefined, null, 42, {}]) {
            expect(getReceiver(value), `${String(value)} must not resolve`).to.be.undefined;
        }
    });

    it('does not resolve inherited object properties', () => {
        // a plain object lookup would happily return Object.prototype members
        expect(getReceiver('constructor')).to.be.undefined;
        expect(getReceiver('toString')).to.be.undefined;
    });

    it('gives every receiver a constructible class', () => {
        for (const key of Object.keys(listReceivers())) {
            expect(getReceiver(key).ReceiverClass, `${key} class`).to.be.a('function');
        }
    });
});

describe('Receiver registry vs. admin config', () => {
    // The wmbusMode control resets an invalid mode when the receiver changes.
    // That runs as a JS expression in the browser, so it carries its own copy
    // of the mode table - this test is what stops the copy drifting.
    it('the mode table embedded in jsonConfig matches the registry', () => {
        const jsonConfig = require('../admin/jsonConfig.json');
        const calculateFunc = jsonConfig.items.tabOptions.items.wmbusMode.onChange.calculateFunc;

        const embedded = new Function('data', `${calculateFunc.split(';')[0]}; return modes;`)({});
        const registry = Object.fromEntries(
            Object.entries(listReceivers()).map(([key, receiver]) => [key, Object.keys(receiver.modes)]),
        );

        expect(embedded).to.eql(registry);
    });

    it('keeps a still valid mode and otherwise falls back to the first one', () => {
        const jsonConfig = require('../admin/jsonConfig.json');
        const reset = new Function('data', jsonConfig.items.tabOptions.items.wmbusMode.onChange.calculateFunc);

        // T exists for both, so switching receiver must not disturb it
        expect(reset({ deviceType: 'cul', wmbusMode: 'T' })).to.equal('T');
        // CT is an Amber mode, IMST has no such mode
        expect(reset({ deviceType: 'imst', wmbusMode: 'CT' })).to.equal('CA');
        // every receiver's first mode is a valid fallback
        for (const [key, receiver] of Object.entries(listReceivers())) {
            const first = Object.keys(receiver.modes)[0];
            expect(reset({ deviceType: key, wmbusMode: 'nonsense' }), key).to.equal(first);
        }
        // an unknown receiver clears the field rather than keeping a stale mode
        expect(reset({ deviceType: 'nope', wmbusMode: 'T' })).to.equal('');
    });
});
