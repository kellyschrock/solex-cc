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

const net = require("net");
const path = require("path");
const fs = require("fs");
const express = require('express');
const http = require('http');
const WebSocket = require("ws");
const config = require('./util/config');
const compression = require("compression");
const zlib = require("zlib");

const VehicleTopics = require("./topic/VehicleTopics");
const routes = require('./routes');
const dispatcher = require("./routes/dispatcher");
const system = require("./routes/system");
const dispatch = require("./util/dispatch");
const favicon = require("serve-favicon");
const errorHandler = require("errorhandler");
const methodOverride = require("method-override");
const morgan = require("morgan");
const e = require("express");

// Default, actually overridden in a config file if present.
global.workerRoot = path.join(global.appRoot, "/workers");

global.BIN_DIR = path.join(global.appRoot, "/bin");
// global.PACKAGE_DOWNLOAD_DIR = global.appRoot + "/download";
global.PACKAGE_DOWNLOAD_DIR = path.join(global.appRoot, "/download");
// global.FILES_DIR = global.appRoot + "/files";
global.FILES_DIR = path.join(global.appRoot, "/files");

global.appVersion = "1.0.1";

const VERBOSE = true;

function log(str) {
    console.log(`app: ${str}`);
    // Log.v("app", str);
}

function d(str) {
    if(VERBOSE) log(str);
}

