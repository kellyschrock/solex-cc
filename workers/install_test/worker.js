'use strict';

const marklar = require("./marklar");

const ATTRS = {
    id: "16c62ff2-3187-4a6d-8b64-ee6038ca3931",
    // Name/description
    name: "Installable worker",
    description: "Test worker installation",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT"]
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

    switch(msg.name) {
        case "HEARTBEAT": {
            // Got a heartbeat message
            marklar.marklarTheMarklar();
            break;
        }
    }
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    console.log(ATTRS.name + " onGCSMessage(): msg=" + msg);
}

exports.getAttributes = getAttributes;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
