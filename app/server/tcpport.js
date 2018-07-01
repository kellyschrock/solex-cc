"use strict";

const net = require("net");
const logger = require("../util/logger");

var mConnection;

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
    logger.v("tcp", str);
}

function bool(val) {
    return (val === 'true');
}

//
// PUBLIC INTERFACE SECTION
//
function connect(options, callback) {
    if (mConnection != null) {
        if (callback.onError) {
            callback.onError("Already connected");
        }

        return;
    }

    if (!options.tcp_address || !options.tcp_port) {
        if (callback.onError) {
            callback.onError("udp_address/udp_port are required for UDP connections");
        }

        return;
    }

    var net = require('net');

    mConnection = new net.Socket();

    mConnection.on('data', function (data) {
        if (callback.onData) {
            callback.onData(data);
        }
    });

    mConnection.on('close', function () {
        if (callback.onClose) {
            callback.onClose();
        }

        mConnection = null;
    });
    
    mConnection.connect(parseInt(options.tcp_port), options.tcp_address, function (err) {
        if(err) {
            log("ERROR: " + err);

            if(callback.onError) {
                callback.onError(err);
            }
        } else {
            if (callback.onOpen) {
                callback.onOption(mConnection);
            }
        }
    });
}

function disconnect(cb) {
    const open = (mConnection != null);
    if (open) {
        mConnection.close();
        mConnection = null;
        if (cb.onClose) {
            cb.onClose();
        }
    }

    return open;
}

function checkConnection(cb) {
    cb((mConnection != null) ? true : false);
}

function sendMessage(buffer) {
    // TODO: implement
}

exports.connect = connect;
exports.disconnect = disconnect;
exports.checkConnection = checkConnection;
exports.sendMessage = sendMessage;
