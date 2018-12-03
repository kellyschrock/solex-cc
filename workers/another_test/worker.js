'use strict';

const ATTRS = {
    id: "another_test_worker",
    // Name/description
    name: "Another test",
    description: "Just another test to mess with stuff",
    // Does this worker want to loop?
    looper: true,
    // Mavlink messages we're interested in
    mavlinkMessages: ["ATTITUDE"]
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
    d(`onMavlinkMessage(): msg.name=${msg.name}`);
}

var loopIterations = 0;

function loop() {
    if(++loopIterations > 5) {

        const other = ATTRS.findWorkerById("test_worker");
        if(other) {
            d(`Found another worker: ${other.getAttributes().id}`);
        }

        loopIterations = 0;
    }
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
exports.loop = loop;
