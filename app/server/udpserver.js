"use strict";

const dgram = require("dgram");
const logger = require("../util/logger");

var mOptions = {};
const mRInfo = {};
var mServerSocket = null;
var mCallback = null;

function log(str) {
    logger.v("udpserver", str);
}

function bool(val) {
    if(val === true) return true;
    if(val === "true") return true;
    return false;
}

//
// PUBLIC INTERFACE SECTION
//
/*
Callback looks like this: {
    onData: function(buffer) {},
    onListening: function() {},
    onError: function(err) {},
    onClose: function() {}
}
*/
function start(options, callback) {
    log("listen()");

    if(!callback) {
        log("No options specified");
        return false;
    }

    if(!options.port) {
        log("No port specified");
        return false;
    }

    if(isOpen()) {
        log("Already listening, stopping");
        stop();
    }

    mOptions.port = options.port;

    mCallback = callback;
    mServerSocket = dgram.createSocket("udp4");

    // mServerSocket = dgram.createSocket({
    //     type: "udp4",
    //     sendBufferSize: 64 * 1024,
    //     recvBufferSize: 64 * 1024
    // });

    // console.log(nets);

    mOptions.addresses = [];
    mOptions.bcastAddress = "255.255.255.255";
    const nets = require("os").networkInterfaces();

    if(nets) {
        for(var prop in nets) {
            var addrs = nets[prop];
            for(var i = 0, size = addrs.length; i < size; ++i) {
                var addr = addrs[i];
                if(addr.family == "IPv4" && !addr.internal) {
                    console.log(addr.address);
                    mOptions.addresses.push(addr.address);
                }
            }
        }

        if(mOptions.addresses.length >= 1) {
            // Turn the first of these addresses into a broadcast address: xxx.xxx.xxx.255
            const addr = mOptions.addresses[0];
            const segs = addr.split(".");
            const bcast = segs[0] + "." + segs[1] + "." + segs[2] + ".255";
            log("Using broadcast address " + bcast);
            mOptions.bcastAddress = bcast;
        }
    }

    mServerSocket.on("error", function(err) {
        log("Error: " + err);
        if(mCallback.onError) {
            mCallback.onError(err);
        }
    });

    mServerSocket.on("message", function(buffer, rinfo) {
        mRInfo.address = rinfo.address;
        mRInfo.port = rinfo.port;
        
        // log("Message from " + rinfo.address + ":" + rinfo.port);
        if(mOptions.addresses) {
            // Don't send messages from this address back to the client, since we GOT the messages from them.
            if(mOptions.addresses.indexOf(rinfo.address) == -1) {
                // log("message: len=" + buffer.length);

                // log("Message from " + rinfo.address + ":" + rinfo.port);
                if (mCallback.onData) {
                    mCallback.onData(buffer);
                }
            }
        }
    });

    try {
        mServerSocket.bind({
            port: options.port, 
            exclusive: false
        }, function() {
            log("BIND");
            const address = mServerSocket.address;
            mServerSocket.setBroadcast(true);

            if (mCallback.onListening) {
                mCallback.onListening();
            }
        });

        return true;
    } catch(ex) {
        log(ex);
        if(mCallback.onError) {
            mCallback.onError(ex);
        }

        return false;
    }
}

function isOpen() {
    return (mServerSocket != null);
}

function stop() {
    log("stop()");

    if(mServerSocket != null) {
        mServerSocket.close();
        mServerSocket = null;
    }

    mCallback = null;
}

function sendMessage(buffer) {
    if(mServerSocket != null) {
        // log("sendMessage(): len=" + buffer.length);

        if(mCallback && mCallback.onSendingMessage) {
            mCallback.onSendingMessage(buffer);
        }

        mServerSocket.send(buffer, mOptions.port, mOptions.bcastAddress, function(err, bytes) {
            if(err) {
                log(err);
            } else {
                // log(bytes + " sent");
            }
        });
    }
}

exports.start = start;
exports.isOpen = isOpen;
exports.stop = stop;
exports.sendMessage = sendMessage;
