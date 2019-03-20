'use strict';

const path = require("path");
const fs = require("fs");
const udpclient = require("../server/udpclient");
const logger = require("../util/logger");
const child_process = require("child_process");
require("jspack");
// Need this for "new MAVLink()"
const mavlink = require("./mavlink.js");

const VERBOSE = false;

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
// Worker lib list
var mWorkerLibraries = {};
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
                    for (let prop in mWorkers) {
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

        for (let prop in mWorkers) {
            const worker = mWorkers[prop];

            if (!worker.worker) continue;
            if (worker.attributes.id === workerId) continue;

            others.push({
                attributes: worker.attributes,
                worker: worker.worker,
                enabled: worker.enabled
            });
        }

        return others;
    },

    subscribeMavlinkMessages: function(workerId, messages) {
        const worker = mWorkers[workerId];
        if(!worker) return;

        worker.attributes.mavlinkMessages = messages;

        messages.map(function(message) {
            const name = message;

            if(mMavlinkLookup[name]) {
                mMavlinkLookup[name].workers.push(worker);
            } else {
                mMavlinkLookup[name] = { workers: [worker]};
            }
        });
    },

    findWorkerById: function(workerId) {
        const worker = mWorkers[workerId];

        return (worker && worker.worker)?
            worker.worker: null;
    },

    findWorkersInPackage: function(packageId) {
        const out = [];

        for(let workerId in mWorkers) {
            const worker = mWorkers[workerId];
            const attrs = worker.attributes;
            if(attrs && attrs.parent_package && attrs.parent_package.id === packageId) {
                out.push(worker.worker);
            }
        }

        return out;
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
    logger.v(path.basename(__filename, ".js"), s);
}

function v(str) {
    if(VERBOSE) log(str);
}

function trace(s) {
    if(global.TRACE) {
        logger.v(__filename + "(trace)", s);
    }
}

/**
 * 
 * @param {string} dir 
 * @param {string} filter 
 * @returns an array of filenames
 */
