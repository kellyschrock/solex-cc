'use strict';

const ATTRS = {
    id: "test_worker",
    // Name/description
    name: "Test worker",
    description: "Does basically nothing, just illustrates the idea",
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

var loopIterations = 0;
var armed = false;

// Called from dispatch.loop()
function loop() {
    // console.log(ATTRS.name + " loop(): attrs.sysid=" + ATTRS.sysid);

    // Test a worker crash
    // if(++loopIterations > 15) {
    //     mHurp.durp = 24; // DIE
    //     loopIterations = 0;
    // }

    const now = new Date().getTime();

    d(`loop(): ${now}`);

    return; // Keep quiet for now

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

        // This goes to other workers via their onGCSMessage() functions.
        ATTRS.broadcastMessage(ATTRS.id, {
            id: "hey_stupid",
            body: {
                text: "This is a text message"
            }
        });

        const others = ATTRS.getWorkerRoster();
        if(!others) {
            console.log("Are there no other workers on the system?");
        } else {
            console.log("There are " + others.length + " other workers");

            for(var i = 0, size = others.length; i < size; ++i) {
                const attrs = others[i].attributes;
                const worker = others[i].worker;

                if(worker) {
                    if(worker.getMetadata) {
                        const meta = worker.getMetadata(ATTRS.id);
                        if(meta) {
                            console.log("GOT METADATA FROM " + attrs.id + ": " + JSON.stringify(meta));
                        }
                    }
                }
            }
        }

        loopIterations = 0;
    }
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
    d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    d(`onMavlinkMessage(): msg.name=$msg.name`);
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    d(`onGCSMessage(): msg.id=$msg.id`);

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

/**
 * Called when the worker roster (the list of installed workers) is changed.
 * If a worker needs to communicate with other workers, this is an opportunity to
 * check whether workers it needs to interact with are available.
 */
function onRosterChanged() {
    d("Roster has been changed");
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.onRosterChanged = onRosterChanged;
