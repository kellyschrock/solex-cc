'use strict';

const fs = require("fs");
const path = require("path");

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

// Called from dispatch.loop()
function loop() {
}

// Called when this worker is loaded.
function onLoad() {
    console.log(ATTRS.name + " onLoad()");

    const state = ATTRS.api.VehicleState.getState();
    ATTRS.log(`vehicleState=${state}`);

    // Arm the vehicle. You wouldn't normally do this, but this is just an example.
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

//
// UI TESTS
//
function onScreenEnter(screen) {
    return {
        panel: "worker_buttons",
        layout: {
            message: "Hey, dipshit!"
        }
    };
}

function onScreenExit(screen) {

}

function onImageDownload(name) {
    const filename = path.join(__dirname, path.join("img", name));
    return (fs.existsSync(filename))? 
        fs.readFileSync(filename): null;
}

/**
 * Called when the worker roster (the list of installed workers) is changed.
 * If a worker needs to communicate with other workers, this is an opportunity to
 * check whether workers it needs to interact with are available.
 */
function onRosterChanged() {
    d("Roster has been changed");
}

function getFeatures() {
    return {
        video: {
            supported: false
        }
    }
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.onRosterChanged = onRosterChanged;
exports.onScreenEnter = onScreenEnter;
exports.onScreenExit = onScreenExit;
exports.onImageDownload = onImageDownload;
exports.getFeatures = getFeatures;
