'use strict';

const ATTRS = {
    // Name/description
    name: "Test worker",
    description: "Does basically nothing, just illustrates the idea",
    // Does this worker want to loop?
    looper: true,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT", "GLOBAL_POSITION_INT"]
};

var mListener = null;

/*
Return an object describing this worker. If looper is true, this module must expose a loop() export.
*/
function getAttributes() {
    return ATTRS;
}

var loopIterations = 0;

// Called from dispatch.loop()
function loop() {
    console.log(ATTRS.name + " loop()");

    // Example of sending a GCS message every once in a while
    if(mListener && ++loopIterations > 10) {
        mListener.onGCSMessage(module.exports, {
            name: "a message", value: "Some meaningless but illustrative value"
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
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.setListener = setListener;
