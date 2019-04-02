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
// Worker load error list
var mWorkerLoadErrors = [];
// Listeners for GCS messages from workers
const mGCSMessageListeners = [];
// Monitors (for debug page)
const mMonitors = {};
// Callbacks for GCS responses
const mQueuedCallbacks = {};
// Worker enabled states
var mWorkerEnabledStates = {};
// Mavlink message parser
var mMavlink;
// Screen-enter requests
const mScreenEnterRequests = {};
// Screen-exit requests
const mScreenExitRequests = {};

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

function log(s) { logger.v(path.basename(__filename, ".js"), s); }
function d(s) { log(s); }
function v(str) { if (VERBOSE) log(str); }
function trace(s) { if (global.TRACE) { logger.v(__filename + "(trace)", s); } }

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

    for(let pid in mWorkers) {
        const worker = mWorkers[pid];
        if(worker && worker.child && worker.enabled) {
            worker.child.send({id: "mavlink_msg", msg: msg});
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
}

function stop() {
    try {
        udpclient.disconnect(mConnectionCallback);
    } catch(ex) {
        log("Error closing UDP: " + ex.message);
    }
}

function running() {
    return (mWorkers != null);
}

function reloadWorker(workerId) {
    const worker = findWorkerById(workerId);
    
    if(worker) {
        const child = worker.child;
        child.send({id: "reload", msg: {}});
        return true;
    } 
    
    return false;
}

function unloadWorker(worker) {
    const child = worker.child;
    child.send({id: "unload", msg: {}});
}

function unloadWorkers() {
    d(`unloadWorkers()`);

    if(mWorkers) {
        for(let pid in mWorkers) {
            unloadWorker(mWorkers[pid]);
        }
    }

    mWorkers = {};
}

function reload() {
    unloadWorkers();

    mWorkerLoadErrors = [];

    const roots = mConfig.workerRoots;

    loadWorkerEnabledStates();

    if(roots) {
        roots.map(function(root) {
            loadWorkerRoot(root);
        });
    }

    v(mWorkers);
}

function setupWorkerCallbacks(child) {
    const childProcMap = {
        "worker_loaded": workerLoaded,
        "load_abort": loadAbort,
        "worker_log": workerLog,
        "worker_mavlink": workerMavlink,
        "worker_gcs": workerGCS,
        "gcs_msg_response": gcsMessageResponse,
        "worker_broadcast": workerBroadcast,
        "worker_removed": workerRemoved,
        "screen_enter_response": screenEnterResponse,
        "screen_exit_response": screenExitResponse
    };

    // Finished loading a worker.
    function workerLoaded(msg) {
        // msg.pid, msg.worker_id, msg.file
        // log(`workerLoaded(): ${JSON.stringify(msg)}`);
        log(`workerLoaded(): ${msg.worker_id}`);

        if(mWorkers && msg.pid) {
            const val = mWorkers[msg.pid];
            if(val) {
                val.worker_id = msg.worker_id;
                val.path = msg.file;
                val.attributes = msg.attributes;
                val.enabled = msg.enabled;

                if (mWorkerEnabledStates) {
                    if (mWorkerEnabledStates.hasOwnProperty(val.worker_id)) {
                        val.enabled = mWorkerEnabledStates[val.worker_id];
                    }
                }
            }
        }
    }

    // Worker told us it's been removed.
    function workerRemoved(msg) {
        const worker = findWorkerById(msg.worker_id);
        if(worker && worker.child) {
            delete mWorkers[worker.child.pid];
            delete mQueuedCallbacks[worker.child.pid];
        }
    }

    // Handle screen-enter responses from workers
    function screenEnterResponse(msg) {
        const screen = msg.screen_name;
        const res = mScreenEnterRequests[screen];

        if(res) {
            if(!res.responses) {
                res.responses = [];
            }

            if(msg.data) {
                res.responses.push({ pid: msg.pid, data: msg.data});
            }

            res.pids.splice(res.pids.indexOf(msg.pid), 1);

            if(res.pids.length == 0) {
                d(`Got all responses`);

                const output = {};

                res.responses.map(function(response) {
                    const item = response.data;
                    if(!item) return;

                    for (let itemProp in item) {
                        if (output[itemProp]) {
                            output[itemProp].push(item[itemProp]);
                        } else {
                            output[itemProp] = [item[itemProp]];
                        }
                    }
                });

                if(res.callback) res.callback(null, output);

                delete mScreenEnterRequests[screen];
                d(`Cleared requests for ${screen}, leaving ${JSON.stringify(mScreenEnterRequests)}`);
            }
        } else {
            // Something's gone wrong. Just call back and get done.
            d(`WTF! ${JSON.stringify(mScreenEnterRequests)}`);
        }
    }

    // Handle screen-exit responses from workers.
    function screenExitResponse(msg) {
        const screen = msg.screen_name;
        const res = mScreenExitRequests[screen];

        if(res) {
            if(!res.responses) {
                res.responses = [];
            }

            if(msg.data) {
                res.responses.push({ pid: msg.pid, data: msg.data});
            }

            res.pids.splice(res.pids.indexOf(msg.pid), 1);

            if(res.pids.length == 0) {
                d(`Got all responses`);

                const output = {};

                res.responses.map(function(response) {
                    const item = response.data;
                    if (!item) return;
                    if (item.panel && item.layout) {
                        output[item.panel] = item.layout;
                    }
                });

                if(res.callback) res.callback(null, output);

                delete mScreenExitRequests[screen];
                d(`Cleared exit requests for ${screen}, leaving ${JSON.stringify(mScreenExitRequests)}`);
            }
        } else {
            // Something's gone wrong.
            d(`WTF! ${JSON.stringify(mScreenExitRequests)}`);
        }
    }

    // Aborted loading a worker. msg.file is the file that wasn't loaded.
    function loadAbort(msg) {
        log(`Worker load failure: ${msg.msg}`);
        // log(`Failed to load worker in ${msg.file}: ${msg.msg}`);
        mWorkerLoadErrors.push({ file: msg.file, message: msg.msg});
    }

    // Worker logged a message.
    function workerLog(msg) {
        // msg.worker_id, msg.msg (text to log)
        const filter = mConfig.logWorkers || [];

        if (filter.length === 0 || filter.indexOf(workerId) >= 0) {
            console.log(`${msg.worker_id}: ${msg.msg}`);

            for (let i = 0, size = mGCSMessageListeners.length; i < size; ++i) {
                mGCSMessageListeners[i].onLogMessage(msg.worker_id, msg.msg);
            }
        }
    }

    // Worker sent a mavlink message.
    function workerMavlink(msg) {
        // msg.worker_id, msg.mavlinkMessage
        if (msg.mavlinkMessage) {
            if (udpclient.isConnected()) {
                const packet = Buffer.from(msg.mavlinkMessage.pack(mMavlink));

                try {
                    udpclient.sendMessage(packet);
                } catch (ex) {
                    d(`Error sending mavlink message from worker: ${ex.message}`);
                }
            } else {
                d("UDP client is not connected");
            }
        } else {
            d("WARNING: No message");
        }
    }

    // Worker sent a GCS message.
    function workerGCS(msg) {
        // d(`workerGCS(): ${JSON.stringify(msg)}`);

        // msg.worker_id, msg.msg
        if(msg.msg && msg.worker_id) {
            mGCSMessageListeners.map(function (listener) {
                if (listener.onGCSMessage) {
                    listener.onGCSMessage(msg.worker_id, msg.msg);
                }
            });
        } else {
            d(`Warning: No message/worker_id in ${JSON.stringify(msg)}`);
        }
    }

    // Worker responded to a GCS message.
    function gcsMessageResponse(msg) {
        d(`gcsMessageResponse(${JSON.stringify(msg)})`);

        if(mQueuedCallbacks[child.pid]) {
            d(`have callbacks for ${child.pid}`);

            const workerId = msg.worker_id;

            if(mQueuedCallbacks[child.pid][workerId]) {
                d(`have callbacks for ${workerId}`);

                if(mQueuedCallbacks[child.pid][workerId][msg.request.id]) {
                    d(`have callback for ${msg.request.id}`);

                    mQueuedCallbacks[child.pid][workerId][msg.request.id](null, msg.response);
                    delete mQueuedCallbacks[child.pid][workerId][msg.request.id];
                }

                if(Object.keys(mQueuedCallbacks[child.pid][workerId]).length == 0) {
                    delete mQueuedCallbacks[child.pid][workerId];
                }
            }

            if(Object.keys(mQueuedCallbacks[child.pid]).length == 0) {
                d(`clear callbacks for ${child.pid}`);
                delete mQueuedCallbacks[child.pid];
            }
        }
    }

    // A worker broadcast a message for other workers.
    function workerBroadcast(msg) {
        if (mWorkers) {
            for (let pid in mWorkers) {
                const worker = mWorkers[pid];
                if(worker && worker.child) {
                    worker.child.send({id: "gcs_msg", msg: { worker_id: worker.worker_id, msg: msg}});
                }
            }
        }
    }

    // set up callbacks
    child.on("message", function(msg) {
        const func = childProcMap[msg.id];
        if(func) {
            func(msg.msg);
        } else {
            log(`No mapping for child message ${msg.id}`);
        }
    });

    child.on("exit", function(code, signal) {
        if(signal) {
            d(`Child ${child.pid} was killed by signal ${signal}`);
        } else if(code !== 0) {
            d(`Child ${child.pid} exited with error code ${code}`);
        } else {
            d(`Child ${child.pid} normal exit`);
        }

        if(mWorkers && mWorkers[child.pid]) {
            delete mWorkers[child.pid];
        }
    });
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
            // Start a sub-process and tell it to load the specified worker.
            const child = child_process.fork(path.join(__dirname, "worker_app.js"));
            d(`Started ${child.pid}`);

            setupWorkerCallbacks(child);

            mWorkers[child.pid] = {
                child: child
            };

            child.send({ id: "config", msg: { config: mConfig } });
            child.send({ id: "load_libraries", msg: { path: mConfig.workerLibRoot }});

            setTimeout(function () {
                child.send({ id: "load_worker", msg: {file: files[i] } });
            }, 100 * i);

            // const worker = require(files[i]);

            // // const attrs = worker.getAttributes() || { name: "No name", looper: false };
            // const attrs = (worker.getAttributes)? worker.getAttributes() || { name: "No name", looper: false }: null;
            // if(!attrs) {
            //     log(`Worker has no getAttributes() function, skip`);
            //     continue;
            // }

            // if(!attrs.id) {
            //     log("Worker " + attrs.name + " in " + files[i] + " has no id, not loading");
            //     continue;
            // }

            // const workerId = attrs.id;

            // attrs.sendMavlinkMessage = mWorkerListener.onMavlinkMessage;
            // attrs.sendGCSMessage = mWorkerListener.onGCSMessage;
            // attrs.broadcastMessage = mWorkerListener.onBroadcastMessage;
            // attrs.getWorkerRoster = mWorkerListener.getWorkerRoster;
            // attrs.findWorkerById = mWorkerListener.findWorkerById;
            // attrs.findWorkersInPackage = mWorkerListener.findWorkersInPackage;
            // attrs.subscribeMavlinkMessages = mWorkerListener.subscribeMavlinkMessages;
            // attrs.log = mWorkerListener.workerLog;

            // packages.map(function(pk) {
            //     const dirname = path.dirname(pk.file);
            //     if(files[i].indexOf(dirname) >= 0) {
            //         attrs.parent_package = pk.parent_package;
            //     }
            // });

            // attrs.api = { 
            //     // unconditional loads here
            //     Mavlink: mavlink 
            // };

            // attrs.sysid = mConfig.sysid;
            // attrs.compid = mConfig.compid;
            // attrs.path = path.dirname(files[i]);

            // const shell = {
            //     worker: worker,
            //     attributes: attrs,
            //     enabled: true
            // };

            // // If this guy is looking for mavlink messages, index the messages by name for fast
            // // lookup in onReceivedMavlinkMessage().
            // if (attrs.mavlinkMessages) {
            //     for(let x = 0, sz = attrs.mavlinkMessages.length; x < sz; ++x) {
            //         const name = attrs.mavlinkMessages[x];

            //         if (mMavlinkLookup[name]) {
            //             mMavlinkLookup[name].workers.push(shell);
            //         } else {
            //             mMavlinkLookup[name] = {
            //                 workers: [shell]
            //             };
            //         }
            //     }
            // }

            // shell.cacheName = files[i];

            // if(mWorkers[workerId]) {
            //     log(`Worker ${workerId} already loaded. Unload`);
            //     unloadWorker(mWorkers[workerId]);
            // }

            // mWorkers[workerId] = shell;

            // // Delay loading workers a bit
            // if (worker.onLoad) {
            //     setTimeout(function(werker) {
            //         try {
            //             werker.onLoad();
            //         } catch(ex) {
            //             handleWorkerCallException(werker, ex);
            //         }
            //     }, 100 * (i + 1), worker);
            // }
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
    // TODO: Implement
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

function handleScreenEnter(screenName, callback) {

    // Need to make a list of PIDs I've requested data from so I can wait until they've all answered.
    mScreenEnterRequests[screenName] = {
        pids: [],
        callback: callback
    };

    const queue = mScreenEnterRequests[screenName];

    for(let pid in mWorkers) {
        const worker = mWorkers[pid];
        if(!worker) continue;
        if(!worker.enabled) continue;
        if(!worker.child) continue;
        queue.pids.push(worker.child.pid);
        
        worker.child.send({id: "screen_enter", msg: {screen_name: screenName}});
    }

    d(`Sent request to ${queue.pids.length} processes`);

    if(queue.pids.length == 0) {
        callback(null, {});
    }
}

function handleScreenExit(screenName, callback) {
    mScreenExitRequests[screenName] = {
        pids: [], callback: callback
    };

    const queue = mScreenExitRequests[screenName];

    for(let pid in mWorkers) {
        const worker = mWorkers[pid];
        if (!worker) continue;
        if (!worker.enabled) continue;
        if (!worker.child) continue;
        queue.pids.push(worker.child.pid);

        worker.child.send({ id: "screen_exit", msg: { screen_name: screenName } });
    }

    d(`Sent request to ${queue.pids.length} processes`);
    if (queue.pids.length == 0) {
        callback(null, {});
    }
}

/** Gather up features from workers for the /features endpoint */
function gatherFeatures() {
    const output = {};

    // TODO: Implement
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

    // TODO: Implement
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

// Monitor (or not) worker post and response data
function monitorWorker(workerId, monitor) {
    const worker = findWorkerById(workerId);
    if(worker) {
        if(monitor) {
            mMonitors[workerId] = true;
        } else {
            delete mMonitors[workerId];
        }
    }
}

function handleGCSMessage(workerId, msg, callback) {
    log("handleGCSMessage(): workerId=" + workerId);

    const worker = findWorkerById(workerId);
    if(worker && worker.child) {
        if(worker.enabled) {
            // Set a callback in global scope so it can be called when gcs_msg_response is triggered by the child process.
            if(!mQueuedCallbacks[worker.child.pid]) {
                mQueuedCallbacks[worker.child.pid] = {};
            }

            if(!mQueuedCallbacks[worker.child.pid][workerId]) {
                mQueuedCallbacks[worker.child.pid][workerId] = {};
            }

            mQueuedCallbacks[worker.child.pid][workerId][msg.id] = callback;

            worker.child.send({ id: "gcs_msg", msg: { message: msg } });

        } else {
            callback(null, {
                ok: false,
                message: `worker ${workerId} not enabled`,
                worker_id: workerId,
                source_id: msg.id
            });
        }
    } else {
        callback(null, {
            ok: false,
            message: `No worker called ${workerId}`,
            worker_id: workerId,
            source_id: msg.id
        });
    }

    // TODO: DO NOT DELETE. Get the monitoring stuff out of this first.
    // if(mWorkers) {
    //     const worker = mWorkers[workerId];

    //     if(worker) {
    //         if(!worker.enabled) {
    //             return {
    //                 ok: false,
    //                 message: `worker ${workerId} not enabled`,
    //                 worker_id: workerId,
    //                 source_id: msg.id
    //             };
    //         }

    //         if(worker.worker) {
    //             if(worker.worker.onGCSMessage) {
    //                 try {
    //                     const output = worker.worker.onGCSMessage(msg) || {
    //                         ok: true,
    //                         source_id: msg.id
    //                     };

    //                     output.worker_id = workerId;
    //                     output.source_id = msg.id;

    //                     if(mMonitors[workerId]) {
    //                         for (let i = 0, size = mGCSMessageListeners.length; i < size; ++i) {
    //                             mGCSMessageListeners[i].onMonitorMessage(workerId, {input: msg, output: output});
    //                         }
    //                     }
                        
    //                     return output;
    //                 } catch(ex) {
    //                     handleWorkerCallException(worker, ex);
    //                     return { 
    //                         ok: false, 
    //                         worker_id: workerId,
    //                         source_id: msg.id,
    //                         message: ex.message 
    //                     };
    //                 }
    //             } else {
    //                 return {
    //                     ok: false,
    //                     message: `Worker ${workerId} has no onGCSMessage() interface`,
    //                     worker_id: workerId,
    //                     source_id: msg.id
    //                 };
    //             }
    //         } else {
    //             return {
    //                 ok: false,
    //                 message: `Invalid worker at ${workerId}`,
    //                 worker_id: workerId,
    //                 source_id: msg.id
    //             };
    //         }
    //     } else {
    //         return {
    //             ok: false,
    //             message: `No worker called ${workerId}`,
    //             worker_id: workerId,
    //             source_id: msg.id
    //         };
    //     }
    // } else {
    //     return {
    //         ok: false,
    //         message: "FATAL: No workers",
    //         worker_id: workerId,
    //         source_id: msg.id
    //     };
    // }
}

function getWorkers() {
    const result = {
        workers: []
    };

    if(mWorkers) {
        for(let pid in mWorkers) {
            const worker = mWorkers[pid];
            
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

function getWorkerDetails(workerId) {
    const worker = findWorkerById(workerId);
    if(worker) {
        const val = worker.attributes;
        val.enabled = worker.enabled;
        return val;
    }

    return null;
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
    const worker = findWorkerById(workerId);
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

    setTimeout(function() {
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
    }, 5000);
}

function removeWorker(workerId, callback) {
    const worker = findWorkerById(workerId);
    if(worker && worker.child) {
        worker.child.send({id: "remove", msg: {}});
        callback.onComplete();
    } else {
        callback.onError(`Worker ${workerId} not found`);
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

    const workerIds = [];

    for(let pid in mWorkers) {
        const worker = mWorkers[pid];
        if(!worker) continue;
        if(!worker.attributes) continue;

        workerIds.push(worker.attributes);
    }

    for(let pid in mWorkers) {
        const worker = mWorkers[pid];
        if(!worker) continue;
        if(!worker.child) continue;

        worker.child.send({id: "worker_roster", msg: { roster: workerIds}});
    }
}

function getWorkerEnabledConfigFile() {
    return path.join(__dirname, "workers_enabled.json");
}

function saveWorkerEnabledStates() {
    const enablements = {};

    if (mWorkers) {
        for (let pid in mWorkers) {
            const worker = mWorkers[pid];
            if (worker) {
                enablements[worker.worker_id] = worker.enabled;
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
                    mWorkerEnabledStates = JSON.parse(data.toString());
                } catch(ex) {
                    log(`Error loading enabled state: ${ex.message}`);
                }
            });
        }
    });
}

function findWorkerById(workerId) {
    if (mWorkers) {
        for (let pid in mWorkers) {
            const val = mWorkers[pid];
            if (val.worker_id === workerId) {
                return val;
            }
        }
    }

    return null;
}

exports.start = start;
exports.stop = stop;
exports.running = running;
exports.reload = reload;
exports.addGCSMessageListener = addGCSMessageListener;
exports.removeGCSMessageListener = removeGCSMessageListener;
exports.monitorWorker = monitorWorker;
exports.handleGCSMessage = handleGCSMessage;
exports.handleScreenEnter = handleScreenEnter;
exports.handleScreenExit = handleScreenExit;
exports.imageDownload = imageDownload;
exports.handleWorkerDownload = handleWorkerDownload;
exports.getWorkers = getWorkers;
exports.getWorkerDetails = getWorkerDetails;
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
