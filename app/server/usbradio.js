"use strict";
const SerialPort = require("serialport");
const logger = require("../util/logger");

var mPort;
// Callback should look like this:
/*
{
    onOpen: function(port) {},
    onData: function(data) {}, // buffer
    onClose: function() {},
    onError: function(err) {}
}
*/

function log(str) {
    logger.v("usbradio", str);
}

function bool(val) {
    return (val === 'true' || value === true);
}

//
// PUBLIC INTERFACE SECTION
//
function connect(options, callback) {
    const port = new SerialPort(options.port, {
        autoOpen: false,
        lock: false,
        baudRate: parseInt(options.baudrate),
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        xon: false,
        xoff: false,
        xany: false,
        bufferSize: 1024 * 256,
    });

    port.on("open", function () {
        log("Port opened: " + port.isOpen);
        log(port);
        mPort = port;

        if(callback.onOpen) {
            callback.onOpen(options.port);
        }

        // startListeningPort(port);
    });

    port.on("error", function (err) {
        log("port error: " + err);
        if(callback.onError) {
            callback.onError(err);
        }
    });

    port.on("data", function(data) {
        if(callback.onData) {
            callback.onData(data);
        }
    });
    
    port.open();
}

function disconnect(cb) {
    const open = (mPort && mPort.isOpen);
    if(open) {
        mPort.close();
        mPort = null;
        if(cb.onClose) {
            cb.onClose();
        }
    }

    return open;
}

function checkConnection(cb) {
    cb(isConnected());
}

function isConnected() {
    return (mPort && mPort.isOpen);
}

function sendMessage(buffer) {
    if(mPort && mPort.isOpen) {
        // log("write " + buffer.length + " bytes to port");
        mPort.write(buffer, function(err) {
            if(err) {
                console.log("ERROR: " + err);
            } else {
                // log("Wrote " + buffer.length + " bytes to port");
                mPort.flush();
            }
        });
    }
}

exports.connect = connect;
exports.disconnect = disconnect;
exports.checkConnection = checkConnection;
exports.isConnected = isConnected;
exports.sendMessage = sendMessage;
