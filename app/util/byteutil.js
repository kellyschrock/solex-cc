"use strict";

var mLittleEndian = true;

function toHexString(byteArray) {
    return Array.from(byteArray, function (byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join(' ');
}

function fillArray(size, fillParam) {
    const fill = fillParam || 0;
    const buf = [];

    for(var i = 0; i < size; ++i) {
        buf.push(fill);
    }

    return buf;
}

function setLittleEndian(little) {
    mLittleEndian = little;
}

function toBytesFromDataView(view) {
    const arr = [];

    for (var i = 0, size = view.byteLength; i < size; ++i) {
        arr.push(view.getInt8(i));
    }

    return arr;
}

function toBytesInt32(num) {
    var arr = new ArrayBuffer(4);
    var view = new DataView(arr);
    view.setInt32(0, num, mLittleEndian); 

    return toBytesFromDataView(view);
}

function toBytesUint32(num) {
    var arr = new ArrayBuffer(4);
    var view = new DataView(arr);
    view.setUint32(0, num, mLittleEndian); 

    return toBytesFromDataView(view);
}

function toBytesInt16(num) {
    var arrBuf = new ArrayBuffer(2);
    var view = new DataView(arrBuf);
    view.setInt16(0, num, mLittleEndian);

    return toBytesFromDataView(view);
}

function toBytesUint16(num) {
    var arrBuf = new ArrayBuffer(2);
    var view = new DataView(arrBuf);
    view.setUint16(0, num, mLittleEndian);

    return toBytesFromDataView(view);
}

function toBytesInt8(num) {
    var arrBuf = new ArrayBuffer(1);
    var view = new DataView(arrBuf);
    view.setInt8(0, num, mLittleEndian); 

    return toBytesFromDataView(view);
}

function toBytesUint8(num) {
    var arrBuf = new ArrayBuffer(1);
    var view = new DataView(arrBuf);
    view.setUint8(0, num, mLittleEndian);

    return toBytesFromDataView(view);
}

function bytesToInt8(data, offs) {
    const buffer = Buffer.from(data);
    return buffer.readInt8(offs || 0);
}

function bytesToUint8(data, offs) {
    const buffer = Buffer.from(data);
    return buffer.readUInt8(offs || 0);
}

function bytesToInt32(data, offs) {
    const buffer = Buffer.from(data);
    return (mLittleEndian)? buffer.readInt32LE(offs || 0): buffer.readInt32BE(offs || 0);
}

function bytesToUint32(data, offs) {
    const buffer = Buffer.from(data);
    return (mLittleEndian) ? buffer.readUInt32LE(offs || 0) : buffer.readUInt32BE(offs || 0);
}

function bytesToInt16(data, offs) {
    const buffer = Buffer.from(data);
    return (mLittleEndian)? buffer.readInt16LE(offs || 0): buffer.readInt16BE(offs || 0);
}

function bytesToUint16(data, offs) {
    const buffer = Buffer.from(data);
    return (mLittleEndian) ? buffer.readUInt16LE(offs || 0) : buffer.readUInt16BE(offs || 0);
}

exports.fillArray = fillArray;
exports.setLittleEndian = setLittleEndian;
exports.toBytesFromDataView = toBytesFromDataView;
exports.toBytesInt32 = toBytesInt32;
exports.toBytesUint32 = toBytesUint32;
exports.toBytesInt16 = toBytesInt16;
exports.toBytesUint16 = toBytesUint16;
exports.toBytesInt8 = toBytesInt8;
exports.toBytesUint8 = toBytesUint8;

exports.bytesToUint8 = bytesToUint8;
exports.bytesToInt8 = bytesToInt8;
exports.bytesToUint16 = bytesToUint16;
exports.bytesToInt16 = bytesToInt16;
exports.bytesToUint32 = bytesToUint32;
exports.bytesToInt32 = bytesToInt32;

exports.toHexString = toHexString;

// (function test () {
//     const data = [0x12, 0x34, 0x56, 0x78, 0x90, 0x11, 0x12, 0x13];
//     console.log("num=" + bytesToUint8(data, 1).toString(16));
//     process.exit(0);
// })();

