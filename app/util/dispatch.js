'use strict';

const path = require("path");
const fs = require("fs");
const udpclient = require("../server/udpclient");
const SerialPort = require("serialport");
const logger = require("./logger");
const child_process = require("child_process");
const mavlink_shell = require("./mavlink_shell");
const VehicleTopics = require("../topic/VehicleTopics");

require("jspack");

let udpServer = null;

const VERBOSE = global.logVerbose || false;

// Config
const mConfig = {
    loopTime: 1000,
    sysid: 221,
    compid: 101,
    udp: { port: 14550},
    serial: {
        port: "/dev/ttyS0",
        baud_rate: 921600
    },
    logWorkers: [],
    workerRoots: [],
    heartbeats: {send: false}
};

const mWorkerConfig = {};
let mConfigChangeCallback = null;

var mSerialPort = null;

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
// Screen-enter requests
const mScreenEnterRequests = {};
// Screen-exit requests
const mScreenExitRequests = {};
// Image requests
const mImageRequests = {};
// Content requests
const mContentRequests = {};
// Feature request
const mFeatureRequest = {};
// Active payload
var mActivePayload = null;
// Generalized callbacks
const mResponseCallbacks = {
    get_worker_config: {},
    set_worker_config: {}
};
// Heartbeats
const HEARTBEAT_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = 5000;
var mHeartbeatTimer = null;
var mHeartbeatTimeout = null;

const mBuffers = [];
let mCurrBuffer = null;

const mUDPCallback = {
    onData: function(packet) {
        // d(`UDP server got data: ${packet}`);

        // Got a message from the UDP client. Push it to the serial port.
        if(mSerialPort) {
            mSerialPort.write(packet, function (err) {
                if (err) {
                    d(`Error writing to serial port: ${err}`);
                }
            });
        }
    },

    onListening: function() {
        d(`UDP server listening`);
    },

    onError: function(err) {
        d(`UDP server error: ${ex.message}`);
    },

    onClose: function() {
        d(`UDP server closed`);
    }
};

const mConnectionCallback = {
    onOpen: function (port) {
        // Connection opened
        d("onOpen()");

        mavlink_shell.onOpen(mConfig.sysid, mConfig.compid, onReceivedMavlinkMessage);

        if(mConfig.heartbeats && mConfig.heartbeats.send) {
            startSendingHeartbeats();
        } else {
            mHeartbeatTimer = null;
        }
    },

    onData: function (buffer) {
        // The mavlink parser is dumb AF. Collect buffers into buffers that
        // start with the protocol marker before passing them to it.
        for (const b of buffer) {
            if (mavlink_shell.isProtocolMarker(b)) {
                if (mCurrBuffer) {
                    mBuffers.push(mCurrBuffer);
                }

                mCurrBuffer = [b];
            } else {
                if (mCurrBuffer) {
                    mCurrBuffer.push(b);
                }
            }
        }

        for (const buf of mBuffers) {
            mavlink_shell.parseBuffer(Buffer.from(buf));
        }

        mBuffers.splice(0, mBuffers.length);

        if(mSerialPort) {
            // This came from the serial port. Send it to UDP
            if(udpServer) {
                udpServer.sendMessage(buffer);
            }
        }
    },

    onClose: function () {
        // Connection closed
        trace("onClose()");
        mavlink_shell.onClose();

        stopSendingHeartbeats();
    },

    onError: function (err) {
        trace("onError(): " + err);
    }
};

function log(s) { logger.v(path.basename(__filename, ".js"), s); }
function d(s) { if(VERBOSE) log(s); }
function v(str) { if (VERBOSE) log(str); }
function trace(s) { if (global.TRACE) { logger.v(__filename + "(trace)", s); } }

function e(s, err) { 
    log(`${path.basename(__filename, ".js")}: ${s} - ${err && err.message || s}`);

    if(err) {
        console.trace();
    } 
}

const PAYLOAD_PING_INTERVAL = 10000;
var mPayloadPing = null;

function payloadPing() {
    const workerId = (mActivePayload)? mActivePayload.worker_id: null;

    if(workerId) {
        log(`Ping ${workerId} for payload status`);

        const worker = findWorkerById(workerId);
        if(worker && worker.child) {
            worker.child.send({ id: "on_payload_ping", msg: {
                payload: mActivePayload.payload
            } });
        }
    }
}

