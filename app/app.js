'use strict';

global.appRoot = process.cwd();

for (const elem in process.argv) {
    console.log(`arg=${process.argv[elem]}`);
}

global.logVerbose = false;

// Handle command-line args
if(process.argv.length >= 3) {
    for(let i = 2, size = process.argv.length; i < size; ++i) {
        if(process.argv[i] === "verbose" || process.argv[i] === "-v") {
            console.log("logging is verbose");
            global.logVerbose = true;
        }
    }
}

const DEFAULT_CC_PORT = 3000;

const path = require("path");
const fs = require("fs");
const express = require('express');
const http = require('http');
const ws = require("ws");
const config = require('./util/config');
const compression = require("compression");
const zlib = require("zlib");

const VehicleTopics = require("./topic/VehicleTopics");
const routes = require('./routes');
const dispatcher = require("./routes/dispatcher");
const system = require("./routes/system");
const { MAV_AUTOPILOT_PPZ, MAG_CAL_RUNNING_STEP_ONE } = require("./util/mavlink");

// Default, actually overridden in a config file if present.
global.workerRoot = path.join(global.appRoot, "/workers");

global.BIN_DIR = path.join(global.appRoot, "/bin");
// global.PACKAGE_DOWNLOAD_DIR = global.appRoot + "/download";
global.PACKAGE_DOWNLOAD_DIR = path.join(global.appRoot, "/download");
// global.FILES_DIR = global.appRoot + "/files";
global.FILES_DIR = path.join(global.appRoot, "/files");

global.appVersion = "1.0.1";

function log(str) {
    console.log(`app: ${str}`);
    // Log.v("app", str);
}

function trace(str) {
    if(global.TRACE) {
        console.log(`app: ${str}`);
    }
}

// log(`Process start: PID=${process.pid}`);

const HEALTHCHECK_INTERVAL = 15000;
const WORKER_HEALTH_DELAY = 5000;
const RESTART_DELAY = 2000;
var mSubProcess;

log("Set up app");
setupApp();

