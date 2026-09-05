'use strict';

class SimpleLogger {
    constructor(loggerFunction) {
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

    setPrefix(prefix) {
        this.prefix = prefix;
    }

    error(msg) {
        this.logError(`${this.prefix}: ${msg}`);
    }

    warn(msg) {
        this.logWarn(`${this.prefix}: ${msg}`);
    }

    info(msg) {
        this.logInfo(`${this.prefix}: ${msg}`);
    }

    debug(msg) {
        this.logDebug(`${this.prefix}: ${msg}`);
    }
}

module.exports = SimpleLogger;
