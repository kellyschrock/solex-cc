#!/usr/bin/env node
'use strict';

const mavlink = require("./util/mavlink.js");
const udpclient = require("./server/udpclient.js");
const fs = require("fs");
const path = require("path");

const mWorkerLibraries = {};

function d(str) {
    console.log(`test_engine: ${str}`);
}

function die(str, code) {
    d(str);
    process.exit(code || 127);
}

const mConfig = {
    loopTime: 1000,
    sysid: 221,
    compid: 101,
    udpPort: 14550,
    logWorkers: [],
    workerRoots: [],
    heartbeats: { send: false }
};

var mMavlink;

const mConnectionCallback = {
    onOpen: function (port) {
        // Connection opened
        // Start listening for mavlink packets.
        mMavlink = new MAVLink(null, mConfig.sysid, mConfig.compid);
        mMavlink.on("message", onReceivedMavlinkMessage);
    },

    onData: function (buffer) {
        // Incoming buffer from UDP, forwarded from the AP's serial port.
        // This will trigger onReceivedMavlinkMessage(), which delegates to the workers.
        if (mMavlink != null) {
            mMavlink.parseBuffer(buffer);
        }
    },

    onClose: function () {
        // Connection closed
        mMavlink = null;

        stopSendingHeartbeats();
    },

    onError: function (err) {
        console.trace(err);
    }
};

const testCallback = {
    onSetupComplete: function() {
        tester.run();
    },

    onRunComplete: function() {
        d(`onRunComplete()`);
        if(tester.teardown) tester.teardown();
        process.exit(0);
    },

    sendMavlinkMessage: function(msg) {
        if(msg) {
            const packet = Buffer.from(msg.pack(mMavlink));
            d("Send Mavlink packet");
            udpclient.sendMessage(packet);            
        }
    }
};

function onReceivedMavlinkMessage(msg) {
    // d(`${JSON.stringify(msg)}`);
    if(tester.onMavlinkMessage) tester.onMavlinkMessage(msg);
}

const args = process.argv;

if(args.length < 3) {
    console.log(`\nUsage:\n${args[1]} /some/path/to/worker_tester.js\n`);
    process.exit(127);
}

loadWorkerLibsIn(require("path").join(__dirname, "worker_lib"));

const tester = require(args[2]);
d(`tester=${tester}`);

if(!tester.setup) { die("no tester setup() function"); }
if(!tester.run) { die("no tester run() function"); }

// Open the UDP port and start listening for Mavlink messages.
udpclient.connect({
    udp_port: mConfig.udpPort
}, mConnectionCallback);

tester.setup(mWorkerLibraries, testCallback);

function loadWorkerLibsIn(dir) {

    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.map(function (file) {
        const filename = path.join(dir, file);
        const prop = path.basename(file, path.extname(file));

        try {
            // d(`load library module: ${filename}`);
            const mod = require(filename);

            if (!mWorkerLibraries) {
                mWorkerLibraries = {};
            }

            mWorkerLibraries[prop] = mod;
        } catch (ex) {
            d(`load library module error - ${filename}: ${ex.message}`);
            mWorkerLibraries[prop] = {
                error: ex.message
            };
        }
    });
}
