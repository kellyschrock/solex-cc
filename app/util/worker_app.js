'use strict';

const fs = require("fs");
const path = require("path");
const mavlink = require("./mavlink.js");

// Worker "app" module. Each worker that's loaded is run by this module as a forked process.
// All communication between this and the master is done via Node IPC mechanisms.
var mWorker = null;
var mWorkerId = null;
var mMavlinkLookup = {};
var mWorkerRoster = null;
var mConfig = null;
var mWorkerLibraries = {};

function d(str) {
    console.log(`worker_app: ${str}`);
}

// Load a worker. msg.file is the file to load.
function loadWorker(msg) {
    // d(`loadWorker(): ${msg.file}`);

    const file = msg.file;
    if(!file) {
        loadAbort(100, { file: null, msg: `No file specified` });
        return;
    }

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
            loadAbort(100, { file: file, msg: `Worker ${attrs.name} in ${file} has no id, not loading`});
            return;
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

        // packages.map(function (pk) {
        //     const dirname = path.dirname(pk.file);
        //     if (files[i].indexOf(dirname) >= 0) {
        //         attrs.parent_package = pk.parent_package;
        //     }
        // });

        attrs.api = {
            // unconditional loads here
            Mavlink: mavlink
        };

        for (let prop in mWorkerLibraries) {
            attrs.api[prop] = mWorkerLibraries[prop].module;
        }

        if(mConfig) {
            attrs.sysid = mConfig.sysid;
            attrs.compid = mConfig.compid;
        } else {
            d(`No configuration`);
        }

        attrs.path = path.dirname(file);

        const shell = {
            worker: worker,
            attributes: attrs,
            enabled: true
        };

        // If this guy is looking for mavlink messages, index the messages by name for fast
        // lookup in onReceivedMavlinkMessage().
        if (attrs.mavlinkMessages) {

            mMavlinkLookup = {};
            for (let x = 0, sz = attrs.mavlinkMessages.length; x < sz; ++x) {
                const name = attrs.mavlinkMessages[x];
                mMavlinkLookup[name] = name;
            }
        }

        shell.cacheName = file;

        if(worker.onLoad) {
            try {
                worker.onLoad();
                mWorker = worker;
                mWorkerId = workerId;

                // d(`Loaded worker ${mWorkerId}`);
                process.send({id: "worker_loaded", msg: { 
                    worker_id: workerId, 
                    file: file, 
                    pid: process.pid,
                    attributes: shell.attributes,
                    enabled: shell.enabled
                }});

            } catch(ex) {
                loadAbort(100, `Worker ${workerId} onLoad() failure: ${ex.message}`);
            }
        }
    } catch (ex) {
        loadAbort(100, `Error loading worker at ${file}: ${ex.message}`);
    }
}

// Unload: Called just before shutting this process down.
function unload(msg) {
    d(`unload(): msg=${JSON.stringify(msg)}`);
}

// Parent sent a mavlink message from input
function onMavlinkMessage(msg) {
    if(mMavlinkLookup[msg.name]) {
        if(mWorker && mWorker.onMavlinkMessage) {
            mWorker.onMavlinkMessage(msg);
        }
    }
}

function onGCSMessage(msg) {
    d(`onGCSMessage()`);
    // Message for a worker. msg.worker_id and msg.msg are the attributes.
    const target = mWorker;
    d(`target=${target}`);

    if(target && target.onGCSMessage) {
        const response = target.onGCSMessage(msg.message) || { ok: true, source_id: msg.id };
        d(`response=${response}`);
        process.send({id: "gcs_msg_response", msg: { worker_id: mWorkerId, request: msg.message, response: response }});
    }
}

function onWorkerRoster(msg) {
    // msg.roster
    mWorkerRoster = msg.roster;
}

function onConfig(msg) {
    mConfig = msg.config;
}

function onReload(msg) {
    d(`onReload()`);
    // TODO: Reload the worker
}