function findFiles(dir, filter) {
    var out = [];

    if(!fs.existsSync(dir)) {
        log(dir + " not found");
        return out;
    }

    const files = fs.readdirSync(dir);
    
    let manifest = null;

    files.map((file) => {
        let filename = path.join(dir, file);
        let stat = fs.lstatSync(filename);

        if (stat.isSymbolicLink()) {
            const rp = fs.realpathSync(filename);
            d(`Resolve ${filename} symlink to ${rp}`);
            filename = rp;
            stat = fs.lstatSync(filename);
        }

        if (stat.isDirectory()) {
            const children = findFiles(filename, filter);
            if (children) {
                children.map(function (child) {
                    out.push(child);
                });
            }
        } else {
            // log(`filename=${filename}`);

            if (filter) {
                const basename = path.basename(filename)
                // if (filename.indexOf(filter) >= 0) {
                if (basename == filter) {
                    out.push(filename);
                    log(`found ${filename}`);
                }
            } else {
                // log(`found ${filename}`);
            }
        }
    });

    return out;
}

function isVehicleType(type) {
    switch(type) {
        case mavlink.MAV_TYPE_ANTENNA_TRACKER:
        case mavlink.MAV_TYPE_GCS:
        case mavlink.MAV_TYPE_ONBOARD_CONTROLLER:
        case mavlink.MAV_TYPE_GIMBAL:
        case mavlink.MAV_TYPE_ADSB:
        case mavlink.MAV_TYPE_CAMERA:
        case mavlink.MAV_TYPE_CHARGING_STATION:
        case mavlink.MAV_TYPE_FLARM:
        case mavlink.MAV_TYPE_SERVO:
            return false;
        default:
            return true;
    }
}

function onReceivedMavlinkMessage(msg) {
    // log(`onReceivedMavlinkMessage(${JSON.stringify(msg)})`);
    // d(`onReceivedMavlinkMessage(${msg.name})`);

    if(!msg.name) {
        return log(JSON.stringify(msg));
    }

    VehicleTopics.onMavlinkMessage(msg);

    switch(msg.name) {
        case "HEARTBEAT": {
            if(isVehicleType(msg.type) && msg.header) {
                mConfig.sysid = msg.header.srcSystem;
                mConfig.compid = msg.header.srcComponent;
                VehicleTopics.setSysIdCompId(mConfig.sysid, mConfig.compid);
            }

            if(mConfig.heartbeats.send) {
                // In case we timed out earlier and are now getting heartbeats again
                if(mHeartbeatTimer == null) {
                    d(`Restarting heartbeats`);
                    startSendingHeartbeats();
                }

                // Reset the HB timeout
                clearTimeout(mHeartbeatTimeout);
                mHeartbeatTimeout = setTimeout(function () {
                    d(`Heartbeat timed out, stopping heartbeat sender`);
                    stopSendingHeartbeats();
                }, HEARTBEAT_TIMEOUT);
            }

            break;
        }
    }

    for(let pid in mWorkers) {
        const worker = mWorkers[pid];
        if(worker && worker.child && worker.enabled) {
            worker.child.send({id: "mavlink_msg", msg: msg});
        }
    }
}

VehicleTopics.setMavlinkSendCallback((msg) => {
    if (!msg) return e(`No message to send`);

    // log(`send from VehicleTopics: ${msg.name}`);

    try {
        const packet = mavlink_shell.pack(msg);
        if (packet) {
            if (udpclient.isConnected()) {
                udpclient.sendMessage(packet);
            } else if (mSerialPort) {
                mSerialPort.write(packet, function (err) {
                    if (err) {
                        e(`Error writing to serial port: ${err}`);
                    }
                });
            } else {
                e("No connection to send data on");
            }
        } else {
            e(`No packet made for ${msg.name}`);
        }
    } catch (ex) {
        e(`send mavlink: ${ex.message}`, ex);
    }
});


//
// Public interface
//
function start() {
    d(`start(): ${JSON.stringify(mConfig)}`);

    if(mConfig.udp) {
        d("connect udp");

        const port = mConfig.udp.port;
        udpclient.connect({
            udp_port: port
        }, mConnectionCallback);
    } else if(mConfig.serial) {
        d("connect serial");

        const serial = mConfig.serial;

        const port = new SerialPort(serial.port, {
            autoOpen: false,
            lock: false,
            baudRate: serial.baud_rate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            rtscts: false,
            xon: false,
            xoff: false,
            xany: false,
            bufferSize: 1024 * 4,
        });

        // If set up with a udp_relay, check that too
        if(serial.udp_relay) {
            d("Set up UDP relay");

            const relay = serial.udp_relay;
            if(relay.port) {
                d(`Set up UDP relay on ${relay.port}`);

                udpServer = require("./udpserver.js");
                udpServer.start({port: relay.port}, mUDPCallback);
            } else {
                d("No UDP relay port specified in udp_relay");

                udpServer = null;
            }
        }

        port.on("open", function() {
            d("on serial port open");

            mSerialPort = port;
            mConnectionCallback.onOpen();
        });

        port.on("error", mConnectionCallback.onError);
        port.on("data", mConnectionCallback.onData);

        port.open();
    }
}

