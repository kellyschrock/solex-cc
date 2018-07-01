"use strict";
const SerialPort = require("serialport");
const fs = require("fs");
const msghandler = require("./msghandler");
const byteutil = require("../util/byteutil");
const logger = require("../util/logger");

var exit_condition = false;

var mPort;

Array.prototype.extend = function (other_array) {
    /* you should include a test to check whether other_array really is an array */
    other_array.forEach(function(v) {this.push(v)}, this);    
}

function log(str) {
    logger.v("m8p_port", str);
}

//
// PUBLIC INTERFACE SECTION
//
function listPorts(cb) {
    const callback = cb || {
        onPort: function (port) { 
            log("onPort()");
        },
        onComplete: function () { }
    };

    SerialPort.list(function (err, ports) {
        for (var i = 0, size = ports.length; i < size; ++i) {
            callback.onPort(ports[i].comName);
        }

        callback.onComplete();
    });
}

function connectPort(options, cb) {
    const port = new SerialPort(options.port, {
        autoOpen: false,
        lock: false,
        baudRate: parseInt(options.baudrate),
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        xon: false,
        xoff: false,
        xany: false,
        bufferSize: 1024 * 64,
    });

    port.on("open", function () {
        log("Port opened: " + port.isOpen);
        mPort = port;

        if(cb.onOpen) {
            cb.onOpen(options.port);
        }

        sleep(100);
        setupM8P(port, bool(options.movingbase), bool(options.m8p_130plus));

        if(options.autoconfig) {
            setupBasePos(
                port, 
                options.basepos, 
                options.survey_duration, 
                options.survey_accuracy, 
                bool(options.disable), 
                bool(options.moving_base)
            );
        }

        startListeningPort(port);
    });

    port.on("error", function (err) {
        log("port error: " + err);
        if(cb.onError) {
            cb.onError(err);
        }
    });
    
    port.open();
}

function disconnectPort(cb) {
    const open = (mPort && mPort.isOpen);
    if(open) {
        mPort.close();
        mPort = null;
        if(cb.onClose) {
            cb.onClose();
        }
    }

    return open;
}

function checkConnection(cb) {
    const open = (mPort && mPort.isOpen)? true: false;
    cb(open);
}

function setRTCM3Listener(listener) {
    msghandler.setRTCMListener(listener);
}

function setUBXListener(listener) {
    msghandler.setUBXListener(listener);
}

// END PUBLIC INTERFACE SECTION

function writeFile(filename, packet) {
    var fd = fs.openSync(filename, "w");
    if(fd) {
        fs.writeSync(fd, packet, 0, packet.length, 0);
        fs.closeSync(fd);
    }
}

function pad(n, width, z) {
    if(!width) width = 3;
    if(!z) z = 0;

    return (String(z).repeat(width) + String(n)).slice(String(n).length);
}

function writePacket(port, packet) {
    log(packet);
    // var filename = "/home/kellys/work/drone/pi/wifi-base-station/script/output/file" + pad(fileIndex++);
    // writeFile(filename, packet);

    port.write(packet, function(err) {
        if(err) {
            log("Error writing to port");
            log(err);
            exit_condition = true;
        } else {
            // port.drain(function(err) {
            //     log("drain() complete");

            //     if(err) {
            //         log(err);
            //     } else {
            //         port.flush();
            //     }
            // });
        }
    });
}

function generate(cl, subcl, payload) {
    var data = [0xb5, 0x62, cl, subcl, (payload.length & 0xff), ((payload.length >> 8) & 0xff)];
    // data[0] = 0xb5;
    // data[1] = 0x62;
    // data[2] = cl;
    // data[3] = subclass;
    // data[4] = (byte)(payload.Length & 0xff);
    // data[5] = (byte)((payload.Length >> 8) & 0xff);

    data.extend(payload);

    var checksum = ubx_checksum(data, data.length);
    data.extend(checksum);

    return Buffer.from(data);
}

function ubx_checksum(packet, size, offset) {
    var a = 0x00;
    var b = 0x00;
    var i = offset || 2;

    while (i < size) {
        a += packet[i++];
        b += a;
    }

    return [(a & 0xFF), (b & 0xFF)];
}

function startListeningPort(port) {
    log("startListeningPort()");

    port.on("data", onData);
}

function onData(data) {
    // if(data[0] == 0xD3)
    //     log(data);

    msghandler.onData(data);
}

function sleep(ms) {
    log("sleep(" + ms + ")");
    // sysSleep(ms);
    // await sleepPromise(ms);
}

