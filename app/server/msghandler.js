"use strict";

// const ubx = require("./ubx");

function setRTCMListener(listener) {
    rtcm3.setRTCMListener(listener);
}

function setUBXListener(listener) {
    ubx.setUBXListener(listener);
}

function onData(data) {

    const arr = Array.prototype.slice.call(data, 0);

    if(rtcm3.isPreamble(arr)) {
        rtcm3.onData(arr);
    } else if(ubx.onData(arr)) {

    }
}

// exports.onData = onData;
// exports.setRTCMListener = setRTCMListener;
// exports.setUBXListener = setUBXListener;
