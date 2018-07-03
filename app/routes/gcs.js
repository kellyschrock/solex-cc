"use strict";

const usbradio = require("../server/usbradio");
const udpclient = require("../server/udpclient");
const udpserver = require("../server/udpserver");
const tcpport = require("../server/tcpport");
const mavlink = require("../util/mavlink");
const mavutil = require("../util/mavutil");
const logger = require("../util/logger");
const system = require("./system");

const DEBUG = true;

/**
 * Main GCS module.
 */

const TYPE_USB = "usb";
const TYPE_UDP = "udp";
const TYPE_TCP = "tcp";

const TIMEOUT_INTERVAL = 5000;

var mMavlinkMainListener = null;
var mMavlinkState = {};
var mMavlinkTimeout = null;


var mMavlink = null;

var mTestMavlink = null;

var mOptions = null;
var mMavlinkConnection = null;
const mMavlinkMessageListeners = {};

function log(str) {
    logger.v("gcs", str);
}

function bool(v) {
    if(v === true) return true;
    if(v === "true") return true;
    return false;
}

function initMavlinkState() {
    mMavlinkState = {
        heartbeatCount: 0,
        lastHeartbeat: 0
    };
}

const mUDPServerCallback = {
    onData: function (buffer) { 
        // Relay incoming UDP messages to the outgoing connection

        if(mMavlinkConnection != null) {
            if(mTestMavlink) {
                const msgs = mTestMavlink.parseBuffer(buffer);
                if(msgs) {
                    for(var i = 0, size = msgs.length; i < size; ++i) {
                        const msg = msgs[i];

                        switch(msg.name) {
                            case "MISSION_ITEM": {
                                log("SEND: MISSION_ITEM seq=" + msg.seq);
                                break;
                            }

                            case "MISSION_COUNT": {
                                log("SEND: MISSION_COUNT count=" + msg.count);
                                break;
                            }

                            default: {
                                // log("SEND: msg.name=" + msgs[i].name);
                                break;
                            }
                        }
                    }
                }
            }

            mMavlinkConnection.sendMessage(buffer);
        }
    },

    onListening: function (address) { 
        log("udp server listening");
    },

    onError: function (err) { 
        log("UDP error: " + err.message);
    },

    onClose: function () { 
        log("UDP close");
    }
};

const mConnectionCallback = {
    onOpen: function(port) {
        // Connection opened
        log("onOpen()");
        mMavlink = new MAVLink(null, parseInt(mOptions.gcs_sysid), parseInt(mOptions.gcs_compid));
        mMavlink.on("message", onMavlinkMessage);

        mTestMavlink = (DEBUG)?
            new MAVLink(null, parseInt(mOptions.gcs_sysid), parseInt(mOptions.gcs_compid)): null;
    },

    onSendingMessage: function(buffer) {
        log("onSendingMessage(): len=" + buffer.length);
    },

    onData: function(buffer) {
        // Buffer passed from open vehicle connection. Parse it into whatever mavlink messages we need
        if (mMavlink != null) {
            mMavlink.parseBuffer(buffer);
        }

        // If the UDP server is active, relay the input to its output.
        if(udpserver.isOpen()) {
            udpserver.sendMessage(buffer);
        }
    },

    onClose: function() {
        // Connection closed
        log("onClose()");
        mMavlink = null;
    },

    onError: function(err) {
        log("onError(): " + err);
    }
};

function onHeartbeatTimeout() {
    log("onHeartbeatTimeout()");

    if(mMavlinkMainListener) {
        if(mMavlinkMainListener.onHeartbeatTimeout) {
            mMavlinkMainListener.onHeartbeatTimeout();
        }
    }
}

function onMavlinkMessage(msg) {
    try {
        const name = msg.name;

        if(!name) {
            return;
        }

        // if(DEBUG) {
        //     log("RECEIVE: " + name);
        // }

        const now = new Date().getTime();
        const then = mMavlinkState.lastMavlinkMessageTime;
        const freq = (then)? (1000 / (now - then)): 0;

        mMavlinkState.lastMavlinkMessageTime = now;

        if(freq != Infinity && freq < 1000) {
            mMavlinkState.mavlinkMessageRateHz = freq;
        }

        if("HEARTBEAT" == name) {
            if(mMavlinkState.heartbeatCount) {
                ++mMavlinkState.heartbeatCount;
            } else {
                mMavlinkState.heartbeatCount = 1;
            }

            mMavlinkState.lastHeartbeat = new Date().getTime();
            clearTimeout(mMavlinkTimeout);
            mMavlinkTimeout = setTimeout(onHeartbeatTimeout, TIMEOUT_INTERVAL);

            system.putSystemStateDirect("mavlinkState", mMavlinkState);
        }

        if("MISSION_REQUEST" === name) {
            log("MISSION_REQUEST: seq=" + msg.seq);
        }

        if ("MISSION_ACK" === name) {
            log("MISSION_ACK: result=" + msg.type);
        }

        if ("MISSION_CURRENT" === name) {
            log("MISSION_CURRENT: seq=" + msg.seq);
        }

        if("PARAM_VALUE" === name && msg.param_index < 65530) {
            log("PARAM: " + msg.param_id + " index=" + msg.param_index + " count=" + msg.param_count);
        }

        if(mMavlinkMessageListeners[name] && mMavlinkMessageListeners[name].onMavlinkMessage) {
            mMavlinkMessageListeners[name].onMavlinkMessage(msg);
        }
    } catch(ex) {
        log(ex);
    }
}

