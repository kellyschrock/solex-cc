'use strict';

const path = require("path");
const fs = require("fs");
const mavlink = require("./mavlink");
const udpclient = require("../server/udpclient");

const SYSID = 221;
const COMPID = 101;
const LOOP_INTERVAL = 1000;
const UDP_PORT = 14550; // Could (should?) change this to use a different port from normal GCS clients

var mWorkers = [];
var mLoopTimer = null;
var mMavlink;

const mWorkerListener = {
    onMavlinkMessage: function (worker, msg) {
        // TODO: Send msg to the autopilot
    },

    onGCSMessage: function (worker, msg) {
        log("GCS message from " + worker + ": " + msg);
        // TODO: Send msg to the GCS
    }
};

const mConnectionCallback = {
    onOpen: function (port) {
        // Connection opened
        log("onOpen()");
        // Start listening for mavlink packets.
        mMavlink = new MAVLink(null, SYSID, COMPID);
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
        log("onClose()");
        mMavlink = null;
    },

    onError: function (err) {
        log("onError(): " + err);
    }
};

function log(s) {
    console.log(s);
}

function findFiles(dir, filter) {
    var out = [];

    if(!fs.existsSync(dir)) {
        log(dir + " not found");
        return out;
    }

    const files = fs.readdirSync(dir);
    for (var i = 0, size = files.length; i < size; i++) {
        const filename = path.join(dir, files[i]);
        const stat = fs.lstatSync(filename);

        if (stat.isDirectory()) {
            const children = findFiles(filename, filter);
            if(children) {
                for(var j = 0, sz = children.length; j < sz; ++j) {
                    out.push(children[j]);
                }
            }
        } else {
            if (filter) {
                if (filename.indexOf(filter) >= 0) {
                    out.push(filename);
                    log(filename);
                }
            } else {
                log(filename);
            }
        }
    }

    return out;
}

function onReceivedMavlinkMessage(msg) {
    log("onReceivedMavlinkMessage(): msg=" + msg);

    if(mWorkers) {
        mWorkers.forEach(function(worker) {
            if(worker.attributes.mavlinkMessages && worker.attributes.mavlinkMessages.includes(msg.name)) {
                try {
                    worker.worker.onMavlinkMessage(msg);
                } catch(ex) {
                    log("Exception hitting onMavlinkMessage() in " + worker.attributes.name + ": " + ex.message);
                }
            }
        });
    }
}

//
// Public interface
//
function start() {

    // Open the UDP port and start listening for Mavlink messages.
    udpclient.connect({
        udp_port: UDP_PORT
    }, mConnectionCallback);

    // TODO: Start listening for GCS messages.

    // Start the looper.
    loop();
}

function stop() {
    if(mLoopTimer) {
        clearTimeout(mLoopTimer);
    }

    try {
        udpclient.disconnect(mConnectionCallback);
    } catch(ex) {
        log("Error closing UDP: " + ex.message);
    }
}

function unloadWorkers() {
    if(mWorkers) {
        mWorkers.forEach(function(worker) {
            if(worker.worker && worker.worker.onUnload) {
                log("Unload " + worker.attributes.name);
                worker.worker.onUnload();
            }
        });

        mWorkers = [];
    }
}

function reload(basedir) {
    unloadWorkers();

    const files = findFiles(basedir, "worker.js");

    for(var i = 0, size = files.length; i < size; ++i) {
        try {
            const worker = require(files[i]);
            worker.onLoad();

            if(worker.setListener) {
                worker.setListener(mWorkerListener);
            }

            const attrs = worker.getAttributes() || { name: "No name", looper: false };

            const shell = {
                worker: worker,
                attributes: attrs
            };

            mWorkers.push(shell);
        } catch(ex) {
            log("Error loading worker at " + files[i] + ": " + ex.message);
        }
    }

    log(mWorkers);
}

// Called periodically to loop the workers.
function loop() {
    if(mWorkers) {
        var hasLoopers = false;
        for (var i = 0, size = mWorkers.length; i < size; ++i) {
            const worker = mWorkers[i];
            if(worker.attributes.looper && worker.worker && worker.worker.loop) {
                hasLoopers = true;
                worker.worker.loop();
            }
        }

        if(hasLoopers) {
            mLoopTimer = setTimeout(loop, LOOP_INTERVAL);
        } else {
            mLoopTimer = null;
        }
    } else {
        log("No workers");
    }
}

exports.start = start;
exports.stop = stop;
exports.reload = reload;

function test() {
    reload("/home/kellys/work/drone/projects/solex-cc/workers");
    start();
}

if(process.mainModule == module) {
    log("Executing test()");
    test();
}
