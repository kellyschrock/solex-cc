'use strict';

const path = require("path");
const fs = require("fs");
const mavlink = require("./mavlink");
const udpclient = require("../server/udpclient");
const logger = require("../util/logger");
const files = require("../routes/files");
const child_process = require("child_process");

// Config
const mConfig = {
    loopTime: 1000,
    sysid: 221,
    compid: 101,
    udpPort: 14550,
    workerRoots: []
};

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

        if(udpclient.isConnected()) {
            // Send the passed Mavlink message to the vehicle.
            try {
                const packet = Buffer.from(msg.pack(mMavlink));
                udpclient.sendMessage(packet);
            } catch (ex) {
                log("Error sending mavlink message from worker: " + ex.message);
            }
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
        udp_port: mConfig.udpPort
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

function reload() {
    unloadWorkers();
    mMavlinkLookup = {};

    if (mLoopTimer) {
        clearTimeout(mLoopTimer);
    }

    const roots = mConfig.workerRoots;
    for(var i = 0, size = roots.length; i < size; ++i) {
        loadWorkerRoot(roots[i]);
    }

    log(mWorkers);
}

function loadWorkerRoot(basedir) {
    if(!basedir) {
        log("No basedir, not reloading");
        return;
    }

    log("Loading workers from " + basedir);

    const files = findFiles(basedir, "worker.js");

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

            attrs.sendMavlinkMessage = mWorkerListener.onMavlinkMessage;
            attrs.sendGCSMessage = mWorkerListener.onGCSMessage;

            attrs.sysid = mConfig.sysid;
            attrs.compid = mConfig.compid;
            attrs.path = path.dirname(files[i]);

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
            mLoopTimer = setTimeout(loop, mConfig.loopTime);
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

function setConfig(config) {
    mConfig.sysid = config.sysid || 221;
    mConfig.compid = config.compid || 101;
    mConfig.loopTime = config.loop_time_ms || 1000;
    mConfig.udpPort = config.udp_port || 14550;
    mConfig.workerRoots = config.worker_roots || [];
}

function installWorker(srcPath, target, callback) {
    if(fs.existsSync(srcPath)) {
        if(!fs.existsSync(target)) {
            fs.mkdir(target); // Returns undefined, so check if it worked
        }

        if(!global.BIN_DIR) {
            return callback.onError("global.BIN_DIR is not defined");
        }

        // Run $APP/bin/install_worker.sh to install the worker.
        const child = child_process.spawn(path.join(global.BIN_DIR, "/install_worker.sh"), [srcPath, target]);
        const output = function(data) {
            log(data.toString());
        }

        child.stdout.on("data", output);
        child.stderr.on("data", output);

        child.on("close", function(rc) {
            log("script exited with return code " + rc);
            if(rc != 0) {
                callback.onError("Failed to install worker with exit code " + rc);
            } else {
                callback.onComplete();
            }
        });
    } else {
        callback.onError(srcPath + " not found");
    }
}

function removeWorker(workerId, callback) {
    const worker = mWorkers[workerId];
    if(worker) {
        if(worker.worker && worker.worker.unUnload) {
            worker.worker.onUnload();
        }

        delete mWorkers[workerId];

        const filePath = worker.getAttributes().path;
        if(filePath && fs.existsSync(filePath)) {
            if (!global.BIN_DIR) {
                return callback.onError("global.BIN_DIR is not defined");
            }

            // Run $APP/bin/install_worker.sh to install the worker.
            const child = child_process.spawn(path.join(global.BIN_DIR, "/remove_worker.sh"), [filePath]);
            const output = function (data) {
                log(data);
            }

            child.stdout.on("data", output);
            child.stderr.on("data", output);

            child.on("close", function (rc) {
                log("script exited with return code " + rc);
                if (rc != 0) {
                    callback.onError("Failed to remove worker with exit code " + rc);
                } else {
                    callback.onComplete();
                }
            });
        }
    } else {
        callback.onError("Worker " + workerId + " not found");
    }
}

exports.start = start;
exports.stop = stop;
exports.reload = reload;
exports.addGCSMessageListener = addGCSMessageListener;
exports.removeGCSMessageListener = removeGCSMessageListener;
exports.handleGCSMessage = handleGCSMessage;
exports.getWorkers = getWorkers;
exports.setConfig = setConfig;
exports.installWorker = installWorker;
exports.removeWorker = removeWorker;

function testReload() {
    mConfig.workerRoots = [
        "/home/kellys/work/drone/projects/solex-cc/workers"
    ];

    reload();
    start();
}

function testInstallWorker() {
    global.BIN_DIR = require("path").join(__dirname, "../bin");
    log(global.BIN_DIR);

    const path = "/home/kellys/work/drone/projects/solex-cc/test/install-worker/test.zip";
    const target = "/home/kellys/work/drone/projects/solex-cc/workers/install_test";

    installWorker(path, target, {
        onError: function(msg) {
            log("ERR: " + msg);
        },

        onComplete: function() {
            log("onComplete()");

            setTimeout(function () {
                reload();
            }, 2000);
        }
    });
}

function testRemoveWorker() {
    const workerId = "16c62ff2-3187-4a6d-8b64-ee6038ca3931";

    removeWorker(workerId, {
        onError: function(msg) {
            log("ERR: " + msg);
        },

        onComplete: function() {
            log("onComplete()");

            setTimeout(function() {
                reload();
            }, 2000);
        }
    });
}

function test() {
    // testRemoveWorker();
    testInstallWorker();
    // testReload();
}

if(process.mainModule == module) {
    log("Running self test");
    test();
}