function stop() {
    if(udpclient.isConnected()) {
        try {
            udpclient.disconnect(mConnectionCallback);
        } catch (ex) {
            e("Closing UDP", ex);
        }
    } else if(mSerialPort && mSerialPort.isOpen) {
        // Serial
        try {
            mSerialPort.close();
        } catch(ex) {
            console.error(ex.message);
            console.stack();
        }
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

function shutdown() {
    unloadWorkers();
}

let mLoadCompleteCallback = null;

exports.setLoadCompleteCallback = (cb) => {
    mLoadCompleteCallback = cb;
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

        setTimeout(function () { notifyRosterChanged(); }, 2000);
    }

    v(mWorkers);

    if(mLoadCompleteCallback) {
        setTimeout(mLoadCompleteCallback, (Object.keys(mWorkers).length * 2000));
    }
}

function mavlinkMessageFor(msg) {
    // d(`mavlinkMessageFor(): ${JSON.stringify(msg)}`);

    if(!msg.name) return null;

    const lc = msg.name.toLowerCase();
    const ctor = mavlink.messages[lc];

    if(!ctor) return null;

    // d(`ctor: ${ctor}`);

    let fakeMessage = false;
    if(!msg.fieldnames) {
        fakeMessage = true;
        // log(`Try to make a mavlink message out of ${JSON.stringify(msg)}`);
        msg.fieldnames = [];

        for(let prop in msg) {
            if(prop !== "header") {
                msg.fieldnames.push(msg[prop]);
            }
        }
    }


    const args = [];
    msg.fieldnames.map(function(field) {
        args.push(msg[field]);
    });

    // d(`args=${JSON.stringify(args)}`);

    const output = Reflect.construct(ctor, args);

    // d(`output=${JSON.stringify(output)}`);

    return output;
}

function setupWorkerCallbacks(child) {
    const childProcMap = {
        "worker_loaded": onWorkerLoaded,
        "load_abort": onWorkerLoadAbort,
        "worker_log": onWorkerLog,
        "worker_removed": onWorkerRemoved,
        "worker_mavlink": sendWorkerMavlinkToVehicle,
        "worker_gcs": sendWorkerMessageToGCS,
        "worker_message": sendGCSMessageToWorker,
        "gcs_msg_response": onGCSMessageResponse,
        "worker_broadcast": onWorkerBroadcast,
        "screen_enter_response": onScreenEnterResponse,
        "screen_exit_response": onScreenExitResponse,
        "image_response": onImageResponse,
        "content_response": onContentResponse,
        "feature_response": onFeatureResponse,
        "broadcast_request": onBroadcastRequest,
        "broadcast_response": onBroadcastResponse,
        "on_payload_start_response": onPayloadStartResponse,
        "on_payload_ping_response": onPayloadPingResponse,
        "on_payload_stop_response": onPayloadStopResponse,
        "on_worker_roster_response": onWorkerRosterResponse,
        "on_worker_get_config_response": onGetWorkerConfigResponse,
        "on_worker_set_config_response": onSetWorkerConfigResponse
    };

    // Finished loading a worker.
    function onWorkerLoaded(msg) {
        // msg.pid, msg.worker_id, msg.file
        // log(`workerLoaded(): ${JSON.stringify(msg)}`);
        d(`workerLoaded(): ${msg.worker_id}`);

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
    function onWorkerRemoved(msg) {
        const worker = findWorkerById(msg.worker_id);
        if(worker && worker.child) {
            delete mWorkers[worker.child.pid];
            delete mQueuedCallbacks[worker.child.pid];
        }
    }

    function onFeatureResponse(msg) {
        // msg: { pid: process.pid, features: {} };

        const req = mFeatureRequest;
        if (req) {
            d(`req=${JSON.stringify(req)}`);

            if(!req.responses) req.responses = [];

            if(msg.features) {
                req.responses.push(msg.features);
            }

            req.pids.splice(req.pids.indexOf(msg.pid), 1);

            if(req.pids.length === 0) {
                d(`Got all feature responses`);

                const output = {};

                req.responses.map(function(features) {
                    if(!features) return;

                    for(let prop in features) {
                        // A given feature from a worker overwrites any existing features in the output, so they must be unique!
                        output[prop] = features[prop];
                    }
                });

                d(`onFeatureResponse(): features=${JSON.stringify(output)}`);

                if (req.callback) req.callback(null, output);
            }
        } else {
            d(`WTF! No request`);
        }
    }

    function onBroadcastRequest(msg) {
        // d(`broadcastRequest(${JSON.stringify(msg)})`);

        // Send this message out to all workers
        for(let pid in mWorkers) {
            const worker = mWorkers[pid];
            if(!worker) continue;
            if(!worker.child) continue;
            if(!worker.enabled) continue;

            worker.child.send({id: "broadcast_request", msg: msg});
        }
    }

    function onBroadcastResponse(msg) {
        // d(`broadcastResponse(${JSON.stringify(msg)})`);

        for (let pid in mWorkers) {
            const worker = mWorkers[pid];
            if (!worker) continue;
            if (!worker.child) continue;
            if (!worker.enabled) continue;

            worker.child.send({ id: "broadcast_response", msg: msg });
        }
    }

    function onPayloadStartResponse(msg) {
        d(`onPayloadStartResponse(${JSON.stringify(msg)})`);

        if(mPayloadPing) {
            clearTimeout(mPayloadPing);
        }

        mActivePayload = msg;

        if(mActivePayload) {
            // Notify that we need to update features.
            notifyRosterChanged();

            sendWorkerMessageToGCS({
                worker_id: "payload_manager",
                msg: {
                    id: "payload_start", payload: msg.payload
                }
            });

            mPayloadPing = setTimeout(payloadPing, PAYLOAD_PING_INTERVAL);
        } else if(mPayloadPing) {
            clearTimeout(mPayloadPing);
            mPayloadPing = null;
        }
    }

    function onPayloadPingResponse(msg) {
        const payload = msg.payload;

        if(payload) {
            if(msg.active) {
                d(`Payload ${payload.payload_id} is active`);
                mPayloadPing = setTimeout(payloadPing, PAYLOAD_PING_INTERVAL);
            } else {
                log("Payload didn't respond to ping. Might be unplugged");

                // Tell the worker to stop pinging the payload if it's doing that.
                const worker = findWorkerById(mActivePayload.worker_id);
                if (worker && worker.child) {
                    worker.child.send({ id: "on_payload_stop", msg: mActivePayload });
                }

                // Payload hasn't responded to ping. Might have been turned off or unplugged.
                // Send a GCS notification that the payload has departed.
                sendWorkerMessageToGCS({
                    worker_id: "payload_manager",
                    msg: {
                        id: "payload_stop", payload: mActivePayload.payload
                    }
                });

                mActivePayload = null;

                if(mPayloadPing) {
                    clearTimeout(mPayloadPing);
                    mPayloadPing = null;
                }
            }
        }
    }

    function onPayloadStopResponse(msg) {
        // No action to take here, really. We asked the payload to stop, and it did.
        log(`Got stop response from ${msg.worker_id} for payload ${msg.payload.payload_id}`);
    }

    function onWorkerRosterResponse(msg) {
        d(`onWorkerRosterResponse(): ${JSON.stringify(msg)}`);
    }

    function onGetWorkerConfigResponse(msg) {
        d(`onGetWorkerConfigResponse(): ${JSON.stringify(msg)}`);

        const cb = mResponseCallbacks.get_worker_config[msg.worker_id];
        d(`cb=${cb}`);
        if(cb && cb.callback) {
            cb.callback(msg.msg);
        }
        delete mResponseCallbacks.get_worker_config[msg.worker_id];
    }

    function onSetWorkerConfigResponse(msg) {
        d(`onSetWorkerConfigResponse(): ${JSON.stringify(msg)}`);
        const cb = mResponseCallbacks.set_worker_config[msg.worker_id];
        if(cb && cb.callback) {
            cb.callback(msg.msg);
        }
        delete mResponseCallbacks.set_worker_config[msg.worker_id];
    }

    // Handle screen-enter responses from workers
    function onScreenEnterResponse(msg) {
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
    function onScreenExitResponse(msg) {
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

    // Worker sent image data
    function onImageResponse(msg) {
        d(`imageResponse(): workerId=${msg.worker_id}`);
        const req = (mImageRequests[msg.worker_id])? mImageRequests[msg.worker_id][msg.name]: null;

        if(req) {
            if(msg.image) {
                if(req.res) {
                    const buf = Buffer.from(msg.image, 'base64');
                    if(buf) {
                        req.res.status(200).end(buf, "binary");
                    } else {
                        req.res.status(404).json({message: `image for ${msg.worker_id}/${msg.name} not found`});
                    }
                } else {
                    d(`WTF! No response object to use`);
                }
            } else {
                req.res.status(404).json({ message: `image for ${msg.worker_id}/${msg.name} not found` });
            }

            delete mImageRequests[msg.worker_id];
        } else {
            d(`WTF! No request`);
        }
    }

    function onContentResponse(msg) {
        // msg: { worker_id: msg.worker_id, content_id: msg.content_id, msg_id: msg.msg_id, content: (base64) }
        d(`onContentResponse(${JSON.stringify(msg)})`);

        const req = mContentRequests[msg.worker_id][msg.content_id];

        if (req) {
            if (msg.content) {
                if (req.res) {
                    const buf = Buffer.from(msg.content, 'base64');
                    if (buf) {
                        if(msg.filename) {
                            req.res.setHeader("Content-Disposition", "attachment; filename=" + msg.filename);
                        }

                        if(msg.mime_type) {
                            req.res.setHeader("Content-Type", msg.mime_type);
                        }

                        req.res.status(200).end(buf, "binary");
                    } else {
                        req.res.status(404).json({ message: `image for ${msg.worker_id}/${msg.content_id} not found` });
                    }
                } else {
                    d(`WTF! No response object to use`);
                }
            } else {
                req.res.status(404).json({ message: `content for ${msg.worker_id}/${msg.content_id} not found` });
            }

            delete mContentRequests[msg.worker_id][msg.content_id];
            if(Object.keys(mContentRequests[msg.worker_id]).length == 0) {
                delete mContentRequests[msg.worker_id];
            }
        } else {
            d(`WTF! No request`);
        }
    }

    // Aborted loading a worker. msg.file is the file that wasn't loaded.
    function onWorkerLoadAbort(msg) {
        d(`onWorkerLoadAbort(): ${JSON.stringify(msg)}`);
        // log(`Failed to load worker in ${msg.file}: ${msg.msg}`);
        mWorkerLoadErrors.push({ path: msg.file, error: msg.msg, detail: msg.stack });
    }

    // Worker logged a message.
    function onWorkerLog(msg) {
        // msg.worker_id, msg.msg (text to log)
        const filter = mConfig.logWorkers || [];
        const workerId = msg.worker_id || "";
        
        if (filter.length === 0 || filter.indexOf(workerId) >= 0) {
            console.log(`${msg.worker_id}: ${msg.msg}`);

            for (let i = 0, size = mGCSMessageListeners.length; i < size; ++i) {
                mGCSMessageListeners[i].onLogMessage(msg.worker_id, msg.msg);
            }
        }
    }

    // Worker sent a mavlink message.
    function sendWorkerMavlinkToVehicle(msg) {
        // msg.worker_id, msg.mavlinkMessage
        if (msg.mavlinkMessage) {
            const mav = mavlinkMessageFor(msg.mavlinkMessage);

            if(mav) {
                const packet = mavlink_shell.pack(mav);

                if(packet) {
                    if (udpclient.isConnected()) {
                        udpclient.sendMessage(packet);
                    } else if (mSerialPort) {
                        mSerialPort.write(packet, function (err) {
                            if (err) {
                                d(`Error writing to serial port: ${err}`);
                            }
                        });
                    } else {
                        e("No connection to send data on");
                    }
                } else {
                    e(`No packet made for ${mav.name}`);
                }
            } else {
                e(`No mavlink message found for ${msg.mavlinkMessage.name}`);
            }
        } else {
            e("WARNING: No message");
        }
    }

    // Worker sent a GCS message.
    function sendWorkerMessageToGCS(msg) {
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

    function sendGCSMessageToWorker(msg) {
        const worker = findWorkerById(msg.worker_id);
        if(worker && worker.enabled && worker.child) {
            worker.child.send({ id: "gcs_msg", msg: { message: msg } });
        }
    }

    // Worker responded to a GCS message.
    function onGCSMessageResponse(msg) {
        d(`onGCSMessageResponse(${JSON.stringify(msg)})`);

        if(mQueuedCallbacks[child.pid]) {
            d(`have callbacks for ${child.pid}`);

            const workerId = msg.worker_id;

            if(mQueuedCallbacks[child.pid][workerId]) {
                d(`have callbacks for ${workerId}`);

                if(mQueuedCallbacks[child.pid][workerId][msg.request.id]) {
                    d(`have callback for ${msg.request.id}`);

                    if(!msg.response) { 
                        msg.response = {}; 
                    }

                    const result = {
                        message: msg.response.message || msg.request.id,
                        source_id: msg.request.id,
                        worker_id: workerId,
                        content: msg.response,
                        ok: msg.response.ok
                    };

                    // Cover cases where a worker didn't include an "ok" property
                    // in the response. Assume ok unless otherwise specified, etc
                    if(!result.hasOwnProperty("ok")) {
                        result.ok = true;
                    }

                    // mQueuedCallbacks[child.pid][workerId][msg.request.id](null, msg.response);
                    mQueuedCallbacks[child.pid][workerId][msg.request.id](null, result);
                    delete mQueuedCallbacks[child.pid][workerId][msg.request.id];

                    if(mMonitors[workerId]) {
                        mGCSMessageListeners.map(function(listener) {
                            try {
                                listener.onMonitorMessage(workerId, { input: msg.request, output: msg.response });
                            } catch(ex) {
                                e(`Error sending monitor message for ${workerId}: ${ex.message}`);
                            }
                        });
                    }
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
    function onWorkerBroadcast(msg) {
        // function d(str) { console.log(`dispatch: ${str}`)}

        d(`onWorkerBroadcast(): msg=${JSON.stringify(msg)}`);

        const sender_worker_id = msg.worker_id;

        if (mWorkers) {
            for (let pid in mWorkers) {
                const worker = mWorkers[pid];

                if(worker && worker.child && msg.message && worker.worker_id !== sender_worker_id) {
                    d(`send to ${worker.worker_id}`);
                    worker.child.send({id: "gcs_msg", msg: { worker_id: worker.worker_id, message: msg.message}});
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
            d(`No mapping for child message ${msg.id}`);
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
        d("No basedir, not reloading");
        return;
    }

    const files = findFiles(basedir, "worker.js");

    const manifests = findFiles(basedir, "manifest.json");
    const packages = [];

    manifests.map(function(manifest) {
        d(`manifest: ${JSON.stringify(manifest)}`);
        try {
            const jo = JSON.parse(fs.readFileSync(manifest));
            d(`manifest info: ${JSON.stringify(jo)}`);

            jo.path = path.dirname(manifest);
            packages.push({ file: manifest, parent_package: jo });
        } catch(ex) {
            e("Parsing manifest", ex);
        }
    });

    d(`manifests=${manifests}`);

    let added = 0;
    for(let i = 0, size = files.length; i < size; ++i) {
        try {
            // Start a sub-process and tell it to load the specified worker.
            const child = child_process.fork(path.join(__dirname, "worker_app.js"), [files[i]]);
            // d(`Started ${child.pid}`);

            setupWorkerCallbacks(child);

            mWorkers[child.pid] = {
                child: child
            };

            packages.map(function (pk) {
                const dirname = path.dirname(pk.file);
                if (files[i].indexOf(dirname) >= 0) {
                    mWorkers[child.pid].parent_package = pk.parent_package;
                }
            });

            child.send({ id: "config", msg: { config: mConfig } });
            child.send({ id: "load_worker_config", msg: { config: mWorkerConfig }});
            child.send({ id: "load_libraries", msg: { path: mConfig.workerLibRoot }});
            
            setTimeout(function () {
                child.send({ id: "load_worker", msg: {file: files[i], enabledStates: mWorkerEnabledStates || {} } });
            }, 100 * i);

            ++added;
        } catch(ex) {
            e(`Loading worker at ${files[i]}`, ex);

            if(!mWorkerLoadErrors) {
                mWorkerLoadErrors = [];
            }

            mWorkerLoadErrors.push({
                path: files[i], error: ex.message, detail: ex.stack
            });
        }
    }

    log(`Loaded ${added} workers from ${basedir}`);
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

function handleScreenEnter(screenName, type, callback) {

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
        
        worker.child.send({id: "screen_enter", msg: {screen_name: screenName, screen_type: type }});
    }

    d(`Sent request to ${queue.pids.length} processes`);

    if(queue.pids.length == 0) {
        callback(null, {});
    }
}

/** Gather up features from workers for the /features endpoint */
function gatherFeatures(callback) {

    mFeatureRequest.pids = [];
    mFeatureRequest.responses = [];
    mFeatureRequest.callback = callback;

    const queue = mFeatureRequest;

    for (let pid in mWorkers) {
        const worker = mWorkers[pid];
        if (!worker) continue;
        if (!worker.enabled) continue;
        if (!worker.child) continue;
        queue.pids.push(worker.child.pid);

        worker.child.send({ id: "feature_request", msg: { }});
    }

    d(`Sent request to ${queue.pids.length} processes`);

    if (queue.pids.length == 0) {
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

function imageDownload(req, res) {
    const workerId = req.params.worker_id;
    const name = req.params.name;
    const worker = findWorkerById(workerId);
    
    if(worker) {
        if(worker.child) {
            if(worker.enabled) {
                if(!mImageRequests[workerId]) {
                    mImageRequests[workerId] = {};
                }

                mImageRequests[workerId][name] = { res: res };

                worker.child.send({id: "image_request", msg: { worker_id: workerId, name: name }});
            } else {
                res.status(422).json({message: `Worker ${workerId} not enabled`});
            }
        } else {
            res.status(500).json({message: `Worker ${workerId} has no child process`});
        }
    } else {
        res.status(404).json({message: `worker ${workerId} not found`});
    }
}

function handleWorkerDownload(body, req, res) {
    const workerId = body.worker_id; // Worker
    const msgId = body.msg_id; // Action message
    const contentId = body.content_id; // Content to download
    const mimeType = body.mime_type;
    const filename = body.filename;

    const worker = findWorkerById(workerId);

    if(worker) {
        if(worker.enabled) {
            if(worker.child) {
                if(!mContentRequests[workerId]) {
                    mContentRequests[workerId] = {};
                }

                mContentRequests[workerId][contentId] = { res: res };
                d("send content_request");

                worker.child.send({id: "content_request", msg: { 
                    worker_id: workerId, 
                    content_id: contentId, 
                    msg_id: msgId,
                    mime_type: mimeType,
                    filename: filename
                }});
            } else {
                res.status(500).json({message: `Worker ${workerId} has no child process`});
            }
        } else {
            res.status(422).json({message: `worker ${workerId} not enabled`});
        }
    } else {
        res.status(404).json({message: `worker ${workerId} not found`});
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
    d("handleGCSMessage(): workerId=" + workerId);

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
                val.parent_package = worker.parent_package;

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
        val.config = mWorkerConfig[workerId];
        return val;
    }

    return null;
}

// This returns the config for a worker, NOT the overall config
function getWorkerConfig(workerId, cb) {
    d(`getWorkerConfig(): ${workerId}`);

    const worker = findWorkerById(workerId);
    if(worker) {
        // Set up the response callback.
        mResponseCallbacks.get_worker_config[workerId] = { callback: cb };

        const child = worker.child;
        child.send({ id: "get_worker_config", msg: { worker_id: workerId } });
    } else {
        if(cb) cb(null);
    }
}

function setWorkerConfig(workerId, config, cb) {
    d(`setWorkerConfig(): ${workerId}`);

    const worker = findWorkerById(workerId);
    if(worker) {
        mWorkerConfig[workerId] = config;

        // Set up the response callback.
        mResponseCallbacks.set_worker_config[workerId] = { callback: cb };

        const child = worker.child;
        child.send({ id: "set_worker_config", msg: { worker_id: workerId, msg: config } });

        if(mConfigChangeCallback) {
            mConfigChangeCallback(mWorkerConfig);
        }
    }
}

function onLoadWorkerConfig(workerConfig, changeCallback) {
    d(`onLoadWorkerConfig()`);

    Object.assign(mWorkerConfig, workerConfig);
    mConfigChangeCallback = changeCallback;
}

function setConfig(config) {
    mConfig.sysid = config.sysid || 221;
    mConfig.compid = config.compid || 101;
    mConfig.loopTime = config.loop_time_ms || 1000;

    if(config.udp) {
        mConfig.udp = {
            port: config.udp.port || 14550
        };
    } else {
        mConfig.udp = null;
    }

    if(config.serial) {
        mConfig.serial = {
            port: config.serial.port || "/dev/ttyS0",
            baud_rate: config.serial.baud_rate || 921600,
            udp_relay: config.serial.udp_relay
        };
    } else {
        mConfig.serial = null;
    }

    mConfig.workerRoots = config.worker_roots || [];
    mConfig.workerLibs = config.worker_lib_dirs || [];
    mConfig.workerLibRoot = config.worker_lib_root;

    if(config.heartbeats) {
        mConfig.heartbeats = {
            send: config.heartbeats.send || false,
            sysid: config.heartbeats.sysid || mConfig.sysid,
            compid: config.heartbeats.compid || mConfig.compid
        }
    } else {
        mConfig.heartbeats = { send: false };
    }

    mConfig.sendHeartbeats = config.send_heartbeats || false;
}

function installWorker(srcPath, target, callback) {
    if(!fs.existsSync(srcPath)) {
        return callback.onError(srcPath + " not found");
    }

    if(!global.BIN_DIR) {
        return callback.onError("global.BIN_DIR is not defined");
    }

    if (!fs.existsSync(target)) {
        try {
            fs.mkdirSync(target); // Returns undefined, so check if it worked
        } catch(ex) {
            return callback.onError(ex.message);
        }
    }

    function installSingleWorkerTo(target) {
        // Run $global.BIN_DIR/install_worker.sh to install the worker.
        const child = child_process.spawn(path.join(global.BIN_DIR, "install_worker.sh"), [srcPath, target]);
        var consoleOutput = "";
        const output = function (data) {
            d(data.toString());
            consoleOutput += data.toString();
        }

        child.stdout.on("data", output);
        child.stderr.on("data", output);

        child.on("close", function (rc) {
            d("script exited with return code " + rc);
            if (rc != 0) {
                callback.onError("Failed to install worker with exit code " + rc, consoleOutput.trim());
            } else {
                reload();
                callback.onComplete();
            }
        });
    }

    installSingleWorkerTo(target);
}

function enableWorker(workerId, enable, callback) {
    const worker = findWorkerById(workerId);
    if(worker) {
        worker.enabled = ("true" === enable);
        
        if(worker.child) {
            worker.child.send({id: "worker_enable", msg: { enabled: worker.enabled }});
        }

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
    notifyRosterChanged();
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
                e(`Error unloading worker ${worker.id}: ${ex.message}`);
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
                d(data.toString());
            };

            child.stdout.on("data", output);
            child.stderr.on("data", output);

            child.on("close", function (rc) {
                d("script exited with return code " + rc);
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

    let count = 0;
    for(let pid in mWorkers) {
        const worker = mWorkers[pid];
        if(!worker) continue;
        if(!worker.child) continue;

        worker.child.send({id: "worker_roster", msg: { roster: workerIds}});
        ++count;
    }

    log(`Sent worker_roster to ${count} workers`);

    mGCSMessageListeners.map(function (listener) {
        if (listener.onRosterChanged) {
            listener.onRosterChanged();
        }
    });

    return count;
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
            e(`Error saving enabled states: ${ex.message}`);
        }
    }
}

function loadWorkerEnabledStates() {
    d(`loadWorkerEnabledStates()`);

    const file = getWorkerEnabledConfigFile();
    fs.exists(file, function (exists) {
        if (exists) {
            fs.readFile(file, function (err, data) {
                try {
                    mWorkerEnabledStates = JSON.parse(data.toString());
                } catch(ex) {
                    e(`Error loading enabled state: ${ex.message}`);
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

function onPayloadStart(payload) {
    log(`onPayloadStart(): payload=${JSON.stringify(payload)}`);

    for (let pid in mWorkers) {
        const worker = mWorkers[pid];
        if (!worker) continue;
        if (!worker.child) continue;
        if (!worker.enabled) continue;

        worker.child.send({ id: "on_payload_start", msg: payload });
    }
}

function startSendingHeartbeats() {
    mHeartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

function stopSendingHeartbeats() {
    if(mHeartbeatTimer) {
        clearInterval(mHeartbeatTimer);
        mHeartbeatTimer = null;
    }
}

function packHeartbeat(mav, msg, sysid, compid) {
    const payload = jspack.Pack(msg.format, [msg.custom_mode, msg.type, msg.autopilot, msg.base_mode, msg.system_status, msg.mavlink_version]);
    const crc_extra = msg.crc_extra;

    msg.payload = payload;
    msg.header = new mavlink.header(msg.id, payload.length, mav.seq, sysid, compid);
    msg.msgbuf = msg.header.pack().concat(payload);
    var crc = mavlink.x25Crc(msg.msgbuf.slice(1));

    // For now, assume always using crc_extra = True.  TODO: check/fix this.
    crc = mavlink.x25Crc([crc_extra], crc);
    msg.msgbuf = msg.msgbuf.concat(jspack.Pack('<H', [crc]));
    return msg.msgbuf;
}

function sendHeartbeat() {
    d(`sendHeartbeat()`);

    const msg = new mavlink.messages.heartbeat(
        mavlink.MAV_TYPE_GCS,
        mavlink.MAV_AUTOPILOT_GENERIC,
        0, // base mode
        0, // custom mode
        0, // state
        0, // mavlink version
    );

    const buf = packHeartbeat(
        mavlink_shell.getMavlinkProcessor(),
        msg,
        mConfig.heartbeats.sysid,
        mConfig.heartbeats.compid
    );

    if (udpclient.isConnected()) {
        try {
            udpclient.sendMessage(Buffer.from(buf));
        } catch (ex) {
            e("Sending heartbeat", ex);
        }
    } else if(mSerialPort) {
        mSerialPort.write(Buffer.from(buf), function(err) {
            if(err) {
                d("Sending heartbeat", err);
            }
        });
    }
}

/** Remove the active payload (if any) and stop pinging */
function onPayloadStop() {
    const active = (mActivePayload != null);

    if(mActivePayload) {
        const worker = findWorkerById(mActivePayload.worker_id);

        if(worker && worker.child) {
            worker.child.send({ id: "on_payload_stop", msg: mActivePayload });
        }

        mActivePayload = null;

        if(mPayloadPing) {
            clearTimeout(mPayloadPing);
            mPayloadPing = null;
        }
    }

    return active;
}

function getActivePayload() {
    return mActivePayload;
}

function pingWorkerRoster() {
    const count = notifyRosterChanged();

    return { ping_count: count };
}

function onIVCPeerAdded(peer) {
    for (let pid in mWorkers) {
        const worker = mWorkers[pid];
        if (worker && worker.child && worker.enabled) {
            worker.child.send({ id: "ivc_peer_add", msg: peer });
        }
    }
}

function onIVCPeerDropped(peer) {
    for (let pid in mWorkers) {
        const worker = mWorkers[pid];
        if (worker && worker.child && worker.enabled) {
            worker.child.send({ id: "ivc_peer_drop", msg: peer });
        }
    }
}

exports.start = start;
exports.stop = stop;
exports.running = running;
exports.reload = reload;
exports.shutdown = shutdown;
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
exports.getWorkerConfig = getWorkerConfig;
exports.setWorkerConfig = setWorkerConfig;
exports.onLoadWorkerConfig = onLoadWorkerConfig;
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
exports.onPayloadStart = onPayloadStart;
exports.getActivePayload = getActivePayload;
exports.onPayloadStop = onPayloadStop;
exports.pingWorkerRoster = pingWorkerRoster;
exports.onIVCPeerAdded = onIVCPeerAdded;
exports.onIVCPeerDropped = onIVCPeerDropped;

