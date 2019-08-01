'use strict';

const fs = require("fs");
const path = require("path");
const mavlink = require("./mavlink.js");

const LOOP_INTERVAL = 1000;

// Worker "app" module. Each worker that's loaded is run by this module as a forked process.
// All communication between this and the master is done via Node IPC mechanisms.
var mWorker = null;
var mWorkerAttributes = null;
var mWorkerId = null;
var mWorkerFile = null;
var mMavlinkNames = [];
var mWorkerRoster = null;
var mConfig = null;
var mWorkerLibraries = {};
var mLoopTimer = null;

const mWorkerListener = {
    /** Gets a Mavlink message from the specified worker, sends it to the Mavlink output */
    onMavlinkMessage: function (workerId, msg) {
        d("onMavlinkMessage(): workerId=" + workerId + " msg=" + msg);
        // Worker sent a Mavlink message. Forward to the parent process.
        process.send({ id: "worker_mavlink", msg: { worker_id: workerId, mavlinkMessage: msg } });
    },

    /** Gets a GCS message from the specified worker, broadcasts to all GCSMessageListeners. */
    sendGCSMessage: function (workerId, msg) {
        d(`GCS message from ${workerId}: ${msg.id}`);
        // Forward the message to the parent
        process.send({ id: "worker_gcs", msg: { worker_id: workerId, msg: msg } });
    },

    /** Gets a message from the specified worker, sends it to all other workers in the system */
    onBroadcastMessage: function (workerId, msg) {
        d("Broadcast message from " + workerId + ": " + msg);
        // Forward to parent
        process.send({ id: "worker_broadcast", msg: { worker_id: workerId, msg: msg } });
    },

    /** Called by a worker to get a list of the other workers on the system */
    getWorkerRoster: function (workerId) {
        return mWorkerRoster || [];
    },

    subscribeMavlinkMessages: function (workerId, messages) {
        d(`subscribeMavlinkMessages(): messages=${messages}`);

        mMavlinkNames = messages;

        d(`subscribeMavlinkMessages(): mMavlinkNames for ${mWorkerId}=${JSON.stringify(mMavlinkNames)}`);
    },

    workerLog: function (workerId, msg) {
        // Worker is logging via ATTRS.log(ATTRS.id): Forward to the parent process to handle logging.
        process.send({ id: "worker_log", msg: { worker_id: workerId, msg: msg } });
    },

    sendBroadcastRequest: function(msg) {
        d(`sendBroadcastRequest(${JSON.stringify(msg)})`);
        process.send({ id: "broadcast_request", msg: msg});
    },

    sendWorkerMessage: function(workerId, msg) {
        d(`sendWorkerMessage(${JSON.stringify(msg)})`);

        msg.worker_id = workerId;
        process.send({ id: "worker_message", msg: msg});
    }
};

const VERBOSE = false;
function d(str) {
    if(VERBOSE) console.log(`worker_app: ${str}`);
}

function log(str) {
    console.log(`worker_app: ${str}`);
}

function e(str) {
    console.log(`worker_app: ${str}`);
}

function loopCaller() {
    if(mWorker && mWorker.loop) {
        try {
            mWorker.loop();

            if(mWorkerAttributes.enabled) {
                mLoopTimer = setTimeout(loopCaller, LOOP_INTERVAL);
            }
            
        } catch(ex) {
            e(`Error running loop() in ${mWorkerId}: ${ex.message}`);
            clearTimeout(mLoopTimer);
        }
    }

    return false;
}

// Load a worker. msg.file is the file to load.
function loadWorker(msg) {
    // d(`loadWorker(): ${msg.file}`);

    const enabledStates = msg.enabledStates;
    const file = msg.file;
    if(!file) {
        loadAbort(100, { file: null, msg: `No file specified` });
        return;
    }

    mWorkerFile = file;

    try {
        // Load the specified worker.
        const worker = require(file);

        // const attrs = worker.getAttributes() || { name: "No name", looper: false };
        const attrs = (worker.getAttributes) ? worker.getAttributes(): null;
        if (!attrs) {
            loadAbort(100, { file: file, msg: `Worker has no attributes`});
            return;
        }

        if (!attrs.id) {
            loadAbort(100, { file: file, msg: `Worker ${attrs.id} in ${file} has no id, not loading`});
            return;
        }

        const workerId = attrs.id;
        let workerEnabled = true;

        if(enabledStates.hasOwnProperty(workerId)) {
            workerEnabled = enabledStates[workerId];
        }

        attachFunctionsTo(attrs);
        attachApisTo(attrs);
        attachConfigTo(attrs);

        attrs.path = path.dirname(file);

        const shell = {
            worker: worker,
            attributes: attrs,
            enabled: workerEnabled
        };

        // If this guy is looking for mavlink messages, index the messages by name for fast
        // lookup in onReceivedMavlinkMessage().
        if (attrs.mavlinkMessages) {

            mMavlinkNames = attrs.mavlinkMessages;
            d(`mMavlinkNames for ${attrs.id}=${JSON.stringify(mMavlinkNames)}`);
        }

        shell.cacheName = file;

        if(worker.onLoad) {
            try {
                mWorker = worker;
                mWorkerAttributes = attrs;
                mWorkerAttributes.enabled = shell.enabled;
                mWorkerId = workerId;
                worker.onLoad();

                // d(`Loaded worker ${mWorkerId}`);
                process.send({id: "worker_loaded", msg: { 
                    worker_id: workerId, 
                    file: file, 
                    pid: process.pid,
                    attributes: shell.attributes,
                    enabled: shell.enabled
                }});

                if(attrs.looper && workerEnabled) {
                    setTimeout(loopCaller, LOOP_INTERVAL);
                }

            } catch(ex) {
                loadAbort(100, { file: file, msg: `${workerId} onLoad(): ${ex.message}`, stack: ex.stack });
            }
        }
    } catch (ex) {
        loadAbort(100, { file: file, msg: `${workerId} onLoad(): ${ex.message}`, stack: ex.stack });
    }
}

