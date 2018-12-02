'use strict';

const marklar = require("./marklar");

const ATTRS = {
    id: "installable_worker",
    // Name/description
    name: "Installable worker",
    description: "Test worker installation",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT"]
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

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");
}

// Called when unloading
function onUnload() {
    d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    d("onMavlinkMessage(): msg=" + msg.name);

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
    d("onGCSMessage(): msg=" + msg);
}

exports.getAttributes = getAttributes;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
