import { Lemmings } from './LemmingsNamespace.js';

class LogHandler {
    constructor(moduleName) {
        this._moduleName = moduleName;
    }
    /** log an error */
    log(msg, exception) {
        if (!lemmings == false) {
            if (!lemmings.game == false && lemmings.game.showDebug == true) {
                console.log(this._moduleName + "\t" + msg);
                if (exception) {
                    console.log(this._moduleName + "\t" + exception.message);
                }
            }
        }

    }
    /** write a debug message. If [msg] is not a String it is displayed: as {prop:value} */
    debug(msg) {
        if (!lemmings.game == false) {
            if (!lemmings.game == false && lemmings.game.showDebug == true) {
                if (typeof msg === 'string') {
                    console.log(this._moduleName + "\t" + msg);
                } else {
                    console.dir(msg);
                }
            }
        }
    }
}
Lemmings.LogHandler = LogHandler;

export { LogHandler };
