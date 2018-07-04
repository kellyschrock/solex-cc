"use strict";
const dgram = require("dgram");
const logger = require("../util/logger");

var mClient;
var mOptions = {};
const mRInfo = {};

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
    logger.v("udpclient", str);
}

function bool(val) {
    if (val === true) return true;
    if (val === "true") return true;
    return false;
}

function doPing() {
    sendMessage(Buffer.from("Hey stupid"));
}

//
// PUBLIC INTERFACE SECTION
//
function connect(options, callback) {
    if(mClient != null) {
        if(callback.onError) {
            callback.onError("Already connected");
        }

        return;
    }

    if(!options.udp_port) {
        if(callback.onError) {
            callback.onError("udp_port is required for UDP connections");
        }

        return;
    }

    mOptions = options;

    mClient = dgram.createSocket('udp4');

    mClient.on("message", function(message, rinfo) {
        // log("Message from " + rinfo.address + ":" + rinfo.port);
        mRInfo.address = rinfo.address;
        mRInfo.port = rinfo.port;

        if (callback.onData) {
            callback.onData(message);
        }
    });

    const portNum = parseInt(options.udp_port);
    try {
        mClient.bind(portNum);

        if (callback.onOpen) {
            callback.onOpen(mClient);
        }
    } catch(ex) {
        log("Error opening port on " + portNum + ": " + ex.message);
        if(callback.onError) {
            callback.onError("Error opening port on " + portNum + ": " + ex.message);
        }

        mClient = null;
    }
}

function disconnect(cb) {
    const open = isConnected();
    if(open) {
        mClient.close();
        mClient = null;
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
    return (mClient != null);
}

function sendMessage(packet) {
    if(isConnected()) {
        if ((mRInfo.port > 0 && mRInfo.port < 65536) && mRInfo.address) {
            mClient.send(packet, mRInfo.port, mRInfo.address, function (err, bytes) {
                if (err) {
                    log(err);
                } else {
                    log(bytes + " bytes sent");
                }
            });
        } else {
            log("No port or address to send to");
        }
    }
}

exports.connect = connect;
exports.disconnect = disconnect;
exports.checkConnection = checkConnection;
exports.isConnected = isConnected;
exports.sendMessage = sendMessage;
