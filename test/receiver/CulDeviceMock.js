'use strict';

const DeviceMock = require('./DeviceMock');

// The commands a-culfw lists when it does not know the one it was given
const CULFW_COMMANDS = 'B b C e F G K l M R T t V W X x';

/**
 * A CUL, as far as culfw's analyze_ttydata() goes: bytes are collected until a
 * \r or \n ends the command, an empty command is ignored - which is what
 * becomes of the separator every command is sent with in front of it - the
 * command buffer is kept across writes, and a command culfw does not know is
 * answered with the list of the ones it does.
 *
 * With losesFirstByte it also drops the first byte of every write, the way the
 * CH340 based CULs of issue #312 do once the line has been idle. The version
 * command then arrives as an empty line, and "X21" as "21", which culfw
 * answers with "? (21 is unknown) ...".
 */
class CulDeviceMock extends DeviceMock {
    constructor(options) {
        super(options);

        this.losesFirstByte = false;
        this.commandBuffer = '';
        this.mode = 'OFF';
        this.txReport = 0;

        this.setDeviceProperties('./CulReceiver.config.json');
    }

    getResponse(data) {
        const received = data.toString('ascii').substring(this.losesFirstByte ? 1 : 0);
        let response = '';

        for (const character of received) {
            if (character !== '\r' && character !== '\n') {
                this.commandBuffer += character;
                continue;
            }

            if (this.commandBuffer.length) {
                response += this.runCommand(this.commandBuffer);
                this.commandBuffer = '';
            }
        }

        return response.length ? Buffer.from(response) : null;
    }

    runCommand(command) {
        switch (command[0]) {
            case 'V':
                return 'V 1.30 CUL868\r\n';
            case 'X':
                if (command.length === 1) {
                    return `${this.txReport.toString(16).padStart(2, '0')} 1800\r\n`;
                }
                // Setting the data reporting is not acknowledged
                this.txReport = parseInt(command.substring(1), 16);
                return '';
            case 'b':
                if (command[1] === 'r' && command[2]) {
                    this.mode = `${command[2].toUpperCase()}MODE`;
                    return `${this.mode}\r\n`;
                }
                return '';
            default:
                return `? (${command} is unknown) Use one of ${CULFW_COMMANDS}\r\n`;
        }
    }

    sendTelegram(dataString, rssi, frameType) {
        frameType = typeof frameType !== 'undefined' ? frameType.toUpperCase() : 'A';
        const prefix = `b${frameType === 'B' ? 'Y' : ''}`;
        const hexString = `${prefix + dataString + (rssi != null ? rssi.toString(16).padStart(2, '0') : '00')}\r\n`;
        this.sendData(Buffer.from(hexString));
    }
}

exports.SerialPort = CulDeviceMock;
