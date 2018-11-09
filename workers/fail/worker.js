'use strict';

// fail
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

/*
Return an object describing this worker. If looper is true, this module must expose a loop() export.
*/
function getAttributes() {
    return ATTRS;
}

// Called from dispatch.loop()
function loop() {
    // console.log(ATTRS.name + " loop(): attrs.sysid=" + ATTRS.sysid);

}

// Called when this worker is loaded.
function onLoad() {
    console.log(ATTRS.name + " onLoad()");

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
    console.log(ATTRS.name + " onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    console.log(ATTRS.name + " onMavlinkMessage(): msg=" + msg.name);
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    console.log(ATTRS.name + " onGCSMessage(): msg=" + msg);

    switch(msg.id) {
        case "test_message": {
            return {
                id: "test_result",
                value: new Date().toLocaleTimeString("en-US")
            };
        }

        default: {
            return {
                id: "no_result",
                value: "Unknown msg.id '" + msg.id + "'"
            };
        }
    }
}

function myMessedUpThing() {
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

// (function() {
//     myMessedUpThing();
// })();
