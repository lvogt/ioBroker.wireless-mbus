'use strict';

export type LogFunction = (message: string) => void;

/** A logger object as handed in by the adapter, where every level is optional. */
export interface LoggerObject {
    error?: LogFunction;
    warn?: LogFunction;
    info?: LogFunction;
    debug?: LogFunction;
}

export type LoggerInput = LogFunction | LoggerObject | undefined;

class SimpleLogger {
    prefix: string;
    private logError: LogFunction;
    private logWarn: LogFunction;
    private logInfo: LogFunction;
    private logDebug: LogFunction;

    constructor(loggerFunction?: LoggerInput) {
        this.prefix = '';

        if (typeof loggerFunction === 'undefined') {
            this.logError = console.log;
            this.logWarn = console.log;
            this.logInfo = console.log;
            this.logDebug = console.log;
        } else if (typeof loggerFunction === 'function') {
            this.logError = loggerFunction;
            this.logWarn = loggerFunction;
            this.logInfo = loggerFunction;
            this.logDebug = loggerFunction;
        } else {
            this.logError = typeof loggerFunction.error === 'function' ? loggerFunction.error : function () {};
            this.logInfo = typeof loggerFunction.info === 'function' ? loggerFunction.info : function () {};
            this.logDebug = typeof loggerFunction.debug === 'function' ? loggerFunction.debug : function () {};
            // A logger without a warn level must not swallow the warnings -
            // reporting them one level down beats losing them, and beats
            // turning them into errors.
            this.logWarn = typeof loggerFunction.warn === 'function' ? loggerFunction.warn : this.logInfo;
        }
    }

    setPrefix(prefix: string): void {
        this.prefix = prefix;
    }

    error(msg: string): void {
        this.logError(`${this.prefix}: ${msg}`);
    }

    warn(msg: string): void {
        this.logWarn(`${this.prefix}: ${msg}`);
    }

    info(msg: string): void {
        this.logInfo(`${this.prefix}: ${msg}`);
    }

    debug(msg: string): void {
        this.logDebug(`${this.prefix}: ${msg}`);
    }
}

export default SimpleLogger;