function findFiles(dir, filter) {
    var out = [];

    if(!fs.existsSync(dir)) {
        log(dir + " not found");
        return out;
    }

    const files = fs.readdirSync(dir);
    var manifest = null;

    for (let i = 0, size = files.length; i < size; i++) {
        const filename = path.join(dir, files[i]);
        const stat = fs.lstatSync(filename);

        if (stat.isDirectory()) {
            const children = findFiles(filename, filter);
            if(children) {
                children.map(function(child) {
                    out.push(child);
                });
            }
        } else {
            if (filter) {
                if (filename.indexOf(filter) >= 0) {
                    out.push(filename);
                    log(`found ${filename}`);
                }
            } else {
                log(`found ${filename}`);
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

            workers.map(function(worker) {
                try {
                    trace("Send " + msg.name + " to " + worker.attributes.name);

                    if (worker.worker.onMavlinkMessage) {
                        try {
                            worker.worker.onMavlinkMessage(msg);
                        } catch (ex) {
                            handleWorkerCallException(worker, ex);
                        }
                    }
                } catch (ex) {
                    log("Exception hitting onMavlinkMessage() in " + worker.attributes.name + ": " + ex.message);
                    console.trace();
                }
            });
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

function reloadWorker(workerId) {
    const worker = mWorkers[workerId];
    if(worker) {
        const cacheName = worker.cacheName;
        log(`cacheName=${cacheName}`);
        const dirName = path.dirname(cacheName);
        log(`dirName=${dirName}`);

        if(fs.existsSync(dirName)) {
            delete mWorkers[workerId];

            unloadWorker(worker);
            loadWorkerRoot(dirName);
            notifyRosterChanged();
            return true;
        } else {
            log(`Directory ${dirName} not found`);
            return false;
        }
    } else {
        return false;
    }
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
            unloadWorker(mWorkers[prop]);
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

    // TODO: Unload these first.
    mWorkerLibraries = {};

    const roots = mConfig.workerRoots;

    if(mConfig.workerLibRoot) {
        loadWorkerLibsIn(mConfig.workerLibRoot);
    }

    if(roots) {
        roots.map(function(root) {
            loadWorkerRoot(root);
        });
    }

    v(mWorkers);

    loadWorkerEnabledStates();
}

function loadWorkerRoot(basedir) {
    if(!basedir) {
        log("No basedir, not reloading");
        return;
    }

    log("Loading workers from " + basedir);

    const files = findFiles(basedir, "worker.js");

    const manifests = findFiles(basedir, "manifest.json");
    const packages = [];

    manifests.map(function(manifest) {
        try {
            const jo = JSON.parse(fs.readFileSync(manifest));
            jo.path = path.dirname(manifest);
            packages.push({ file: manifest, parent_package: jo });
        } catch(ex) {
            log(`Error parsing manifest: ${ex.message}`);
        }
    });

    log(`manifests=${manifests}`);

    for(let i = 0, size = files.length; i < size; ++i) {
        try {
            // Load the module
            const worker = require(files[i]);

            // const attrs = worker.getAttributes() || { name: "No name", looper: false };
            const attrs = (worker.getAttributes)? worker.getAttributes() || { name: "No name", looper: false }: null;
            if(!attrs) {
                log(`Worker has no getAttributes() function, skip`);
                continue;
            }

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
            attrs.findWorkersInPackage = mWorkerListener.findWorkersInPackage;
            attrs.subscribeMavlinkMessages = mWorkerListener.subscribeMavlinkMessages;
            attrs.log = mWorkerListener.workerLog;

            packages.map(function(pk) {
                const dirname = path.dirname(pk.file);
                if(files[i].indexOf(dirname) >= 0) {
                    attrs.parent_package = pk.parent_package;
                }
            });

            attrs.api = { 
                // unconditional loads here
                Mavlink: mavlink 
            };

            for(let prop in mWorkerLibraries) {
                attrs.api[prop] = mWorkerLibraries[prop].module;
            }

            attrs.sysid = mConfig.sysid;
            attrs.compid = mConfig.compid;
            attrs.path = path.dirname(files[i]);

            const shell = {
                worker: worker,
                attributes: attrs,
                enabled: true
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
                }, 100 * (i + 1), worker);
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

function loadWorkerLibsIn(dir) {
    log(`loadWorkerLibsIn(${dir})`);

    if(!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.map(function (file) {
        const filename = path.join(dir, file);
        const prop = path.basename(file, path.extname(file));

        try {
            log(`load library module: ${filename}`);
            const module = require(filename);

            const lib = {
                module: module,
                cacheName: filename
            };

            if (!mWorkerLibraries) {
                mWorkerLibraries = {};
            }

            mWorkerLibraries[prop] = lib;
        } catch(ex) {
            log(`load library module error - ${filename}: ${ex.message}`);
            mWorkerLibraries[prop] = {
                error: ex.message
            };
        }
    });
}

function handleWorkerCallException(worker, ex) {
    const workerId = (worker && worker.attributes)?
        worker.attributes.id : "(no worker id)";

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
                if(!worker.enabled) continue;

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

function handleWorkerDownload(body) {
    const workerId = body.worker_id; // Worker
    const msgId = body.msg_id; // Action message
    const contentId = body.content_id; // Content to download

    var output = null;

    if(mWorkers) {
        const worker = mWorkers[workerId];

        if(worker && worker.enabled) {
            if(worker.worker) {
                if(worker.worker.onContentDownload) {
                    output = worker.worker.onContentDownload(msgId, contentId);
                }
            }
        }
    }

    return output;
}

function handleScreenEnter(screenName) {
    const output = {};

    if(mWorkers) {
        for (let prop in mWorkers) {
            const worker = mWorkers[prop];
            if (!worker.worker) continue;
            if (!worker.enabled) continue;

            if (worker.worker.onScreenEnter) {
                try {
                    const item = worker.worker.onScreenEnter(screenName);

                    if(item) {
                        for(let itemProp in item) {
                            if(output[itemProp]) {
                                output[itemProp].push(item[itemProp]);
                            } else {
                                output[itemProp] = [item[itemProp]];
                            }
                        }
                    }
                } catch (ex) {
                    handleWorkerCallException(worker, ex);
                }
            }
        }
    }

    return output;
}

function handleScreenExit(screenName) {
    const output = {};

    if (mWorkers) {
        for (let prop in mWorkers) {
            const worker = mWorkers[prop];
            if (!worker.worker) continue;
            if (!worker.enabled) continue;
            
            if (worker.worker.onScreenExit) {
                try {
                    const item = worker.worker.onScreenExit(screenName);

                    if (item) {
                        if (item.panel && item.layout) {
                            output[item.panel] = item.layout;
                        }
                    }
                } catch (ex) {
                    handleWorkerCallException(worker, ex);
                }
            }
        }
    }

    return output;
}

/** Gather up features from workers for the /features endpoint */
function gatherFeatures() {
    const output = {};

    if (mWorkers) {
        for (let prop in mWorkers) {
            const worker = mWorkers[prop];
            if (!worker.worker) continue;
            if (!worker.enabled) continue;
            if(!worker.worker.getFeatures) continue;

            const features = worker.worker.getFeatures();
            if(features) {
                for(let prop in features) {
                    // A given feature from a worker overwrites any existing features in the output, so they must be unique!
                    output[prop] = features[prop];
                }
            }
        }
    }

    return output;
}

function imageDownload(req, res) {
    const worker_id = req.params.worker_id;
    const name = req.params.name;

    if(mWorkers) {
        const worker = mWorkers[worker_id];

        if (worker && worker.enabled && worker.worker && worker.worker.onImageDownload) {
            const img = worker.worker.onImageDownload(name);
            if(img) {
                res.status(200).end(img, "binary");
            } else {
                res.status(404).json({message: `Image ${name} not found for ${worker_id}`});
            }
        }
    } else {
        res.status(404).json({ message: `worker ${worker_id} not found`});
    }
}

function handleGCSMessage(workerId, msg) {
    trace("handleGCSMessage(): workerId=" + workerId);

    if(mWorkers) {
        const worker = mWorkers[workerId];

        if(worker) {
            if(!worker.enabled) {
                return {
                    ok: false,
                    message: `worker ${workerId} not enabled`,
                    worker_id: workerId,
                    source_id: msg.id
                };
            }

            if(worker.worker) {
                if(worker.worker.onGCSMessage) {
                    try {
                        const output = worker.worker.onGCSMessage(msg) || {
                            ok: true
                        };

                        output.worker_id = workerId;
                        output.source_id = msg.id;
                        
                        return output;
                    } catch(ex) {
                        handleWorkerCallException(worker, ex);
                        return { 
                            ok: false, 
                            worker_id: workerId,
                            source_id: msg.id,
                            message: ex.message 
                        };
                    }
                } else {
                    return {
                        ok: false,
                        message: `Worker ${workerId} has no onGCSMessage() interface`,
                        worker_id: workerId,
                        source_id: msg.id
                    };
                }
            } else {
                return {
                    ok: false,
                    message: "Invalid worker at " + workerId,
                    worker_id: workerId,
                    source_id: msg.id
                };
            }
        } else {
            return {
                ok: false,
                message: "No worker with id of " + workerId,
                worker_id: workerId,
                source_id: msg.id
            };
        }
    } else {
        return {
            ok: false,
            message: "FATAL: No workers",
            worker_id: workerId,
            source_id: msg.id
        };
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
                const val = worker.attributes;
                val.enabled = worker.enabled;

                result.workers.push(val);
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
    mConfig.workerLibs = config.worker_lib_dirs || [];
    mConfig.workerLibRoot = config.worker_lib_root;
}

function checkForManifestIn(srcPath, callback) {
    callback();
}

function installWorker(srcPath, target, callback) {
    if(!fs.existsSync(srcPath)) {
        return callback.onError(srcPath + " not found");
    }

    if(!global.BIN_DIR) {
        return callback.onError("global.BIN_DIR is not defined");
    }

    if (!fs.existsSync(target)) {
        fs.mkdir(target); // Returns undefined, so check if it worked
    }

    function installSingleWorkerTo(target) {
        // Run $global.BIN_DIR/install_worker.sh to install the worker.
        const child = child_process.spawn(path.join(global.BIN_DIR, "install_worker.sh"), [srcPath, target]);
        var consoleOutput = "";
        const output = function (data) {
            log(data.toString());
            consoleOutput += data.toString();
        }

        child.stdout.on("data", output);
        child.stderr.on("data", output);

        child.on("close", function (rc) {
            log("script exited with return code " + rc);
            if (rc != 0) {
                callback.onError("Failed to install worker with exit code " + rc, consoleOutput.trim());
            } else {
                loadWorkerRoot(target);

                callback.onComplete();
                notifyRosterChanged();
            }
        });
    }

    installSingleWorkerTo(target);
}

function enableWorker(workerId, enable, callback) {
    const worker = mWorkers[workerId];
    if(worker) {
        worker.enabled = ("true" === enable);
        callback(null, enable);

        saveWorkerEnabledStates();
        notifyRosterChanged();
    } else {
        callback(new Error(`No worker named ${workerId}`), false);
    }
}

function enablePackage(packageId, enable, callback) {
    for(let workerId in mWorkers) {
        const worker = mWorkers[workerId];
        if (worker) {
            const attrs = worker.attributes;
            if (attrs && attrs.parent_package && attrs.parent_package.id === packageId) {
                worker.enabled = ("true" === enable);
            }
        }
    }

    saveWorkerEnabledStates();
    callback(null, enable);
}

function removePackage(packageId, callback) {
    const workers = [];

    var packagePath = null;

    for(let workerId in mWorkers) {
        const worker = mWorkers[workerId];
        if(!worker) continue;

        const attrs = worker.attributes;
        if(attrs && attrs.parent_package && attrs.parent_package.id === packageId) {
            workers.push(worker);

            if(attrs.parent_package.path && !packagePath) {
                packagePath = attrs.parent_package.path;
            }
        }
    }

    workers.map(function(worker) {
        if(worker.worker) {
            try {
                removeWorker(worker.attributes.id, callback);
            } catch(ex) {
                log(`Error unloading worker ${worker.id}: ${ex.message}`);
            }
        }
    });

    if (packagePath && fs.existsSync(packagePath)) {
        if (!global.BIN_DIR) {
            return callback.onError("global.BIN_DIR is not defined");
        }

        // Run $APP/bin/remove_worker.sh to remove the worker.
        const child = child_process.spawn(path.join(global.BIN_DIR, "remove_worker.sh"), [packagePath]);
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
            }
        });
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

function getWorkerEnabledConfigFile() {
    return path.join(__dirname, "workers_enabled.json");
}

function saveWorkerEnabledStates() {
    const enablements = {};

    if (mWorkers) {
        for (let workerId in mWorkers) {
            const worker = mWorkers[workerId];
            if (worker) {
                enablements[workerId] = worker.enabled;
            }
        }

        try {
            fs.writeFileSync(getWorkerEnabledConfigFile(), JSON.stringify(enablements));
        } catch (ex) {
            log(`Error saving enabled states: ${ex.message}`);
        }
    }
}

function loadWorkerEnabledStates() {
    log(`loadWorkerEnabledStates()`);

    const file = getWorkerEnabledConfigFile();
    fs.exists(file, function (exists) {
        if (exists) {
            fs.readFile(file, function (err, data) {
                try {
                    const enabledStates = JSON.parse(data.toString());

                    if(mWorkers && enabledStates) {
                        for(let workerId in mWorkers) {
                            const worker = mWorkers[workerId];
                            if(worker) {
                                if(enabledStates.hasOwnProperty(workerId)) {
                                    worker.enabled = enabledStates[workerId];
                                }
                            }
                        }
                    }

                } catch(ex) {
                    log(`Error loading enabled state: ${ex.message}`);
                }
            });
        }
    });
}

exports.start = start;
exports.stop = stop;
exports.running = running;
exports.reload = reload;
exports.addGCSMessageListener = addGCSMessageListener;
exports.removeGCSMessageListener = removeGCSMessageListener;
exports.handleGCSMessage = handleGCSMessage;
exports.handleScreenEnter = handleScreenEnter;
exports.handleScreenExit = handleScreenExit;
exports.imageDownload = imageDownload;
exports.handleWorkerDownload = handleWorkerDownload;
exports.getWorkers = getWorkers;
exports.setConfig = setConfig;
exports.installWorker = installWorker;
exports.removeWorker = removeWorker;
exports.reloadWorker = reloadWorker;
exports.removePackage = removePackage;
exports.enableWorker = enableWorker;
exports.enablePackage = enablePackage;
exports.gatherFeatures = gatherFeatures;
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