function turnon_off(port, clas, subclass, every_xsamples) {
    // clas, subclass, then rate on 6 ports. Set them all to the same value.
    // Turn the message on or off on UART1 and USB
    var datastruct1 = [clas, subclass, 0, every_xsamples, 0, every_xsamples, 0, 0];

    var packet = generate(0x6, 0x1, datastruct1);

    writePacket(port, packet);
    sleep(10);
}

function poll_msg(port, clas, subclass) {
    var datastruct1 = [];

    var packet = generate(clas, subclass, datastruct1);

    writePacket(port, packet);
    sleep(10);
}

function setupM8P(port, movingbase, m8p_130plus) {
    var rate1 = 1; // was 1
    var rate2 = 0;

    var packet;
    // port config - 115200 - uart1
    packet = generate(0x6, 0x00, [ 0x01, 0x00, 0x00, 0x00, 0xD0, 0x08, 0x00, 0x00, 0x00, 0xC2,
                0x01, 0x00, 0x23, 0x00, 0x23, 0x00, 0x00, 0x00, 0x00, 0x00 ]);
    writePacket(port, packet);
    sleep(200);

    // // port config - usb
    packet = generate(0x6, 0x00, [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x23, 0x00, 0x23, 0x00, 0x00, 0x00, 0x00, 0x00]);
    writePacket(port, packet);
    sleep(300);

    port.flush();

    // port config - 115200 - uart1
    packet = generate(0x6, 0x00, [0x01, 0x00, 0x00, 0x00, 0xD0, 0x08, 0x00, 0x00, 0x00, 0xC2, 0x01, 0x00, 0x23, 0x00, 0x23, 0x00, 0x00, 0x00, 0x00, 0x00]);
    writePacket(port, packet);
    sleep(300);

    // port config - usb
    packet = generate(0x6, 0x00, 
        [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x23, 0x00, 0x23, 0x00, 0x00, 0x00, 0x00, 0x00]);
    
    writePacket(port, packet);
    sleep(300);

    // set rate to 1hz
    packet = generate(0x6, 0x8, [0xE8, 0x03, 0x01, 0x00, 0x01, 0x00]);
    writePacket(port, packet);
    sleep(200);

    if(!movingbase) {
        packet = generate(0x6, 0x24,
                [0xFF, 0xFF, 0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00, 0x05, 0x00, 0xFA, 0x00,
                0xFA, 0x00, 0x64, 0x00, 0x2C, 0x01, 0x00, 0x00, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00]
            );
        writePacket(port, packet);
        sleep(200);
    }

    // turn off all nmea
    var a;
    for(a = 0; a <= 0xf; a++) {
        if (a == 0xb || a == 0xc || a == 0xe)
            continue;

        log("Turn off NMEA: " + a);
        turnon_off(port, 0xf0, a, 0);
    }

    // mon-ver
    poll_msg(port, 0xa, 0x4);

    // surveyin msg - for feedback
    turnon_off(port, 0x01, 0x3b, 1);

    // pvt msg - for feedback
    turnon_off(port, 0x01, 0x07, 1);

    // RTCM
    // 1005 - 5s
    turnon_off(port, 0xf5, 0x05, 5);

    if(m8p_130plus) {
        rate1 = 0;
        rate2 = 1;
    }

    // 1074 - 1s
    turnon_off(port, 0xf5, 0x4a, rate2);
    // 1077 - 1s
    turnon_off(port, 0xf5, 0x4d, rate1);

    // 1084 - 1s
    turnon_off(port, 0xf5, 0x54, rate2);
    // 1087 - 1s
    turnon_off(port, 0xf5, 0x57, rate1);

    // 1124 - 1s
    turnon_off(port, 0xf5, 0x7c, rate2);
    // 1127 - 1s
    turnon_off(port, 0xf5, 0x7f, rate1);

    if (movingbase) {
        // 4072
        turnon_off(port, 0xf5, 0xFE, 1);
    } else {
        // 4072
        turnon_off(port, 0xf5, 0xFE, 0);
    }

    // 1230 - 5s
    turnon_off(port, 0xf5, 0xE6, 5);

    // NAV-VELNED - 1s
    turnon_off(port, 0x01, 0x12, 1);

    // rxm-raw/rawx - 1s
    turnon_off(port, 0x02, 0x15, 1);
    turnon_off(port, 0x02, 0x10, 1);

    // rxm-sfrb/sfrb - 2s
    turnon_off(port, 0x02, 0x13, 2);
    turnon_off(port, 0x02, 0x11, 2);

    // mon-hw - 2s
    turnon_off(port, 0x0a, 0x09, 2);

    sleep(100);
}

