'use strict';

// built-in require
const fs = require("fs");
// local require
const helper = require("./helper.js");
// external 3rd-party require
const serialport = require("serialport");

const ATTRS = {
    id: "real_worker",
    // Name/description
    name: "Real worker",
    description: "Actually does stuff and has its own node_modules directory",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT", "GLOBAL_POSITION_INT"]
};

function d(str) {
    ATTRS.log(ATTRS.id, str);
}

/*
Return an object describing this worker. If looper is true, this module must expose a loop() export.
*/
function getAttributes() {
    return ATTRS;
}

// Called from dispatch.loop()
function loop() {
    d("loop(): attrs.sysid=" + ATTRS.sysid);

    helper.helperFunction("Hey");
}

function listPorts(cb) {
    serialport.list(function (err, ports) {
        if(err) {
            return d("Error getting ports: " + err.message);
        }

        for (var i = 0, size = ports.length; i < size; ++i) {
            d("port=" + ports[i].comName);
        }

        cb.onComplete(ports);
    });
}

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");

    d(module.paths);

    listPorts({
        onComplete: function() {
            d("onComplete()");
        }
    });
}

// Called when unloading
function onUnload() {
    d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    d("onMavlinkMessage(): msg=" + msg.name);

    switch(msg.name) {
        case "GLOBAL_POSITION_INT": {
            // Send a redundant message to the GCS.
            const outMsg = {
                id: "global_position",
                time: msg.time_boot_ms, lat: msg.lat, lng: msg.lng, alt_msl: msg.alt, alt_agl: msg.relative_alt
            };

            ATTRS.sendGCSMessage(ATTRS.id, outMsg);
            break;
        }
    }
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    d("onGCSMessage(): msg=" + msg);

    switch(msg.id) {
        case "arm": {
            // Arm the vehicle
            const msg = new mavlink.messages.command_long(
                1, // sysid
                1, // compid
                mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                0, // confirmation
                1, // arm
                0, // emergencyDisarm
                0, 0, 0, 0
            );

            ATTRS.sendMavlinkMessage(ATTRS.id, msg);
            break;
        }

        case "disarm": {
            // Disarm the vehicle
            // Arm the vehicle
            const msg = new mavlink.messages.command_long(
                1, // sysid
                1, // compid
                mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                0, // confirmation
                0, // arm
                0, // emergencyDisarm
                0, 0, 0, 0
            );

            ATTRS.sendMavlinkMessage(ATTRS.id, msg);
            break;
        }

        case "hey_stupid": {
            d(JSON.stringify(msg));
            break;
        }

        case "start_mission": {
            // Send a MISSION_START command
            const msg = new mavlink.messages.command_long(
                ATTRS.sysid, // sysid
                ATTRS.compid, // compid
                mavlink.MAV_CMD_MISSION_START,
                0,
                0,
                0,
                0, 0, 0, 0
            );

            ATTRS.sendMavlinkMessage(ATTRS.id, msg);
            break;
        }
    }

    return {
        message: msg.id
    };
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