function setMavlinkMainListener(listener) {
    mMavlinkMainListener = listener;
}

function subscribeMavlink(name, listener) {
    log("subscribeMavlink(): name=" + name);

    const names = name.split(",");
    for(var n of names) {
        if (!mMavlinkMessageListeners[n]) {
            mMavlinkMessageListeners[n] = listener;
        }
    }
}

function unsubscribeMavlink(name) {
    const names = name.split(",");
    for(var n of names) {
        if (mMavlinkMessageListeners[n]) {
            delete mMavlinkMessageListeners[n];
        }
    }
}

//
// Routes
//
function connectGCS(req, res) {
    const options = req.body;

    if(options && options.type) {
        mOptions = options;

        if (options.type) {
            switch (options.type) {
                case TYPE_USB: {
                    mMavlinkConnection = usbradio;
                    break;
                }

                case TYPE_UDP: {
                    mMavlinkConnection = udpclient;
                    break;
                }

                case TYPE_TCP: {
                    mMavlinkConnection = tcpport;
                    break;
                }

                default: {
                    mMavlinkConnection = null;
                    break;
                }
            }

            if (mMavlinkConnection == null) {
                res.status(422).json({ message: "Invalid connection type. Must be usb, udp or tcp." });
            } else {
                mConnectionCallback.onError = function(err) {
                    res.status(500).json({message: err.message});
                };

                initMavlinkState();                
                mMavlinkConnection.connect(options, mConnectionCallback);

                // If UDP relay is specified, turn that on.
                if(TYPE_USB == options.type && bool(options.udp_relay)) {
                    udpserver.start({
                        port: options.udp_relay_port
                    }, mUDPServerCallback);
                }

                res.status(200).json({ message: "Connected to " + options.type });
            }
        } else {
            res.status(422).json({ message: "Invalid connection type. Must be usb, udp or tcp." });
        }
    } else {
        res.status(422).json({message: "Need to specify connection parameters"});
    }
}

function disconnectGCS(req, res) {
    if(mMavlinkConnection != null) {
        mMavlinkConnection.disconnect(mConnectionCallback);

        if(udpserver.isOpen()) {
            udpserver.stop();
        }

        initMavlinkState();

        clearTimeout(mMavlinkTimeout);
        res.status(200).json({message: "Disconnected"});
    }
}

function checkConnection(req, res) {
    if(mMavlinkConnection != null && mMavlinkConnection.checkConnection) {
        mMavlinkConnection.checkConnection(function(isOpen) {
            res.json({open: isOpen});
        });
    } else {
        res.json({open: false});
    }
}

function sendArmCommand(req, res) {
    const arm = (req.params.arm == 1)? 1: 0;

    const msg = new mavlink.messages.command_long(
        mOptions.vehicle_sysid, 
        mOptions.vehicle_compid,
        mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 
        0, // confirmation
        arm,
        0, // emergencyDisarm
        0, 0, 0, 0
    );

    if(isConnected()) {
        const packet = Buffer.from(msg.pack(mMavlink));
        mMavlinkConnection.sendMessage(packet);    
    }

    res.status(200).json({armed: arm});
}

function sendCommand(req, res) {

}

/** returns null if all good, or a message saying why things didn't work out. */
function startConnection(options, callback) {
    if (options && options.type) {
        mOptions = options;

        if (options.type) {
            switch (options.type) {
                case TYPE_USB: {
                    mMavlinkConnection = usbradio;
                    break;
                }

                case TYPE_UDP: {
                    mMavlinkConnection = udpclient;
                    break;
                }

                case TYPE_TCP: {
                    mMavlinkConnection = tcpport;
                    break;
                }

                default: {
                    mMavlinkConnection = null;
                    break;
                }
            }

            if (mMavlinkConnection == null) {
                return callback("Invalid connection type. Must be usb, udp or tcp.");
            } else {
                mConnectionCallback.onError = function (err) {
                    return callback(err.message);
                };
                
                mMavlinkConnection.connect(options, mConnectionCallback);

                if (TYPE_USB == options.type && bool(options.udp_relay)) {
                    udpserver.start({
                        port: options.udp_relay_port
                    }, mUDPServerCallback);
                }

                callback(null);
            }
        } else {
            callback("Invalid connection type. Must be usb, udp or tcp.");
        }
    } else {
        callback("Need to specify connection parameters");
    }
}

// end Routes

function isConnected() {
    return (mMavlinkConnection != null && mMavlink != null);
}

/** Send the specified array of messages. These are Mavlink messages, not packed. */
function sendMavlinkMessages(messages) {
    log("******* sendMavlinkMessages(): len=" + messages.length);
    var i;
    var packet;

    if(mMavlink != null && mMavlinkConnection != null) {
        for (i = 0; i < messages.length; ++i) {
            packet = Buffer.from(messages[i].pack(mMavlink));
            mMavlinkConnection.sendMessage(packet);
        }
    } else {
        log("sendMessages(): No connection!");
    }
}

exports.connectGCS = connectGCS;
exports.disconnectGCS = disconnectGCS;
exports.checkConnection = checkConnection;
exports.isConnected = isConnected;
exports.sendCommand = sendCommand;
exports.sendArmCommand = sendArmCommand;
exports.sendMavlinkMessages = sendMavlinkMessages;
exports.subscribeMavlink = subscribeMavlink;
exports.unsubscribeMavlink = unsubscribeMavlink;
exports.setMavlinkMainListener = setMavlinkMainListener;
exports.startConnection = startConnection;

initMavlinkState();