function attachFunctionsTo(attrs) {
    attrs.sendMavlinkMessage = mWorkerListener.onMavlinkMessage;
    attrs.sendGCSMessage = mWorkerListener.sendGCSMessage;
    attrs.broadcastMessage = mWorkerListener.onBroadcastMessage;
    attrs.getWorkerRoster = mWorkerListener.getWorkerRoster;
    attrs.subscribeMavlinkMessages = mWorkerListener.subscribeMavlinkMessages;
    attrs.log = mWorkerListener.workerLog;
    attrs.sendBroadcastRequest = mWorkerListener.sendBroadcastRequest;
    attrs.sendWorkerMessage = mWorkerListener.sendWorkerMessage;
}

function attachApisTo(attrs) {
    attrs.api = {
        // unconditional loads here
        Mavlink: mavlink
    };

    for (let prop in mWorkerLibraries) {
        attrs.api[prop] = mWorkerLibraries[prop].module;
    }
}

function attachConfigTo(attrs) {
    if (mConfig) {
        attrs.sysid = mConfig.sysid;
        attrs.compid = mConfig.compid;
    } else {
        d(`No configuration`);
    }
}

// Unload: Called just before shutting this process down.
function unload(msg) {
    d(`unload(): msg=${JSON.stringify(msg)}`);
}

// Parent sent a mavlink message from input
function onMavlinkMessage(msg) {
    d(`onMavlinkMessage(${msg.name})`);

    if(mMavlinkNames.indexOf(msg.name) >= 0) {
        if(mWorker && mWorker.onMavlinkMessage) {
            // d(`Call ${mWorkerId} with ${msg.name}`);
            mWorker.onMavlinkMessage(msg);
        }
    }
}

function onGCSMessage(msg) {
    d(`onGCSMessage(${JSON.stringify(msg)})`);
    // Message for a worker. msg.worker_id and msg.msg are the attributes.
    const target = mWorker;

    if(target && target.onGCSMessage) {
        const response = target.onGCSMessage(msg.message) || { ok: true, source_id: msg.id };
        d(`response=${JSON.stringify(response)}`);
        process.send({id: "gcs_msg_response", msg: { worker_id: mWorkerId, request: msg.message, response: response }});
    }
}

function onWorkerRoster(msg) {
    mWorkerRoster = msg.roster;

    let handlesOnRosterChanged = false;

    if(mWorker && mWorker.onRosterChanged) {
        try {
            mWorker.onRosterChanged();
            handlesOnRosterChanged = true;
        } catch(ex) {
            e(ex.message);
        }
    }

    process.send({ id: "on_worker_roster_response", msg: { worker_id: mWorkerId, handles_roster_change: handlesOnRosterChanged }});
}

function onConfig(msg) {
    mConfig = msg.config;
}

function onReload(msg) {
    d(`onReload()`);

    if(mWorker && mWorkerFile) {
        d("unload");
        if(mWorker.onUnload) {
            try { mWorker.onUnload(); } catch(ex) { e(ex.message); }
        }

        d("un-cache");
        delete require.cache[require.resolve(mWorkerFile)];

        d("load");
        const worker = require(mWorkerFile);
        const attrs = worker.getAttributes();
        attachFunctionsTo(attrs);
        attachApisTo(attrs);
        attachConfigTo(attrs);

        if(worker.onLoad) {
            try {
                worker.onLoad();
                mWorker = worker;                
            } catch(ex) {
                e(ex.message);
            }
        }
    }
}

