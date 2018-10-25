'use strict';

const ATTRS = {
    id: "1130a982-d72e-420b-89f0-071a57509aeb",
    // Name/description
    name: "Another test",
    description: "Just another test to mess with stuff",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: ["ATTITUDE"]
};

/*
Return an object describing this worker. If looper is true, this module must expose a loop() export.
*/
function getAttributes() {
    return ATTRS;
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

function getMetadata(workerId) {
    if("test_worker" === workerId) {
        // This is a worker we know about, and want to return metadata to in a specific format it wants.
        return {
            actions: [
                {
                    id: "test_start",
                    name: "Start Test",
                    caller: workerId,
                    params: {
                        channel: 12,
                        size: "small",
                        temperature: 80
                    }
                }
            ]
        }
    } 

    return null;
}

exports.getAttributes = getAttributes;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.getMetadata = getMetadata;
