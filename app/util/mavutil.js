"use strict";

const mavlink = require("./mavlink");

var mInjectRTCM = false;

var inject_seq_no = 0;

function log(str) {
    console.log("mavlink: " + str);
}

function allocBytes(len, fill) {
    const buf = Buffer.alloc(len).fill(fill || 0);
    return Array.prototype.slice.call(buf, 0);
}

function bin2String(bin) {
    var result = "";
    var i = 0, size = bin.length;

    while (i < size) {
        result += String.fromCharCode(bin[i++]);
    }
    return result;
}

function arrayCopy(src, srcIndex, out, outIndex, length) {
    var i = srcIndex, j = outIndex, l = 0;

    while (l++ < length) {
        out[j++] = src[i++];
    }

    return out;
}

//
// Public interface
//
function setInjectRTCM(send) {
    mInjectRTCM = send;
}

function toGPSCorrectionMessages(mav, sysid, compid, packetId, packet) {
    // log("sendGPSCorrection(): packetId=" + packetId + " packet=" + packet);
    const messages = [];

    const msglen = 110;
    const length = packet.length;
    const len = Math.trunc((length % msglen) == 0 ? length / msglen : (length / msglen) + 1);
    var a = 0;

    for (a = 0; a < len; a++) {
        const data = allocBytes(msglen);
        const copy = Math.trunc(Math.min((length - a * msglen), msglen));
        arrayCopy(packet, (a * msglen), data, 0, copy);

        const gps_len = copy;

        const gps = new mavlink.messages.gps_inject_data(sysid, compid, gps_len, bin2String(data));
        messages.push(gps);
    }

    return messages;
}

function toRTCMCorrectionMessages(mav, packetId, packet) {
    // log("sendRTCMCorrection(): packetId=" + packetId + " packet=" + packet);
    const messages = [];

    const packetLength = packet.length;
    const msglen = 180;

    if (packetLength > msglen * 4) {
        log("Packet too large: packetLength=" + packetLength + ", msglen=" + (msglen * 4));
        return;
    }

    // number of packets we need, including a termination packet if needed
    var numPackets = Math.floor((packetLength % msglen) == 0 ? packetLength / msglen + 1 : (packetLength / msglen) + 1);

    if (numPackets >= 4) {
        numPackets = 4;
    }

    // flags = isfrag(1)/frag(2)/seq(5)

    var flags = 0;

    var a;
    for (a = 0; a < numPackets; a++) {
        // check if its a fragment
        flags = (numPackets > 1)? 1: 0;

        // add fragment number
        flags += /* (byte) */((a & 0x3) << 1);

        // add seq number
        flags += /* (byte) */((inject_seq_no & 0x1f) << 3);

        // create the empty buffer
        var data = allocBytes(msglen);

        // calc how much data we are copying
        var copyLen = Math.min(packetLength - (a * msglen), msglen);

        // copy the data
        arrayCopy(packet, (a * msglen), data, 0, copyLen);

        // Array.Copy(data, a * msglen, gps.data, 0, copy);

        // set the length
        var len = /* (byte) */copyLen;

        const gps = new mavlink.messages.gps_rtcm_data(flags, msglen, bin2String(data));
        messages.push(gps);
        // log("packed=" + packed);
        // TODO: Send packet to connected drones over a socket(?) as a buffer.
    }

    inject_seq_no++;
    return messages;
}

function toCorrectionMessages(mav, sysid, compid, packetId, packet) {
    return (mInjectRTCM)?
        toRTCMCorrectionMessages(mav, packetId, packet):
        toGPSCorrectionMessages(mav, sysid, compid, packetId, packet);
}

exports.setInjectRTCM = setInjectRTCM;
exports.toCorrectionMessages = toCorrectionMessages;
exports.toRTCMCorrectionMessages = toRTCMCorrectionMessages;
exports.toGPSCorrectionMessages = toGPSCorrectionMessages;