function onUnload(msg) {
    d("onUnload()");

    if(mLoopTimer) clearTimeout(mLoopTimer);

    let workerId = "unknown";

    if(mWorker && mWorker.onUnload) {
        try {
            workerId = mWorker.getAttributes().id;
            mWorker.onUnload();
        } catch(ex) {
            e(`Error in onUnload(): ${ex.message}`);
        }
    }

    log(`Shutting ${workerId} down`);
    process.exit(0);
}

function onRemove(msg) {
    d("onRemove()");

    if(mWorker) {
        if(mWorker && mWorker.onUnload) {
            mWorker.onUnload();
        } 

        if(mWorker.attributes) {
            const path = mWorker.attributes.path;

            const child = child_process.spawn(path.join(global.BIN_DIR, "remove_worker.sh"), [path]);
            const output = function (data) {
                log(data.toString());
            };

            child.stdout.on("data", output);
            child.stderr.on("data", output);

            child.on("close", function (rc) {
                log("script exited with return code " + rc);

                if (rc != 0) {
                    d(`remove_worker.sh exited with error ${rc}`);
                } else {
                    process.send({ id: "worker_removed", msg: { worker_id: mWorkerId } });
                }

                setTimeout(function() { process.exit(); }, 1000);
            });
        }
    }
}

function onLoadLibraries(msg) {
    const path = msg.path;

    if (path) {
        loadWorkerLibsIn(path);
    }
}

// msg.screen_name
function onScreenEnter(msg) {
    // d(`onScreenEnter(): screen_name=${msg.screen_name}`);

    const response = {screen_name: msg.screen_name, pid: process.pid};
    if(mWorker && mWorker.onScreenEnter) {
        const item = mWorker.onScreenEnter(msg.screen_name);
        if(item) response.data = item;
    }

    // ALWAYS send this response whether or not we have data
    process.send({ id: "screen_enter_response", msg: response });
}

function onScreenExit(msg) {
    const response = { screen_name: msg.screen_name, pid: process.pid };
    if (mWorker && mWorker.onScreenExit) {
        const item = mWorker.onScreenExit(msg.screen_name);
        if (item) response.data = item;
    }

    // ALWAYS send this response whether or not we have data
    process.send({ id: "screen_exit_response", msg: response });
}

function onImageRequest(msg) {
    d(`onImageRequest(${JSON.stringify(msg)})`);
    const name = msg.name;

    const response = { id: "image_response", msg: { worker_id: msg.worker_id, name: name }};

    if(mWorker && mWorker.onImageDownload) {
        try {
            const img = mWorker.onImageDownload(name);
            if (img) {
                response.msg.image = Buffer.from(img, 'binary').toString('base64');
            }
        } catch(ex) {
            e(`Exception getting image: ${ex.message}`);
        }
    }

    d(`send response ${JSON.stringify(response)}`);
    process.send(response);
}

function onContentRequest(msg) {
    // msg.worker_id, msg.content_id, msg.msg_id
    const response = { id: "content_response", msg: { 
        worker_id: msg.worker_id, 
        content_id: msg.content_id, 
        msg_id: msg.msg_id,
        mime_type: msg.mime_type,
        filename: msg.filename
    }};

    if(mWorker && mWorker.onContentDownload) {
        try {
            const content = mWorker.onContentDownload(msg.msg_id, msg.content_id);
            if (content) {
                response.msg.content = Buffer.from(content, 'binary').toString('base64');
            }
        } catch(ex) {
            e(ex.message);
            response.msg.error = ex.message;
        }
    }

    process.send(response);
}

function onFeatureRequest(msg) {
    const response = { id: "feature_response", msg: { pid: process.pid }};

    if(mWorker && mWorker.getFeatures) {
        try {
            const features = mWorker.getFeatures();
            if (features) {
                response.msg.features = features;
            }
        } catch(ex) {
            e(ex.message);
        }
    }

    process.send(response);
}

function onBroadcastRequest(msg) {
    // d(`onBroadcastRequest(${JSON.stringify(msg)})`);

    if(mWorker && mWorker.onBroadcastRequest) {
        try {
            const output = mWorker.onBroadcastRequest(msg);
            if(output) {
                const response = { id: "broadcast_response", msg: { request: msg, response: output } };
                process.send(response);
            }
        } catch(ex) { e(ex.message); }
    }
}

function onBroadcastResponse(msg) {
    // d(`onBroadcastResponse(${JSON.stringify(msg)})`);

    if(mWorker && mWorker.onBroadcastResponse) {
        try {
            mWorker.onBroadcastResponse(msg);
        } catch (ex) { e(ex.message); }
    }
}