// Setup function for the normal app
function setupApp() {
    const WebSocketServer = ws.Server;

    const mGCSSubscribers = [];
    const mLogSubscribers = [];
    const mQueuedWorkerMessages = [];
    const mMonitors = [];

    // console.log("db=" + db);
    const app = express();
    // all environments
    app.set('port', process.env.PORT || DEFAULT_CC_PORT);
    app.set('views', path.join(global.appRoot, 'public'));
    app.engine('html', require('ejs').renderFile);
    app.set('view engine', 'html');

    function shouldCompress(req, res) {
        if (req.headers['x-no-compression']) {
            // don't compress responses with this request header
            return false;
        }

        // fallback to standard filter function
        return compression.filter(req, res);
    }

    app.use(compression({filter: shouldCompress}));
    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(express.methodOverride());

    app.use(express.static(path.join(global.appRoot, 'public')));

    // development only
    if ('development' == app.get('env')) {
        app.use(express.errorHandler());
    }

    //
    // LISTENERS
    //
    const mGCSMessageListener = {
        onLogMessage: function(workerId, msg) {
            for (let i = 0, size = mLogSubscribers.length; i < size; ++i) {
                const client = mLogSubscribers[i];

                sendWSMessage(client, { event: "worker-log-gcs", data: { worker_id: workerId, message: msg } }, {
                    onError: function (err) {
                        log("Error sending message to " + client);

                        const idx = mLogSubscribers.indexOf(client);
                        if (idx >= 0) {
                            mLogSubscribers.splice(idx, 1);
                        }
                    },

                    onSuccess() {
                        // log("Sent " + msg + " to " + client);
                    }
                });
            }
        },

        onGCSMessage: function (workerId, msg) {
            trace(`onGCSMessage(): workerId=${workerId} msg=` + JSON.stringify(msg));

            mGCSSubscribers.map(function(client) {
                trace(`send to ${client}`);
                sendWSMessage(client, { event: "worker-to-gcs", data: { worker_id: workerId, message: msg } }, {
                    onError: function (err) {
                        log("Error sending message to " + client);

                        const idx = mGCSSubscribers.indexOf(client);
                        if (idx >= 0) {
                            mGCSSubscribers.splice(idx, 1);
                        }
                    },

                    onSuccess() {
                        // log("Sent " + msg + " to " + client);
                    }
                }, client.compressData);
            });
        },

        onMonitorMessage: function(workerId, msg) {
            if(mMonitors.length === 0) return;

            mMonitors.map(function(client) {
                sendWSMessage(client, { event: "monitor-to-gcs", data: { worker_id: workerId, message: msg } }, {
                    onError: function(err) {
                        log(`Error sending monitor message to ${client}`);

                        const idx = mMonitors.indexOf(client);
                        if(idx >= 0) {
                            mMonitors.splice(idx, 1);
                        }
                    },

                    onSuccess: function() {
                        trace(`Sent monitor message`);
                    }
                });
            });
        },

        onRosterChanged: function() {
            trace("onRosterChanged()");

            mGCSSubscribers.map(function (client) {
                trace(`send to ${client}`);
                sendWSMessage(client, { event: "roster-changed", data: {} }, {
                    onError: function (err) {
                        log("Error sending message to " + client);
                    },

                    onSuccess() {
                        // log("Sent " + msg + " to " + client);
                    }
                }, false);
            });
        }
    };

    function setupRoutes() {
        // global controller
        app.use(function (req, res, next) {
            res.header("Cache-Control", "no-cache, no-store, must-revalidate");
            res.header("Pragma", "no-cache");
            res.header("Expires", "0");
            next(); // http://expressjs.com/guide.html#passing-route control
        });

        //
        // ENDPOINTS
        //
        app.use("/", routes);

        // Dispatch
        app.get("/dispatch/start", dispatcher.start);
        app.get("/dispatch/stop", dispatcher.stop);
        app.get("/dispatch/running", dispatcher.running);
        app.get("/dispatch/reload", dispatcher.reload);
        app.get("/dispatch/log_filter", dispatcher.getLogWorkers);
        app.get("/dispatch/log_filter/:worker_ids", dispatcher.setLogWorkers);
        app.get("/dispatch/worker/enable/:worker_id/:flag", dispatcher.enableWorker);
        app.get("/dispatch/package/enable/:package_id/:flag", dispatcher.enablePackage);
        
        app.get("/ui/:screen/enter", dispatcher.screenEnter);
        app.get("/ui/:screen/exit", dispatcher.screenExit);
        app.get("/ui/image/:worker_id/:name", dispatcher.imageDownload);

        app.get("/sys/version", dispatcher.sysVersion);
        app.get("/sys/restart", restartSystem);
        app.post("/sys/update/upload", dispatcher.uploadSystemUpdate);
        app.post("/sys/update/install", dispatcher.installSystemUpdate);

        // Worker list
        app.get("/workers", dispatcher.getWorkers);
        app.post("/worker/upload", dispatcher.uploadWorker);
        app.post("/worker/install", dispatcher.installWorker);
        app.get("/worker/roster", dispatcher.pingWorkerRoster);
        app.get("/worker/reload/:worker_id", dispatcher.reloadWorker);
        app.get("/worker/details/:worker_id", dispatcher.getWorkerDetails);
        app.get("/worker/monitor/:worker_id/:monitor", dispatcher.monitorWorker);
        app.get("/worker/config/:worker_id", dispatcher.getWorkerConfig);
        app.post("/worker/config/:worker_id", dispatcher.setWorkerConfig);
        app.delete("/worker/:worker_id", dispatcher.removeWorker);
        app.delete("/package/:package_id", dispatcher.removePackage);
        // POST a message to a worker
        app.post("/worker/msg/:worker_id", dispatcher.workerMessage);
        // Content download
        app.post("/worker-download", dispatcher.workerDownload);
        // Features endpoint
        app.get("/features", dispatcher.getFeatures);

        // Payload support
        app.post("/payload/start", dispatcher.onPayloadStart);
        app.get("/payload/check", dispatcher.onPayloadCheck);
        app.get("/payload/stop", dispatcher.onPayloadStop);

        // Topics
        app.get("/topics", (req, res) => {
            res.json(VehicleTopics.listTopics());
        });

        // Trace
        app.get("/trace/:on_or_off", function (req, res, next) {
            global.TRACE = (req.params.on_or_off === "on");
            res.json({ message: "Trace is " + req.params.on_or_off });
        });

        app.get('/', routes.index);

        app.get("/client/ping", function(req, res) {
            res.status(200).json({message: "ok"});
        });

        // Return the caller's IP address
        app.get('/client/myip', function (req, res) {
            var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
            if (ip.indexOf("::ffff:") >= 0) {
                ip = ip.substring("::ffff:".length);
            }

            res.send(ip);
        });
    }

    setupRoutes();
    const server = http.createServer(app);

    //
    // WebSockets 
    //
    const webSocketServer = new WebSocketServer({ server: server });

    const WS_COMPRESS_THRESHOLD = 512;

    function doSendWSData(wsConnection, buffer, cb) {
        wsConnection.send(buffer, function (error) {
            // if no error, send worked.
            // otherwise the error describes the problem.
            if (error) {
                log("send result: error=" + error);
                if (cb && cb.onError) cb.onError(error);
            } else {
                if (cb && cb.onSuccess) cb.onSuccess();
            }
        });
    }

    // Send a WS message, and get an ack or an error.
    function sendWSMessage(wsConnection, data, cb, compressData) {
        const compress = (compressData !== undefined)? compressData: false;

        if (wsConnection) {
            const str = JSON.stringify(data);

            if(compress && str.length > WS_COMPRESS_THRESHOLD) {
                zlib.gzip(str, function(err, buffer) {
                    if(err) {
                        log(`error compressing data: ${err.message}`);
                        doSendWSData(wsConnection, str, cb);
                    } else {
                        log(`Compress ${str.length} to ${buffer.length}`);

                        const sendMe = (str.length > buffer.length)? buffer: str;
                        doSendWSData(wsConnection, sendMe, cb);
                    }
                })
            } else {
                doSendWSData(wsConnection, str, cb);
            }
        } else {
            log("ERROR: No web socket connection to send on!");
        }
    }

    // Send a message to all clients
    webSocketServer.broadcast = function (data) {
        webSocketServer.clients.foreach(function (client) {
            client.send(data);
        });
    };

    // websockets stuff
    webSocketServer.on("headers", function(headers) {
        log(`headers`);
        headers.map(function(h) {
            log(h);
        });
    });

    webSocketServer.on("error", function(error) {
        log(`WS error: ${error.message}`);
    });

    webSocketServer.on('connection', function (client) {
        log("Connected from client");

        // If we have queued messages waiting, send them now and clear them.
        if(mQueuedWorkerMessages && mQueuedWorkerMessages.length > 0) {
            mQueuedWorkerMessages.map(function(msg) {
                webSocketServer.broadcast(msg);
            });

            mQueuedWorkerMessages.splice(0, mQueuedWorkerMessages.length);
        }

        // got a message from the client
        client.on('message', function (data) {
            // log(`received message ${data}`);

            try {
                const jo = JSON.parse(data);
                // log(JSON.stringify(jo));

                if (jo.type) {
                    switch (jo.type) {
                        /*
                        Data looks like this:
    
                        {
                            type: "gcs-to-worker",
                            worker_id: "some-uuid",
    
                            msg: {
                                some_attribute: "Some value",
                                more_stuff: "Stuff here"
                            }
                        }
                        */
                        case "gcs-to-worker": {
                            if (jo.worker_id && jo.msg) {
                                dispatcher.handleGCSMessage(jo.worker_id, jo.msg);
                            }
                            break;
                        }

                        case "subscribe-gcs": {
                            log(`received message ${data}`);

                            if (mGCSSubscribers.indexOf(client) == -1) {
                                client.compressData = jo.compress;
                                mGCSSubscribers.push(client);
                                client.send(JSON.stringify({event: "subscribe-status", status: "subscribed"}));
                            }
                            break;
                        }

                        case "unsubscribe-gcs": {
                            log(`received message ${data}`);

                            const idx = mGCSSubscribers.indexOf(client);
                            if (idx >= 0) {
                                mGCSSubscribers.splice(idx, 1);
                                client.send(JSON.stringify({ event: "subscribe-status", status: "unsubscribed" }));
                            }
                            break;
                        }

                        case "subscribe-topic": {
                            if(jo.topic) {
                                VehicleTopics.addSubscriber(jo.topic, client);
                                client.send(JSON.stringify({event: "topic-status", status: "subscribed", topic: jo.topic }));
                            }
                            break;
                        }

                        case "unsubscribe-topic": {
                            if(jo.topic) {
                                VehicleTopics.removeSubscriber(jo.topic, client);
                                client.send(JSON.stringify({event: "topic-status", status: "unsubscribed", topic: jo.topic }));
                            }
                            break;
                        }

                        case "subscribe-monitor": {
                            log(`received message ${data}`);

                            if(mMonitors.indexOf(client) === -1) {
                                mMonitors.push(client);
                                client.send(JSON.stringify({event: "monitor-status", status: "subscribed"}));
                            }
                            break;
                        }

                        case "unsubscribe-monitor": {
                            log(`received message ${data}`);

                            const idx = mMonitors.indexOf(client);
                            if(idx >= 0) {
                                mMonitors.splice(idx, 1);
                                client.send(JSON.stringify({event: "monitor-status", status: "unsubscribed"}));
                            }
                            break;
                        }

                        case "subscribe-log": {
                            log(`received message ${data}`);

                            if (mLogSubscribers.indexOf(client) == -1) {
                                mLogSubscribers.push(client);
                            }
                            break;
                        }

                        case "unsubscribe-log": {
                            log(`received message ${data}`);

                            const idx = mLogSubscribers.indexOf(client);
                            if(idx >= 0) {
                                mLogSubscribers.splice(idx, 1);
                            }
                            break;
                        }

                        case "ping": {
                            log(`received message ${data}`);
                            
                            sendWSMessage(client, { message: "ok" });
                            break;
                        }
                    }
                }
            }
            catch (err) {
                log(err);
                sendWSMessage(client, "error in " + data);
            }
        });

        client.on('close', function () {
            log("connection to client closed");

            var idx = mGCSSubscribers.indexOf(client);
            if (idx >= 0) {
                mGCSSubscribers.splice(idx, 1);
            }
        });

        // Send a connected message back to the client
        sendWSMessage(client, "connected");
    });

    // End websockets

    config.readConfig(global.appRoot, function (configData) {
        log("Read config info");

        if (configData) {
            app.get("/config", function (req, res) {
                res.json(configData);
            });

            log(JSON.stringify(configData));

            global.workerConfig = configData;

            if(configData.dispatcher) {
                if (configData.dispatcher.worker_lib_root) {
                    const root = configData.dispatcher.worker_lib_root;
                    const filename = path.join(__dirname, root);
                    if(fs.existsSync(filename)) {
                        configData.dispatcher.worker_lib_root = path.join(__dirname, root);
                    }
                } else {
                    const filename = path.join(__dirname, "worker_lib");
                    if(fs.existsSync(filename)) {
                        global.worker_lib_root = filename;
                        configData.dispatcher.worker_lib_root = filename;
                    }
                }
            }

            config.readWorkerConfig(global.appRoot, (workerConfig) => {
                log("Read worker config");

                if(workerConfig) {
                    dispatcher.onLoadWorkerConfig(workerConfig, (changedConfig) => {
                        log(`Config changed`);
                        config.saveWorkerConfig(global.appRoot, changedConfig, (err) => {
                            if(err) {
                                console.error(err);
                            }
                        });
                    });
                } else {
                    log(`No worker config data`);
                }

                dispatcher.setConfig(configData.dispatcher);
                dispatcher.addGCSListener(mGCSMessageListener);
                dispatcher.reloadDirect();
                dispatcher.startDirect();
            });
        }
    });

    // Do startup stuff
    system.onStartup();

    server.listen(app.get('port'), function () {
        log('Express server listening on port ' + app.get('port'));
    });
}

