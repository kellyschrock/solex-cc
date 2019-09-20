'use strict';

// fail intentionally
require("hurp-durp");

const ATTRS = {
    id: "failed_worker",
    // Name/description
    name: "Failed worker",
    description: "Craps out when it tries to load",
    // Does this worker want to loop?
    looper: true,
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
    // d(" loop(): attrs.sysid=" + ATTRS.sysid);

}

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");

    const msg = new mavlink.messages.command_long(
        ATTRS.sysid, // sysid
        ATTRS.compid, // compid
        mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0, // confirmation
        1, // arm
        0, // emergencyDisarm
        0, 0, 0, 0
    );

    ATTRS.sendMavlinkMessage(ATTRS.id, msg);
}

// Called when unloading
function onUnload() {
    d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    d(`onMavlinkMessage(): msg.name=${msg.name}`);
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    d(`onGCSMessage(${msg.id})`);

    switch(msg.id) {
        case "test_message": {
            return {
                ok: true,
                id: msg.id,
                value: new Date().toLocaleTimeString("en-US")
            };
        }

        default: {
            return {
                ok: false,
                id: msg.id,
                message: "Unknown msg.id '" + msg.id + "'"
            };
        }
    }
}

function myMessedUpThing() {
    // Cause a crash
    const marklar = new marklar();
    marklar.marklar();
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.myMessedUpThing = myMessedUpThing;