// See if our worker is interested in a payload.
function onPayloadStart(payload) {
    d(`onPayloadStart(${JSON.stringify(payload)})`);

    if (mWorker && mWorker.onPayloadStart) {
        try {
            if (mWorker.onPayloadStart(payload)) {
                const workerId = mWorker.getAttributes().id;

                d(`Worker ${workerId} likes this payload`);
                process.send({
                    id: "on_payload_start_response",
                    msg: {
                        worker_id: workerId,
                        payload: payload
                    }
                });
            }
        } catch (ex) { e(ex.message); }
    }
}

/** Dispatch wants to know if the payload is alive */
function onPayloadPingRequest(msg) {
    d(`onPayloadPingRequest()`);

    if(mWorker) {
        const attrs = mWorker.getAttributes();
        const workerId = mWorker.getAttributes().id;
        const payload = msg.payload;

        d(`payload=${JSON.stringify(payload)}, attrs.payload_id=${attrs.payload_id}`);

        // If ours is the worker that deals with the specified payload
        d(`Ping ${workerId} for ${payload.payload_id} status`);

        if(attrs.payload_id === payload.payload_id) {
            if (mWorker.onPayloadPing) {
                try {
                    const result = mWorker.onPayloadPing(payload);

                    d(`Worker ${workerId} payload active? ${result}`);
                    process.send({
                        id: "on_payload_ping_response",
                        msg: {
                            active: result,
                            worker_id: workerId,
                            payload: payload
                        }
                    });
                } catch (ex) { e(ex.message); }
            }
        }
    }
}

function onPayloadStopRequest(msg) {
    log(`onPayloadStopRequest(${JSON.stringify(msg)})`);

    if (mWorker) {
        const attrs = mWorker.getAttributes();
        const workerId = mWorker.getAttributes().id;
        const payload = msg.payload;

        // If ours is the worker that deals with the specified payload
        log(`Stop ${workerId}/${payload.payload_id}`);

        if (attrs.payload_id === payload.payload_id) {
            if (mWorker.onPayloadStop) {
                try {
                    mWorker.onPayloadStop();

                    process.send({
                        id: "on_payload_stop_response",
                        msg: {
                            worker_id: workerId,
                            payload: payload
                        }
                    });
                } catch (ex) { e(ex.message); }
            }
        }
    }
}

function onWorkerEnable(msg) {
    d(`onWorkerEnable(${JSON.stringify(msg)})`);

    if(msg.enabled) {
        if(mWorkerAttributes.looper) {
            mLoopTimer = setTimeout(loopCaller, LOOP_INTERVAL);
        }
    } else {
        if(mLoopTimer) clearTimeout(mLoopTimer);
    }

    mWorkerAttributes.enabled = msg.enabled;
}

// Messages sent by the parent process
const mFunctionMap = {
    "load_worker": loadWorker,
    "mavlink_msg": onMavlinkMessage,
    "gcs_msg": onGCSMessage,
    "worker_roster": onWorkerRoster,
    "config": onConfig,
    "reload": onReload,
    "unload": onUnload,
    "remove": onRemove,
    "load_libraries": onLoadLibraries,
    "screen_enter": onScreenEnter,
    "screen_exit": onScreenExit,
    "image_request": onImageRequest,
    "content_request": onContentRequest,
    "feature_request": onFeatureRequest,
    "broadcast_request": onBroadcastRequest,
    "broadcast_response": onBroadcastResponse,
    "worker_enable": onWorkerEnable,
    "on_payload_start": onPayloadStart,
    "on_payload_ping": onPayloadPingRequest,
    "on_payload_stop": onPayloadStopRequest
};

// Incoming messages from the parent process
process.on("message", function (msg) {
    // d(`${process.pid} got ${JSON.stringify(msg)}`);

    const func = mFunctionMap[msg.id];
    if (func) {
        func(msg.msg);
    } else {
        d(`Unknown message: ${JSON.stringify(msg)}`);
    }
});

function loadAbort(code, msg) {
    if(msg) {
        if(!msg.stack) msg.stack = "(none)";
        if(!msg.file) msg.file = mWorkerFile;
        if(!msg.msg) msg.msg = "(unknown)";

        process.send({ id: "load_abort", msg: msg});
    }

    process.exit(code);
}

function loadWorkerLibsIn(dir) {
    // d(`loadWorkerLibsIn(${dir})`);

    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.map(function (file) {
        const filename = path.join(dir, file);
        const prop = path.basename(file, path.extname(file));

        try {
            // d(`load library module: ${filename}`);
            const module = require(filename);

            const lib = {
                module: module,
                cacheName: filename
            };

            if (!mWorkerLibraries) {
                mWorkerLibraries = {};
            }

            mWorkerLibraries[prop] = lib;
        } catch (ex) {
            console.log(`load library module error - ${filename}: ${ex.message}`);
            mWorkerLibraries[prop] = {
                error: ex.message
            };
        }
    });
}
