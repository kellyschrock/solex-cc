'use strict';

const RC_CHANNELS_CHANGED = "rc.channels.changed";
const RC_RAW_CHANGED = "rc.raw.changed";
const RC_SCALED_CHANGED = "rc.scaled.changed";

const mMessageMap = {
    "RC_CHANNELS": processChannels,
    "RC_CHANNELS_RAW": processRCRaw,
    "RC_CHANNELS_SCALED": processRCScaled
};

const mRCChannelState = {
};

const mRCRawState = {
    port: 0,
    rc1: 0, rc2: 0, rc3: 0, rc4: 0, rc5: 0, rc6: 0, rc7: 0, rc8: 0,
    rssi: 0
};

const mRCScaledState = {
    port: 0,
    rc1: 0, rc2: 0, rc3: 0, rc4: 0, rc5: 0, rc6: 0, rc7: 0, rc8: 0,
    rssi: 0
};

const mEventListeners = [];

// Public interface
function addEventListener(listener) {
    mEventListeners.push(listener);
}

function removeEventListener(listener) {
    const idx = mEventListeners.indexOf(listener);
    if(idx != -1) mEventListeners.splice(idx, 1);
}

function getRCChannelState() { return mRCChannelState; }
function getRCRawState() { return mRCRawState; }
function getRCScaledState() { return mRCScaledState; }

function getMavlinkMessages() { return [ "RC_CHANNELS", "RC_CHANNELS_RAW", "RC_CHANNELS_SCALED" ]};

function onMavlinkMessage(msg) {
    if(!msg) return;
    if(!msg.name) return;

    const func = mMessageMap[msg.name];
    if(func) {
        func(msg);
    }
}

exports.addEventListener = addEventListener;
exports.removeEventListener = removeEventListener;
exports.getRCChannelState = getRCChannelState;
exports.getRCRawState = getRCRawState;
exports.getRCScaledState = getRCScaledState;
exports.getMavlinkMessages = getMavlinkMessages;
exports.onMavlinkMessage = onMavlinkMessage;

// Private functions
const VERBOSE = true;
function d(str) {
    if(VERBOSE) console.log(`RCInputs: ${str}`);
}

function processChannels(msg) {
    // d(`processChannels(): ${JSON.stringify(msg)}`);
    const event = {};

    mRCChannelState.port = msg.port;
    mRCChannelState.rssi = msg.rssi;

    for(let i = 1; i < 19; ++i) {
        const name = i;
        const value = msg[`chan${i}_raw`];

        if(mRCChannelState[name] != value) {
            event[name] = value;
            mRCChannelState[name] = value;
        }
    }


    if(Object.keys(event).length > 0) {
        notifyEvent(RC_CHANNELS_CHANGED, event);
    }
}

function processRCRaw(msg) {
    const event = {};

    mRCRawState.port = msg.port;
    mRCRawState.rssi = msg.rssi;

    for(let i = 1; i < 9; ++i) {
        const name = i;
        const value = msg[`chan${i}_raw`];

        if(mRCRawState[name] != value) {
            event[name] = value;
            mRCRawState[name] = value;
        }
    }

    if(Object.keys(event).length > 0) {
        notifyEvent(RC_RAW_CHANGED, event);
    }
}

function processRCScaled(msg) {
    d(`processRCScaled(): ${JSON.stringify(msg)}`);
    const event = {};

    mRCScaledState.port = msg.port;
    mRCScaledState.rssi = msg.rssi;

    for(let i = 1; i < 9; ++i) {
        const name = i;
        const value = msg[`chan${i}_scaled`];

        if(mRCScaledState[name] != value) {
            event[name] = value;
            mRCScaledState[name] = value;
        }
    }

    if(Object.keys(event).length > 0) {
        notifyEvent(RC_SCALED_CHANGED, event);
    }
}

function notifyEvent(event, extras) {
    mEventListeners.map(function(listener) {
        switch(event) {
            case RC_CHANNELS_CHANGED: {
                if(listener.onRCChannelsChanged) {
                    listener.onRCChannelsChanged(extras);
                }
                break;
            }

            case RC_RAW_CHANGED: {
                if (listener.onRCRawChanged) {
                    listener.onRCRawChanged(extras);
                }
                break;
            }

            case RC_SCALED_CHANGED: {
                if(listener.onRCScaledChanged) {
                    listener.onRCScaledChanged(extras);
                }

                break;
            }
        }
    });
}