function getMyIP() {
    const { networkInterfaces } = require("os");

    const nets = networkInterfaces();
    const results = {};

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                if (!results[name]) {
                    results[name] = [];
                }
                results[name].push(net.address);
            }
        }
    }

    for(let prop in results) {
        if(results[prop].length > 0) {
            return results[prop][0];
        }
    }

    return null;
}

function restartSystem(req, res) {
    function doRestartSystem() {
        const child_process = require("child_process");

        const cmdline = process.argv.join(" ");
        const cwd = process.cwd();
        log(`${cmdline}, cwd=${cwd}`);

        child_process.exec(cmdline, {
            cwd: cwd
        });

        process.exit();
    }

    dispatcher.shutdown(req, res);
    res.json({message: "Restarting"});

    setTimeout(doRestartSystem, 1000);
}

// IVC stuff
const IVC_PEER_CHECK_INTERVAL = 5000;
const PEER_TIMEOUT = 15000;
const mIVCPeers = {};

function startIVC() {
    const myIP = getMyIP();
    if (!myIP) return log(`Unable to get my own IP!`);
    const PORT = 5150;
    const dgram = require('dgram');

    VehicleTopics.setSenderInfo({ address: myIP, port: process.env.PORT || DEFAULT_CC_PORT });

    function startIVCPinger() {
        const broadcastAddress = `${myIP.substring(0, myIP.lastIndexOf("."))}.255`;
        log(`Broadcast address is ${broadcastAddress}`);

        const server = dgram.createSocket("udp4");

        server.bind(function () {
            server.setBroadcast(true);
            setInterval(broadcastNew, 10000);
        });

        broadcastNew();

        function broadcastNew() {
            const message = JSON.stringify({
                address: myIP, 
                port: process.env.PORT || DEFAULT_CC_PORT
            });

            server.send(message, 0, message.length, PORT, broadcastAddress, function () {
                trace(`Sent "${message}"`);
            });
        }
    }

    function startIVCListener() {
        var client = dgram.createSocket('udp4');

        function checkPeers() {
            const dispatch = require("./util/dispatch");

            const now = Date.now();

            for(let ip in mIVCPeers) {
                const peer = mIVCPeers[ip];
                if(peer) {
                    const diff = (now - peer.lastPing);
                    if(diff > PEER_TIMEOUT) {
                        log(`Have not heard from peer at ${ip} in ${diff}ms, dropping`);
                        delete mIVCPeers[ip];
                        // Notify dispatch the IVC peer has dropped off.
                        dispatch.onIVCPeerDropped(peer);
                    }
                } else {
                    delete mIVCPeers[ip];
                }
            }

            trace(`${Object.keys(mIVCPeers).length} peer(s) on the network`);
        }

        client.on('listening', function () {
            var address = client.address();
            log(`IVC listening on ${address.address}:${address.port}`);
            client.setBroadcast(true);
        });

        client.on('message', function (message, rinfo) {
            if(rinfo.address != myIP) {
                trace(`Message from ${rinfo.address}:${rinfo.port}: ${message}`);
                const now = Date.now();

                const ip = rinfo.address;

                const other = mIVCPeers[ip];

                if(other) {
                    other.lastPing = now;
                } else {
                    try {
                        const peer = JSON.parse(message);
                        peer.lastPing = now;

                        mIVCPeers[ip] = peer;
                        log(`Added peer at ${rinfo.address}`);
                        // Notify dispatch that a new peer has been added.
                        require("./util/dispatch").onIVCPeerAdded(peer);
                    } catch(ex) {
                        log(`Error adding peer: ${ex.message}`);
                    }
                }
            }
        });

        try {
            client.bind(PORT);
        } catch(ex) {
            return log(`Error binding to ${PORT} for IVC: ${ex.message}`);
        }

        setInterval(checkPeers, IVC_PEER_CHECK_INTERVAL);
    }

    startIVCListener();
    startIVCPinger();
}

startIVC();