function d(ex) {
    console.error(`app: ${(ex.message)? ex.message: ex}`);
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
    const WebSocketServer = WebSocket.Server;

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
    // app.use(favicon(path.join(__dirname, "public/favicon", "favicon.ico")));
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(methodOverride());

    app.use(express.static(path.join(global.appRoot, 'public')));

    // development only
    if ('development' == app.get('env')) {
        app.use(morgan("combined"));
        app.use(errorHandler());
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
            trace(`onGCSMessage(): workerId=${workerId} msg=${JSON.stringify(msg)}`);

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

        // Dispatch
        app.get("/dispatch/start", dispatcher.start);
        app.get("/dispatch/stop", dispatcher.stop);
        app.get("/dispatch/running", dispatcher.running);
        app.get("/dispatch/reload", dispatcher.reload);
        app.get("/dispatch/log_filter", dispatcher.getLogWorkers);
        app.post("/dispatch/loadpath", dispatcher.loadWorkersFromPath);
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
        app.get("/worker/enable/:worker_id/:flag", dispatcher.enableWorker);
        app.get("/worker/stop/:worker_id", dispatcher.stopWorker);
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

        // IVC
        app.get("/ivc/peers", listPeers);
        app.get("/ivc/topics", (req, res) => {
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

    webSocketServer.on('connection', function (client, req) {
        log("Connected from client");

        function toIPv4(ip) {
            if(!ip) return null;

            switch(ip) {
                case "::1": return "127.0.0.1";
                case "::0": return "All";
                default: {
                    const index = ip.lastIndexOf(":");
                    return(index >= 0)?
                        ip.substring(index + 1): ip;
                }
            }
        }

        if(client._socket && client._socket.remoteAddress) {
            // ::1 is the local loopback address in ipv6, same as 127.0.0.1
            // log(`Client IP is ${client._socket.remoteAddress}`);
            client.ip_address = toIPv4(client._socket.remoteAddress);
            log(`Client IP is ${client.ip_address}`);

            dispatcher.onGCSConnect({ address: client.ip_address });
        }

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
        }).on('close', function () {
            log(`Connection to client ${client.ip_address} closed`);

            var idx = mGCSSubscribers.indexOf(client);
            if (idx >= 0) {
                mGCSSubscribers.splice(idx, 1);
            }

            dispatcher.onGCSDisconnect({ address: client.ip_address });
        }).on("error", (ex) => {
            log(`Websocket client error: ${ex.message}`);
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

            log(JSON.stringify(configData, null, 2));

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

                dispatch.setLoadCompleteCallback(() => {
                    log("dispatch loaded");
                    if(!mIVCStarted) {
                        startIVC(global.workerConfig.ivc);
                    }
                });

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
const DEF_IVC_BROADCAST_INTERVAL = 10000;
const DEF_IVC_CLIENT_PING_TIME = 3000;
const DEF_IVC_CLIENT_TIMEOUT = DEF_IVC_CLIENT_PING_TIME * 2;
const IVC_BCAST_PORT = 5150;
const IVC_DIRECT_PORT = 6505;
const mIVCPeers = {};
const mIVCClients = {};
let mIVCStarted = false;

function listPeers(req, res) {
    for(let ip in mIVCPeers) {
        const topics = VehicleTopics.getSubscriptionsForIP(ip);
        if(topics) {
            mIVCPeers[ip].subscriptions = topics;
        }
    }

    res.json(mIVCPeers);
}

function startIVC(config) {
    if (config && config.disabled) {
        return log(`startIVC(): IVC configured NOT to run`);
    }

    const myIP = getMyIP();
    if (!myIP) return log(`Unable to get my own IP!`);
    const dgram = require('dgram');

    const IVC_BROADCAST_INTERVAL = config && config.broadcast_interval || DEF_IVC_BROADCAST_INTERVAL;
    const IVC_CLIENT_PING_TIME = config && config.client_ping_time || DEF_IVC_CLIENT_PING_TIME;
    const IVC_CLIENT_TIMEOUT = config && config.client_timeout || DEF_IVC_CLIENT_TIMEOUT;

    if(config) log(`startIVC(): Starting with ${(config)? JSON.stringify(config, null, 2): "default config"}`);

    VehicleTopics.setSenderInfo({ address: myIP, port: parseInt(process.env.PORT || DEFAULT_CC_PORT) });

    class IVCClient {
        constructor(peer) {
            this.peer = peer;
            this.client = new net.Socket();
            this.myLastPing = Date.now();
            this.pingHandle = null;
            this.pingInterval = IVC_CLIENT_PING_TIME;
            this.setupClient();
        }

        doPing() {
            this.lastPing = Date.now();
            const me = Object.assign({ping_time: this.lastPing}, makeLocalPeerInfo());

            if(this.newStart) {
                me.new_start = true;
                delete this.newStart;
            }

            // d(`Client send to ${this.peer.address}`);
            this.client.write(JSON.stringify(me));
        }

        onTimeout() {
            d(`onTimeout()`);

            const now = Date.now();
            const diffTime = (now - this.lastPing);

            if(diffTime > IVC_CLIENT_TIMEOUT) {
                d(`Failed to get a response from ${this.peer.address} for ${diffTime}ms, must have dropped`);
                this.stop();
            } else {
                // THEN WHAT THE HELL ARE WE DOING HERE?
                // setTimeout() is grossly inaccurate, less so if you use longer times.
                d(`Having trouble getting messages from ${this.peer.address} after ${diffTime}ms, retry`);
                this.timeoutHandle = setTimeout(this.onTimeout.bind(this), IVC_CLIENT_TIMEOUT);
            }
        }

        setupClient() {
            const self = this;
            this.client.on("data", (msg) => {
                // d(`IVCClient got data: ${msg}`);

                const now = Date.now();
                const jo = JSON.parse(msg);
                const diffTime = (now - jo.ping_time);

                // d(`IVC client got ${jo.response} response from ${info.address} in ${diffTime}ms`);
                self.myLastPing = now;
                // Ping again and check for dropped peer
                clearTimeout(self.pingHandle);
                self.pingHandle = setTimeout(self.doPing.bind(self), self.pingInterval);

                clearTimeout(this.timeoutHandle);
                this.timeoutHandle = null;
                this.timeoutHandle = setTimeout(this.onTimeout.bind(this), IVC_CLIENT_TIMEOUT);
            }).on("error", (ex) => {
                d(`IVC Client error: ${ex.message}`);
                this.stop();
            }).on("close", () => {
                d(`IVC client connection closed`);
                this.stop();
            });
        }

        start() {
            d(`IVCClient::start()`);

            try {
                d(`Connect to ${this.peer.address}:${IVC_DIRECT_PORT}`);
                this.client.connect(IVC_DIRECT_PORT, this.peer.address, () => {
                    d(`IVCClient connected to ${this.peer.address}`);

                    // start this client
                    this.newStart = true;
                    this.myLastPing = Date.now();
                    this.doPing();
                });
            } catch(ex) {
                e(`Error in IVCClient::start(): ${ex.message}`);
            }

            return this;
        }

        stop() {
            d(`IVCClient::stop()`);

            // stop this client
            if (this.pingHandle) clearTimeout(this.pingHandle);
            if (this.timeoutHandle) clearTimeout(this.timeoutHandle);

            if(this.peer) {
                delete mIVCClients[this.peer.address];
                delete mIVCPeers[this.peer.address];
                require("./util/dispatch").onIVCPeerDropped(this.peer);
            }

            try {
                this.client.close();
            } catch(ex) {
                e(`Error closing IVC client socket: ${ex.message}`);
            }

            return this;
        }
    }

    function makeLocalPeerInfo() {
        return {
            address: myIP,
            port: parseInt(process.env.PORT || DEFAULT_CC_PORT),
            hostname: require("os").hostname(),
            uptime: require("os").uptime()
        };
    }

    function startIVCPinger() {
        const broadcastAddress = `${myIP.substring(0, myIP.lastIndexOf("."))}.255`;
        log(`Broadcast address is ${broadcastAddress}`);

        const server = dgram.createSocket("udp4");

        server.bind(function () {
            server.setBroadcast(true);
            server.setMulticastTTL(128);
            setInterval(broadcastNew, IVC_BROADCAST_INTERVAL);
        });

        broadcastNew();

        function broadcastNew() {
            const message = JSON.stringify(makeLocalPeerInfo());

            trace(`IVC: Send ${message}`);

            server.send(message, 0, message.length, IVC_BCAST_PORT, broadcastAddress, function () {
                trace(`Sent "${message}"`);
            });
        }
    }

    function startIVCServer() {
        const server = net.createServer();
        const clientSockets = {};

        server.listen(IVC_DIRECT_PORT, myIP, () => {
            d(`IVC server listening on ${IVC_DIRECT_PORT}`);
        });

        server.on("connection", (socket) => {
            d(`Client connected from ${socket.remoteAddress}:${socket.remotePort}`);
            if(!socket.remoteAddress) {
                return d(`No remote address on new client socket`);
            }

            const info = {
                address: socket.remoteAddress,
                port: socket.remotePort
            };

            socket.on("data", (msg) => {
                // d(`TCP socket data: ${msg}`);

                const joPeer = JSON.parse(msg);

                if (joPeer.new_start) {
                    // This is for cases when the peer drops us for some reason and then recovers.
                    // In that case, any subscriptions, etc are dropped by the peer and need to be
                    // re-established. So we kill the old peer here and let it be re-made.
                    // Sucks, but it beats not having any subscriptions.
                    d(`NEW START`);
                    if (mIVCPeers[joPeer.address]) {
                        d(`Removing old peer at ${joPeer.address}`);
                        require("./util/dispatch").onIVCPeerDropped(joPeer);
                        delete mIVCPeers[joPeer.address];
                    }

                    delete joPeer.new_start;
                }

                // We want these machines to be both clients and servers
                if (!mIVCClients[info.address]) {
                    d(`Start a client connection to ${info.address}`);
                    startIVCClient(joPeer);
                }

                const response = { ping_time: joPeer.ping_time };
                let peer = mIVCPeers[info.address];
                if (peer) {
                    peer.lastPing = Date.now();
                    response.response = "ping";
                } else {
                    // We're getting messages from a peer, but didn't get it by the normal broadcast route.
                    // This is most likely because it still thinks we're available. Just register it as an IVC peer.
                    d(`Adding new IVC peer for ${info.address}`);
                    peer = JSON.parse(msg);
                    peer.lastPing = Date.now();
                    mIVCPeers[info.address] = peer;
                    response.response = "add";
                    d(`SERVER: Add IVC peer ${peer.address}`);
                    peer.added_at = Date();
                    require("./util/dispatch").onIVCPeerAdded(peer);
                }

                // This is what tells the client this peer is still alive.
                socket.write(JSON.stringify(response), (err) => {
                    if(err) {
                        e(`Error writing to socket: ${ex.message}`)
                    }
                })

            }).on("error", (ex) => {
                e(`Error in client socket at ${socket.remoteAddress}: ${ex.message}`);
            }).on("close", () => {
                d(`Socket at ${socket.remoteAddress}:${socket.remotePort} closed`);

                const ivcClient = mIVCClients[socket.remoteAddress];
                if(ivcClient) {
                    d(`IVC Server closing client at for ${socket.remoteAddress}`);
                    ivcClient.stop();
                    delete mIVCClients[socket.remoteAddress];
                }

                delete clientSockets[socket.remoteAddress];
            });

            if(socket.remoteAddress) {
                clientSockets[socket.remoteAddress] = socket;
            }
        })
        .on("error", (ex) => {
            e(`Error in TCP server: ${ex.message}`);
        });
    }

    // Start an IVCClient for this peer connection.
    function startIVCClient(peer) {
        d(`startIVCClient()`);
        
        const currClient = mIVCClients[peer.address];
        if(currClient) {
            d(`Remove old IVC client for ${peer.address}`);
            currClient.stop();
            delete mIVCClients[peer.address];
        }

        const ivcClient = new IVCClient(peer).start();
        mIVCClients[peer.address] = ivcClient;
    }

    function startIVCListener() {
        const client = dgram.createSocket('udp4');

        client.on('listening', function () {
            var address = client.address();
            client.setBroadcast(true);
        });

        client.on('message', function (message, rinfo) {
            if(rinfo.address != myIP) {
                trace(`Broadcast from ${rinfo.address}:${rinfo.port}: ${message}`);
                const now = Date.now();
                const ip = rinfo.address;

                const other = mIVCPeers[ip];

                if(!other) {
                    try {
                        const peer = JSON.parse(message);
                        peer.lastPing = now;
                        mIVCPeers[ip] = peer;

                        startIVCClient(peer);

                        log(`Added peer at ${rinfo.address}`);
                    } catch(ex) {
                        log(`Error adding peer: ${ex.message}`);
                    }
                }
            }
        });

        try {
            client.bind(IVC_BCAST_PORT, () => {
                log(`Bound IVC bcast client to ${IVC_BCAST_PORT}`);
            });
        } catch(ex) {
            return log(`Error binding to ${IVC_BCAST_PORT} for IVC: ${ex.message}`);
        }
    }

    startIVCServer();
    startIVCListener();
    startIVCPinger();
    mIVCStarted = true;
}