function onUnload(msg) {
    d("onUnload()");
    if(mWorker && mWorker.onUnload) {
        try {
            mWorker.onUnload();
        } catch(ex) {
            d(`Error in onUnload(): ${ex.message}`);
        }
    }

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

                setTimeout(function() { process.exit(0); }, 1000);
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
    const name = msg.name;

    const response = { id: "image_response", msg: { worker_id: msg.worker_id, name: name }};

    if(mWorker && mWorker.onImageDownload) {
        try {
            const img = mWorker.onImageDownload(name);
            if (img) {
                response.msg.image = Buffer.from(img, 'binary').toString('base64');
            }
        } catch(ex) {
            d(`Exception getting image: ${ex.message}`);
        }
    }

    process.send(response);
}

// Messages sent by the parent process
const mFunctionMap = {
    "load_worker": loadWorker,
    "unload": unload,
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
    "image_request": onImageRequest
};

// Incoming messages from the parent process
process.on("message", function (msg) {
    // d(`${process.pid} got ${JSON.stringify(msg)}`);

    const func = mFunctionMap[msg.id];
    if (func) {
        func(msg.msg);
    } else {
        d(`Unknown message ${msg.id}`);
    }
});

// d(`${process.pid} starting up`);

const mWorkerListener = {
    /** Gets a Mavlink message from the specified worker, sends it to the Mavlink output */
    onMavlinkMessage: function (workerId, msg) {
        d("onMavlinkMessage(): workerId=" + workerId + " msg=" + msg);
        // Worker sent a Mavlink message. Forward to the parent process.
        process.send({ id: "worker_mavlink", msg: {worker_id: workerId, mavlinkMessage: msg }});
    },

    /** Gets a GCS message from the specified worker, broadcasts to all GCSMessageListeners. */
    onGCSMessage: function (workerId, msg) {
        d(`GCS message from ${workerId}: ${msg.id}`);
        // Forward the message to the parent
        process.send({ id: "worker_gcs", msg: { worker_id: workerId, msg: msg}});
    },

    /** Gets a message from the specified worker, sends it to all other workers in the system */
    onBroadcastMessage: function (workerId, msg) {
        d("Broadcast message from " + workerId + ": " + msg);
        // Forward to parent
        process.send({ id: "worker_broadcast", msg: { worker_id: workerId, msg: msg}});
    },

    /** Called by a worker to get a list of the other workers on the system */
    getWorkerRoster: function (workerId) {
        return mWorkerRoster || [];
    },

    subscribeMavlinkMessages: function (workerId, messages) {
        mMavlinkLookup = {};
        for(let i = 0, size = messages.size; i < size; ++i) {
            const name = messages[i];
            mMavlinkLookup[name] = name;
        }
    },

    findWorkerById: function (workerId) {
        var result = null;

        if(mWorkerRoster) {
            for(let i = 0, size = mWorkerRoster.length; i < size; ++i) {
                const worker = mWorkerRoster[i];
                if(worker.attributes && worker.attributes.id === workerId) {
                    result = worker;
                    break;
                }
            }
        }

        return result;
    },

    findWorkersInPackage: function (packageId) {
        const out = [];

        if(mWorkerRoster) {
            for(let i = 0, size = mWorkerRoster.length; i < size; ++i) {
                const worker = mWorkerRoster[i];
                const attrs  = worker.attributes;
                if (attrs && attrs.parent_package && attrs.parent_package.id === packageId) {
                    out.push(worker.worker);
                }
            }
        }

        return out;
    },

    workerLog: function (workerId, msg) {
        // Worker is logging via ATTRS.log(ATTRS.id): Forward to the parent process to handle logging.
        process.send({id: "worker_log", msg: { worker_id: workerId, msg: msg}});
    }
};

function loadAbort(code, msg) {
    if(msg) {
        process.send({ id: "load_abort", msg: {msg: msg}});
    }

    process.exit(code);
}

function loadWorkerLibsIn(dir) {
    d(`loadWorkerLibsIn(${dir})`);

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
            d(`load library module error - ${filename}: ${ex.message}`);
            mWorkerLibraries[prop] = {
                error: ex.message
            };
        }
    });
}
