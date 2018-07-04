'use strict';

const path = require("path");
const fs = require("fs");
const mavlink = require("./mavlink");
const udpclient = require("../server/udpclient");
const logger = require("../util/logger");

const SYSID = 221;
const COMPID = 101;
const LOOP_INTERVAL = 1000;
const UDP_PORT = 14550; 

// Worker list/map
var mWorkers = {};
// Lookup table (message id to list of workers interested in that message)
var mMavlinkLookup = {};
// Listeners for GCS messages from workers
const mGCSMessageListeners = [];
// Driver for looping
var mLoopTimer = null;
// Mavlink message parser
var mMavlink;

const mWorkerListener = {
    onMavlinkMessage: function (workerId, msg) {
        log("onMavlinkMessage(): workerId=" + workerId + " msg=" + msg);

        // Send the passed Mavlink message to the vehicle.
        try {
            const packet = Buffer.from(msg.pack(mMavlink));
            udpclient.sendMessage(packet);    
        } catch(ex) {
            log("Error sending mavlink message from worker: " + ex.message);
        }
    },

    onGCSMessage: function (workerId, msg) {
        log("GCS message from " + workerId + ": " + msg);
        
        // TODO: Should be async
        for(var i = 0, size = mGCSMessageListeners.length; i < size; ++i) {
            mGCSMessageListeners[i].onGCSMessage(workerId, msg);
        }
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
    logger.v("dispatch", s);
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
    // log("onReceivedMavlinkMessage(): msg=" + msg);

    if(mMavlinkLookup && msg.name) {
        const lookup = mMavlinkLookup[msg.name];
        if(lookup) {
            const workers = lookup.workers;
            for(var i = 0, size = workers.length; i < size; ++i) {
                const worker = workers[i];
                try {
                    worker.worker.onMavlinkMessage(msg);
                } catch (ex) {
                    log("Exception hitting onMavlinkMessage() in " + worker.attributes.name + ": " + ex.message);
                }
            }
        }
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
        for(var prop in mWorkers) {
            const worker = mWorkers[prop];

            if (worker && worker.worker && worker.worker.onUnload) {
                log("Unload " + worker.attributes.name);
                worker.worker.onUnload();
            }
        }
    }

    mWorkers = {};
}

function reload(basedir) {
    unloadWorkers();
    mMavlinkLookup = {};
    
    if(mLoopTimer) {
        clearTimeout(mLoopTimer);
    }

    const files = findFiles(basedir, "worker.js");

    var hasLoopers = false;
    for(var i = 0, size = files.length; i < size; ++i) {
        try {
            // Load the module
            const worker = require(files[i]);

            const attrs = worker.getAttributes() || { name: "No name", looper: false };

            if(!attrs.id) {
                log("Worker " + attrs.name + " in " + files[i] + " has no id, not loading");
                continue;
            }

            const workerId = attrs.id;

            if (worker.onLoad) {
                worker.onLoad();
            }

            if (worker.setListener) {
                worker.setListener(mWorkerListener);
            }

            if(attrs.looper) {
                hasLoopers = true;
            }

            attrs.sysid = SYSID;
            attrs.compid = COMPID;

            const shell = {
                worker: worker,
                attributes: attrs
            };

            // If this guy is looking for mavlink messages, index the messages by name for fast
            // lookup in onReceivedMavlinkMessage().
            if (attrs.mavlinkMessages) {
                for(var x = 0, sz = attrs.mavlinkMessages.length; x < sz; ++x) {
                    const name = attrs.mavlinkMessages[x];

                    if (mMavlinkLookup[name]) {
                        mMavlinkLookup[name].workers.push(shell);
                    } else {
                        mMavlinkLookup[name] = {
                            workers: [shell]
                        };
                    }
                }
            }

            mWorkers[workerId] = shell;
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

        for(var prop in mWorkers) {
            const worker = mWorkers[prop];
            if(worker && worker.attributes.looper && worker.worker && worker.worker.loop) {
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

function addGCSMessageListener(listener) {
    const idx = mGCSMessageListeners.indexOf(listener);
    
    if(idx < 0) {
        mGCSMessageListeners.push(listener);
    }

    return (idx < 0);
}

function removeGCSMessageListener(listener) {
    const idx = mGCSMessageListeners.indexOf(listener);
    if(idx >= 0) {
        mGCSMessageListeners.splice(idx, 1);
    }

    return (idx >= 0);
}

function handleGCSMessage(workerId, msg) {
    if(mWorkers) {
        const worker = mWorkers[workerId];

        if (worker && worker.worker && worker.worker.onGCSMessage) {
            worker.worker.onGCSMessage();
        }
    }
}

function getWorkers() {
    const workers = [];

    if(mWorkers) {
        for(var prop in mWorkers) {
            const worker = mWorkers[prop];
            if(worker.attributes) {
                workers.push(worker.attributes);
            }
        }
    }

    return workers;
}

exports.start = start;
exports.stop = stop;
exports.reload = reload;
exports.addGCSMessageListener = addGCSMessageListener;
exports.removeGCSMessageListener = removeGCSMessageListener;
exports.handleGCSMessage = handleGCSMessage;
exports.getWorkers = getWorkers;

function test() {
    reload("/home/kellys/work/drone/projects/solex-cc/workers");
    start();
}

if(process.mainModule == module) {
    log("Executing test()");
    test();
}
