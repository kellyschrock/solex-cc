'use strict';

const path = require("path");
const fs = require("fs");
const udpclient = require("../server/udpclient");
const logger = require("../util/logger");
const child_process = require("child_process");
// Need this for "new MAVLink()"
require("./mavlink.js");

// Config
const mConfig = {
    loopTime: 1000,
    sysid: 221,
    compid: 101,
    udpPort: 14550,
    logWorkers: [],
    workerRoots: []
};

// Worker list/map
var mWorkers = {};
// Worker load error list
var mWorkerLoadErrors = [];
// Lookup table (message id to list of workers interested in that message)
var mMavlinkLookup = {};
// Listeners for GCS messages from workers
const mGCSMessageListeners = [];
// Driver for looping
var mLoopTimer = null;
// Mavlink message parser
var mMavlink;

const mWorkerListener = {
    /** Gets a Mavlink message from the specified worker, sends it to the Mavlink output */
    onMavlinkMessage: function (workerId, msg) {
        trace("onMavlinkMessage(): workerId=" + workerId + " msg=" + msg);

        if(msg) {
            if (udpclient.isConnected()) {
                function ex() {
                    const m = msg;
                    return function () {
                        try {
                            const packet = Buffer.from(m.pack(mMavlink));
                            udpclient.sendMessage(packet);
                        } catch (ex) {
                            log("Error sending mavlink message from worker: " + ex.message);
                        }
                    }
                }

                process.nextTick(ex());
            } else {
                log("UDP client is not connected");
            }
        } else {
            log("WARNING: No message");
        }
    },

    /** Gets a GCS message from the specified worker, broadcasts to all GCSMessageListeners. */
    onGCSMessage: function (workerId, msg) {
        trace("GCS message from " + workerId + ": " + msg);

        function ex() {
            const m = msg;
            return function() {
                for (let i = 0, size = mGCSMessageListeners.length; i < size; ++i) {
                    mGCSMessageListeners[i].onGCSMessage(workerId, m);
                }
            };
        }

        process.nextTick(ex());
    },

    /** Gets a message from the specified worker, sends it to all other workers in the system */
    onBroadcastMessage: function(workerId, msg) {
        trace("Broadcast message from " + workerId + ": " + msg);

        if (mWorkers) {
            function ex() {
                const wid = workerId;
                const m = msg;
                return function() {
                    for (var prop in mWorkers) {
                        const worker = mWorkers[prop];

                        if (!worker.worker) continue;
                        if (worker.attributes.id === wid) continue;

                        if (worker.worker.onGCSMessage) {
                            try {
                                worker.worker.onGCSMessage(m);
                            } catch(ex) {
                                handleWorkerCallException(worker, ex);
                            }
                        }
                    }
                }
            }

            process.nextTick(ex());
        }
    },

    /** Called by a worker to get a list of the other workers on the system */
    getWorkerRoster: function(workerId) {
        const others = [];

        for (var prop in mWorkers) {
            const worker = mWorkers[prop];

            if (!worker.worker) continue;
            if (worker.attributes.id === workerId) continue;

            others.push({
                attributes: worker.attributes,
                worker: worker.worker
            });
        }

        return others;
    },

    findWorkerById: function(workerId) {
        const worker = mWorkers[workerId];

        return (worker && worker.worker)?
            worker.worker: null;
    },

    workerLog: function(workerId, msg) {
        const filter = mConfig.logWorkers || [];

        if(filter.length === 0 || filter.indexOf(workerId) >= 0) {
            console.log(`${workerId}: ${msg}`);

            for (let i = 0, size = mGCSMessageListeners.length; i < size; ++i) {
                mGCSMessageListeners[i].onLogMessage(workerId, msg);
            }
        }
    }
};

const mConnectionCallback = {
    onOpen: function (port) {
        // Connection opened
        trace("onOpen()");
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
        trace("onClose()");
        mMavlink = null;
    },

    onError: function (err) {
        trace("onError(): " + err);
    }
};

function log(s) {
    logger.v(__filename, s);
}

function trace(s) {
    if(global.TRACE) {
        logger.v(__filename + "(trace)", s);
    }
}

