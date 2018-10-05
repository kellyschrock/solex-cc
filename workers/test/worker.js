'use strict';

const ATTRS = {
    id: "55c93de2-9e24-4937-b0d5-36ecf8ea6b90",
    // Name/description
    name: "Test worker",
    description: "Does basically nothing, just illustrates the idea",
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

var loopIterations = 0;
var armed = false;

// Called from dispatch.loop()
function loop() {
    console.log(ATTRS.name + " loop(): attrs.sysid=" + ATTRS.sysid);

    // Example of sending a GCS message every once in a while
    if(++loopIterations > 4) {
        // sendGCSMessage(ATTRS.id, {name: "Some message", value: "Some value"});

        // Toggle armed on and off every 10 seconds
        const arm = (armed) ? 1 : 0;
        armed = !armed;
        console.log("ARM: " + armed);

        const msg = new mavlink.messages.command_long(
            ATTRS.sysid, // sysid
            ATTRS.compid, // compid
            mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            0, // confirmation
            arm,
            0, // emergencyDisarm
            0, 0, 0, 0
        );

        ATTRS.sendMavlinkMessage(ATTRS.id, msg);

        ATTRS.broadcastMessage(ATTRS.id, {
            id: "hey_stupid",
            body: {
                text: "This is a text message"
            }
        });

        loopIterations = 0;
    }
}

// Called when this worker is loaded.
function onLoad() {
    console.log(ATTRS.name + " onLoad()");
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
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