function setupBasePos(port, basepos, surveyindur, surveyinacc, disable, movingbase) {
    log("setupBasePos()");

    const surveyDuration = surveyindur || 60;
    const surveyAccuracy = surveyinacc || 2;
    
    if(movingbase) {
        disable = true;
    }

    sleep(200);

    if(disable) {
        const disable = UBXConfigTMode3.makeDisable();
        var packet = generate(0x6, 0x71, disable.toByteArray());
        writePacket(port, packet);
    } else {
        // If 0,0,0 passed in for base position, configure for GETTING a base position.
        if (PointLatLngAlt.isZero(basepos)) {
            // survey in config
            var cfg = UBXConfigTMode3.fromDurationAccLimit(surveyDuration, surveyAccuracy);
            var bytes = cfg.toByteArray();
            var packet = generate(0x6, 0x71, bytes);
            var str = byteutil.toHexString(packet);
            log("packet=" + str);

            writePacket(port, packet);
        }
        else {
            const lat = parseFloat(basepos.lat);
            const lng = parseFloat(basepos.lng);
            const alt = parseFloat(basepos.alt);

            console.log("lat=" + lat + " lng=" + lng + " alt=" + alt);

            var data = UBXConfigTMode3.fromLocationAndAccuracy(lat, lng, alt);
            var bytes = data.toByteArray();
            var packet = generate(0x6, 0x71, bytes);
            log("packet=" + byteutil.toHexString(packet));
            writePacket(port, packet);
        }
    }
}

/** Location class */
class PointLatLngAlt {
    
    constructor(lat, lng, alt) {
        this.lat = lat || 0;
        this.lng = lng || 0;
        this.alt = alt || 0;
    }

    static isZero(plaa) {
        if(plaa) {
            // var lat = parseFloat(plaa.lat || 0);
            // var lng = parseFloat(plaa.lng || 0);
            // var alt = parseFloat(plaa.alt || 0);

            return (0 == plaa.lat && 0 == plaa.lng && 0 == plaa.alt);
        } else {
            return true;
        }
    }
}

/** UBX config TMODE3 */
class UBXConfigTMode3 {
    constructor() {
        this.version = 0;
        this.reserved1 = 0;
        this.flags = 1; // surveyin mode
        this.ecefXorLat = 0;
        this.ecefYorLon = 0;
        this.ecefZorAlt = 0;
        this.ecefXOrLatHP = 0;
        this.ecefYOrLonHP = 0;
        this.ecefZOrAltHP = 0;
        this.reserved2 = 0;
        this.fixedPosAcc = 0;
        this.svinMinDur = 60; // sec
        this.svinAccLimit = 2; // m
        this.reserved3 = [0,0,0,0,0,0,0,0];
    }

    static fromLocationAndAccuracy(lat, lng, alt, acc) {
        const o = new UBXConfigTMode3();
        
        o.lat = lat || 0;
        o.lng = lng || 0;
        o.alt = alt || 0;
        o.accuracy = acc || 0.001;

        o.flags = 256 + 2; // lla + fixed mode
        o.ecefXorLat = Math.trunc(o.lat * 1e7);
        o.ecefYorLon = Math.trunc(o.lng * 1e7);
        o.ecefZorAlt = Math.trunc(o.alt * 100.0);
        o.ecefXOrLatHP = Math.trunc((o.lat * 1e7 - o.ecefXorLat) * 100.0);
        o.ecefYOrLonHP = Math.trunc((o.lng * 1e7 - o.ecefYorLon) * 100.0);
        o.ecefZOrAltHP = Math.trunc((o.alt * 100.0 - o.ecefZorAlt) * 100.0);

        o.reserved2 = 0;
        o.fixedPosAcc = (o.accuracy * 10000.0); // 0.1mm 3D pos accuracy
        o.svinMinDur = 60; // seconds
        o.svinAccLimit = 20000; // 0.1mm accuracy limit
        o.reserved3 = [0, 0, 0, 0, 0, 0, 0, 0];

        return o;
    }

