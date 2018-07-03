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

var mListener = null;

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

// Set the listener for this worker. A listener looks like this:
/*
{
    onSendMavlinkMessage: function(module, msg) {}
    onSendGCSMessage: function(module, msg) {}
}
*/
function setListener(listener) {
    mListener = listener;
}

exports.getAttributes = getAttributes;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.setListener = setListener;
