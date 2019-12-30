'use strict';

const mavlink1 = require("./mavlink.js");
const mavlink2 = require("./mav_v2.js");

const VERBOSE = global.logVerbose || false;

function v(str) {
    if(VERBOSE) console.log(`mavlink_shell: ${str}`);
}

const mavlinkLogger = null; // console; //winston.createLogger({transports:[new(winston.transports.File)({ filename:'mavlink.dev.log'})]});
let mMavlinkProtocol = 1;

let mMavlink1Parser = null;
let mMavlink2Parser = null;
let mMavlink = null;

function onOpen(sysid, compid, msgCallback) {
    v(`onOpen(): sysid=${sysid} compid=${compid}`);

    mMavlink1Parser = new MAVLink(mavlinkLogger, sysid, compid);
    mMavlink2Parser = new MAVLink20Processor(mavlinkLogger, sysid, compid);

    mMavlink1Parser.on("message", msgCallback);
    mMavlink2Parser.on("message", msgCallback);
}

function onClose() {
    mMavlink = null;
}

function parseBuffer(buffer) {
    const bytes = Uint8Array.from(buffer);

    if (bytes[0] === mMavlink1Parser.protocol_marker) {
        mMavlink1Parser.parseBuffer(bytes);
        mMavlink = mMavlink1Parser;
    } else if (bytes[0] === mMavlink2Parser.protocol_marker) {
        mMavlink2Parser.parseBuffer(bytes);
        mMavlink = mMavlink2Parser;
    }

    mMavlinkProtocol = bytes[0];
}

/** Pack the given message and return a buffer */
function pack(msg) {
    const packet = (mMavlink)? Buffer.from(msg.pack(mMavlink)): null;
    return packet;
}

function getMavlinkProtocol() { 
    return mMavlinkProtocol;
}

function getMavlinkProcessor() {
    return mMavlink;
}

exports.onOpen = onOpen;
exports.onClose = onClose;
exports.parseBuffer = parseBuffer;
exports.pack = pack;
exports.getMavlinkProtocol = getMavlinkProtocol;
exports.getMavlinkProcessor = getMavlinkProcessor;