function findFiles(dir, filter) {
    var out = [];

    if(!fs.existsSync(dir)) {
        log(dir + " not found");
        return out;
    }

    const files = fs.readdirSync(dir);
    for (let i = 0, size = files.length; i < size; i++) {
        const filename = path.join(dir, files[i]);
        const stat = fs.lstatSync(filename);

        if (stat.isDirectory()) {
            const children = findFiles(filename, filter);
            if(children) {
                for(let j = 0, sz = children.length; j < sz; ++j) {
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
    trace("onReceivedMavlinkMessage(): msg=" + msg);

    if(mMavlinkLookup && msg.name) {
        const lookup = mMavlinkLookup[msg.name];
        if(lookup) {
            const workers = lookup.workers;

            for(let i = 0, size = workers.length; i < size; ++i) {
                const worker = workers[i];
                try {
                    trace("Send " + msg.name + " to " + worker.attributes.name);

                    if(worker.worker.onMavlinkMessage) {
                        try {
                            worker.worker.onMavlinkMessage(msg);
                        } catch(ex) {
                            handleWorkerCallException(worker, ex);
                        }
                    }
                } catch (ex) {
                    log("Exception hitting onMavlinkMessage() in " + worker.attributes.name + ": " + ex.message);
                    console.trace();
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
        mLoopTimer = null;
    }

    try {
        udpclient.disconnect(mConnectionCallback);
    } catch(ex) {
        log("Error closing UDP: " + ex.message);
    }
}

function running() {
    return (mLoopTimer != null);
}

function unloadWorker(worker) {
    if (worker && worker.worker && worker.worker.onUnload) {
        trace("Unload " + worker.attributes.name);
        try {
            worker.worker.onUnload();
        } catch (ex) {
            handleWorkerCallException(worker, ex);
        }
    }

    if (worker.cacheName) {
        log("Deleting " + worker.cacheName + " from cache");
        delete require.cache[require.resolve(worker.cacheName)];
    }
}

function unloadWorkers() {
    if(mWorkers) {
        for(let prop in mWorkers) {
            const worker = mWorkers[prop];
            unloadWorker(worker);
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

    mWorkerLoadErrors = [];
    const roots = mConfig.workerRoots;

    if(roots) {
        for (let i = 0, size = roots.length; i < size; ++i) {
            loadWorkerRoot(roots[i]);
        }
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

    for(let i = 0, size = files.length; i < size; ++i) {
        try {
            // Load the module
            const worker = require(files[i]);

            const attrs = worker.getAttributes() || { name: "No name", looper: false };

            if(!attrs.id) {
                log("Worker " + attrs.name + " in " + files[i] + " has no id, not loading");
                continue;
            }

            const workerId = attrs.id;

            attrs.sendMavlinkMessage = mWorkerListener.onMavlinkMessage;
            attrs.sendGCSMessage = mWorkerListener.onGCSMessage;
            attrs.broadcastMessage = mWorkerListener.onBroadcastMessage;
            attrs.getWorkerRoster = mWorkerListener.getWorkerRoster;
            attrs.findWorkerById = mWorkerListener.findWorkerById;
            attrs.log = mWorkerListener.workerLog;

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
                for(let x = 0, sz = attrs.mavlinkMessages.length; x < sz; ++x) {
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

            shell.cacheName = files[i];

            if(mWorkers[workerId]) {
                log(`Worker ${workerId} already loaded. Unload`);
                unloadWorker(mWorkers[workerId]);
            }

            mWorkers[workerId] = shell;

            // Delay loading workers a bit
            if (worker.onLoad) {
                setTimeout(function(werker) {
                    try {
                        werker.onLoad();
                    } catch(ex) {
                        handleWorkerCallException(werker, ex);
                    }
                }, 1000 * (i + 1), worker);
            }
        } catch(ex) {
            log("Error loading worker at " + files[i] + ": " + ex.message);

            if(!mWorkerLoadErrors) {
                mWorkerLoadErrors = [];
            }

            mWorkerLoadErrors.push({
                path: files[i], error: ex.message, detail: ex.stack
            });
        }
    }
}

function handleWorkerCallException(worker, ex) {
    const workerId = worker.attributes.id;
    const msg = {
        id: "worker_exception",
        worker_id: workerId,
        stack: ex.stack
    };

    log(`Exception for ${workerId}: ${ex.message}`);

    // Report this worker and unload it.
    mWorkerListener.onGCSMessage(workerId, msg);
    unloadWorker(worker);
    delete mWorkers[workerId];
}

// Called periodically to loop the workers.
function loop() {
    if(mWorkers) {
        var hasLoopers = false;

        for(let prop in mWorkers) {
            const worker = mWorkers[prop];
            if(worker && worker.attributes.looper && worker.worker && worker.worker.loop) {
                hasLoopers = true;
                try {
                    worker.worker.loop();
                } catch(ex) {
                    handleWorkerCallException(worker, ex);
                }
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
    trace("handleGCSMessage(): workerId=" + workerId);

    if(mWorkers) {
        const worker = mWorkers[workerId];

        if(worker) {
            if(worker.worker) {
                if(worker.worker.onGCSMessage) {
                    try {
                        return worker.worker.onGCSMessage(msg);
                    } catch(ex) {
                        handleWorkerCallException(worker, ex);
                        return { ok: false, message: ex.message }
                    }
                } else {
                    return {
                        ok: false,
                        message: "Worker " + workerId + " has no onGCSMessage() function"
                    };
                }
            } else {
                return {
                    ok: false,
                    message: "Invalid worker at " + workerId
                };
            }
        } else {
            return {
                ok: false,
                message: "No worker with id of " + workerId
            };
        }
    }
}

function getWorkers() {
    const result = {
        workers: []
    };

    if(mWorkers) {
        for(let prop in mWorkers) {
            const worker = mWorkers[prop];
            if(worker.attributes) {
                result.workers.push(worker.attributes);
            }
        }
    }

    if(mWorkerLoadErrors) {
        result.load_errors = mWorkerLoadErrors;
    }

    return result;
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

        // Run $global.BIN_DIR/install_worker.sh to install the worker.
        const child = child_process.spawn(path.join(global.BIN_DIR, "install_worker.sh"), [srcPath, target]);
        var consoleOutput = "";
        const output = function(data) {
            log(data.toString());
            consoleOutput += data.toString();
        }

        child.stdout.on("data", output);
        child.stderr.on("data", output);

        child.on("close", function(rc) {
            log("script exited with return code " + rc);
            if(rc != 0) {
                callback.onError("Failed to install worker with exit code " + rc, consoleOutput.trim());
            } else {
                loadWorkerRoot(target);

                callback.onComplete();
                notifyRosterChanged();
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
            try {
                worker.worker.onUnload();
            } catch(ex) {
                handleWorkerCallException(worker, ex);
            }
        }

        if (worker.cacheName) {
            log("Deleting " + worker.cacheName + " from cache");
            delete require.cache[require.resolve(worker.cacheName)];
        }

        delete mWorkers[workerId];

        const filePath = worker.attributes.path;
        if(filePath && fs.existsSync(filePath)) {
            if (!global.BIN_DIR) {
                return callback.onError("global.BIN_DIR is not defined");
            }

            // Run $APP/bin/remove_worker.sh to remove the worker.
            const child = child_process.spawn(path.join(global.BIN_DIR, "remove_worker.sh"), [filePath]);
            const output = function (data) {
                log(data.toString());
            };

            child.stdout.on("data", output);
            child.stderr.on("data", output);

            child.on("close", function (rc) {
                log("script exited with return code " + rc);
                if (rc != 0) {
                    callback.onError("Failed to remove worker with exit code " + rc);
                } else {
                    callback.onComplete();
                    notifyRosterChanged();
                }
            });
        }
    } else {
        callback.onError("Worker " + workerId + " not found");
    }
}

function getLogWorkers() {
    return mConfig.logWorkers;
}

/** Set log_workers, passed as a comma-delimited string. Use "*" to clear the filter */
function setLogWorkers(workerIds) {
    if(!workerIds) return false;

    if(workerIds === "*") {
        delete mConfig.logWorkers;
        return true;
    }

    const ids = workerIds.split(",");
    if(ids) {
        mConfig.logWorkers = ids;
        return true;
    }

    return false;
}

function notifyRosterChanged() {
    if(!mWorkers) return;

    for (let prop in mWorkers) {
        const worker = mWorkers[prop];

        if (!worker.worker) continue;

        if (worker.worker.onRosterChanged) {
            try {
                worker.worker.onRosterChanged();
            } catch (ex) {
                handleWorkerCallException(worker, ex);
            }
        }
    }
}

exports.start = start;
exports.stop = stop;
exports.running = running;
exports.reload = reload;
exports.addGCSMessageListener = addGCSMessageListener;
exports.removeGCSMessageListener = removeGCSMessageListener;
exports.handleGCSMessage = handleGCSMessage;
exports.getWorkers = getWorkers;
exports.setConfig = setConfig;
exports.installWorker = installWorker;
exports.removeWorker = removeWorker;
exports.getLogWorkers = getLogWorkers;
exports.setLogWorkers = setLogWorkers;

function testReload() {
    mConfig.workerRoots = [
        "/home/kellys/work/drone/projects/solex-cc/workers"
    ];

    reload();
    start();
}

function test() {
    // testRemoveWorker();
    // testInstallWorker();
    testReload();
}

if(process.mainModule === module) {
    log("Running self test");
    test();
}