    static fromDurationAccLimit(durationS, accLimit) {
        const o = new UBXConfigTMode3();

        o.reserved1 = 0;
        o.flags = 1; // surveyin mode
        o.ecefXorLat = 0;
        o.ecefYorLon = 0;
        o.ecefZorAlt = 0;
        o.ecefXOrLatHP = 0;
        o.ecefYOrLonHP = 0;
        o.ecefZOrAltHP = 0;
        o.reserved2 = 0;
        o.fixedPosAcc = 0;
        o.svinMinDur = parseInt(durationS);
        o.svinAccLimit = Math.trunc(accLimit * 10000);
        o.reserved3 = [0,0,0,0,0,0,0,0];

        return o;
    }

    static makeDisable() {
        const o = new UBXConfigTMode3();

        o.flags = 0; // disable
        o.reserved3 = [0,0,0,0,0,0,0,0];

        return o;
    }

    toPointLatLngAlt() {
        var lat = 0;
        var lng = 0;
        var alt = 0;

        if (this.flags == 2) {
            var X = this.ecefXorLat / 100.0 + this.ecefXOrLatHP * 0.0001;
            var Y = this.ecefYorLon / 100.0 + this.ecefYOrLonHP * 0.0001;
            var Z = this.ecefZorAlt / 100.0 + this.ecefZOrAltHP * 0.0001;

            return new PointLatLngAlt([X, Y, Z]);
        } else if (flags == 258) {
            var X = this.ecefXorLat / 1e7 + this.ecefXOrLatHP / 1e9;
            var Y = this.ecefYorLon / 1e7 + this.ecefYOrLonHP / 1e9;
            var Z = this.ecefZorAlt / 100.0 + this.ecefZOrAltHP * 0.0001;

            return new PointLatLngAlt([X, Y, Z]);
        }

        return null;
    }

    toByteArray() {
        const buf = [];

        buf.extend(byteutil.toBytesUint8(this.version));
        buf.extend(byteutil.toBytesUint8(this.reserved1));
        buf.extend(byteutil.toBytesInt16(this.flags));
        buf.extend(byteutil.toBytesInt32(this.ecefXorLat));
        buf.extend(byteutil.toBytesInt32(this.ecefYorLon));
        buf.extend(byteutil.toBytesInt32(this.ecefZorAlt));

        buf.extend(byteutil.toBytesInt8(this.ecefXOrLatHP));
        buf.extend(byteutil.toBytesInt8(this.ecefYOrLonHP));
        buf.extend(byteutil.toBytesInt8(this.ecefZOrAltHP)); // diverges here. Is 33, u-center is 34
        buf.extend(byteutil.toBytesUint8(this.reserved2));
        buf.extend(byteutil.toBytesUint32(this.fixedPosAcc));
        buf.extend(byteutil.toBytesUint32(this.svinMinDur));
        buf.extend(byteutil.toBytesUint32(this.svinAccLimit));

        if (!this.reserved3) {
            this.reserved3 = [0,0,0,0,0,0,0,0];
        }

        buf.extend(this.reserved3);

        return buf;
    }

    // public static implicit operator byte[](ubx_cfg_tmode3 input)
    // {
    //     return MavlinkUtil.StructureToByteArray(input);
    // }

    // public enum modeflags {
    //     Disabled = 0,
    //     SurveyIn = 1,
    //     FixedECEF = 2,
    //     LLA = 256,
    //     FixedLLA = 258
    // }
}

function bool(val) {
    return (val === 'true');
}

exports.listPorts = listPorts;
exports.connectPort = connectPort;
exports.disconnectPort = disconnectPort;
exports.checkConnection = checkConnection;
exports.setRTCM3Listener = setRTCM3Listener;
exports.setUBXListener = setUBXListener;

exports.setBasePos = function(options, cb) {
    const open = (mPort != null && mPort.isOpen);
    if(open) {
        log("setBasePos(): options=" + JSON.stringify(options));
        
        setupBasePos(
            mPort,
            options.basepos,
            options.survey_duration,
            options.survey_accuracy,
            bool(options.disable),
            bool(options.moving_base)
        );
    }

    if(cb) {
        cb(open);
    }
};

// (function() {
//     const lat = 38.64311001745364;
//     const lng = -94.34249756358786;
//     const alt = 251.21337661053985;

//     var data = UBXConfigTMode3.fromLocationAndAccuracy(lat, lng, alt);
//     var bytes = data.toByteArray();
//     // var packet = generate(0x6, 0x71, bytes);
//     log("packet=" + byteutil.toHexString(bytes));

//     process.exit(0);
// })();

// (function wait () {
//     if (!exit_condition) {
//         setTimeout(wait, 1000);
//     } else {
//         if(port && port.isOpen) {
//             port.close();
//         }
//     }
// })();
