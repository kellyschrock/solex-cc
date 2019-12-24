"use strict";

const dgram = require("dgram");

const mOptions = {};
const mRInfo = {};
let mServerSocket = null;
let mCallback = null;

const VERBOSE = true;

function log(str) { console.log(`udpserver: ${str}`); }
function v(str) { if(VERBOSE) log(str); }

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

    if(!callback) return log("No callback specified");
    if(!options) return log("No options specified");
    if(!options.port) return log("No port specified in options");

    if(isOpen()) {
        log("Already listening, stopping");
        stop();
    }

    mOptions.port = options.port;
    mCallback = callback;
    mServerSocket = dgram.createSocket("udp4");

    mOptions.addresses = [];
    mOptions.bcastAddress = "255.255.255.255";
    const nets = require("os").networkInterfaces();

    if(nets) {
        for(var prop in nets) {
            v(`net=${prop}`);

            var addrs = nets[prop];
            v(`addrs[${prop}]=${addrs.map(a => a.address)}`);

            addrs.map((addr) => {
                if("IPv4" === addr.family && !addr.internal) {
                    log(`addr[${prop}]=${addr.address}`);
                    mOptions.addresses.push(addr.address);
                }
            });
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
        log(`Socket error: ${err}`);
        if(mCallback.onError) mCallback.onError(err);
    });

    mServerSocket.on("message", function(buffer, rinfo) {
        mRInfo.address = rinfo.address;
        mRInfo.port = rinfo.port;
        
        // log("Message from " + rinfo.address + ":" + rinfo.port);
        if(mOptions.addresses) {
            // Don't send messages from this address back to the client, since we GOT the messages from them.
            if(mOptions.addresses.indexOf(rinfo.address) == -1) {
                // log("Message from " + rinfo.address + ":" + rinfo.port);
                if (mCallback.onData) {
                    mCallback.onData(buffer);
                }
            }
        }
    });

    try {
        mServerSocket.bind(options.port, function() {
            const address = mServerSocket.address;
            mServerSocket.setBroadcast(true);

            if (mCallback.onListening) { mCallback.onListening(); }
        });

        v(`Bound to ${options.port}`);

        return true;
    } catch(ex) {
        log(`Error in bind(): ${ex.message}`);
        if(mCallback.onError) { mCallback.onError(ex); }
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
