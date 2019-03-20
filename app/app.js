'use strict';

global.appRoot = process.cwd();

const path = require("path");
const fs = require("fs");
const cluster = require("cluster");
const express = require('express');
const http = require('http');
const ws = require("ws");
const Log = require("./util/logger");
const config = require('./util/config');
const compression = require("compression");
const zlib = require("zlib");

const routes = require('./routes');
const dispatcher = require("./routes/dispatcher");
const system = require("./routes/system");

// Default, actually overridden in a config file if present.
global.workerRoot = path.join(global.appRoot, "/workers");
console.log("global.appRoot=" + global.appRoot);

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

if(cluster.isMaster) {
    log("Set up master");
    setupMaster();
} else {
    log("Set up worker");
    setupWorker();
}

function setupMaster() {

    const queuedWorkerMessages = [];

    function initWorker(worker) {
        cluster.on("online", function (worker) {
            log(`worker pid ${worker.process.pid} is online`);

            if(queuedWorkerMessages.length > 0) {
                const msg = {
                    id: "queued_worker_messages", 
                    sender: "master",
                    queued_messages: queuedWorkerMessages
                };

                worker.send(msg);
            }
        });

        cluster.on("exit", function (worker, code, signal) {
            log(`worker ${worker.process.pid} stopped with code ${code} and signal ${signal}`);

            if (worker.exitedAfterDisconnect) {
                // All good, worker exited intentionally
            } else {
                // TODO: Ping the web socket and let clients know there was a problem.

                // Then restart the worker.
                log(`worker ${worker.process.pid} died unexpectedly, restart it`);
                mSubProcess = cluster.fork();
                initWorkerCallback(mSubProcess);
                // process.exit(122);
            }
        });

        initWorkerCallback(worker);
    }

    function initWorkerCallback(worker) {
        worker.on("message", function (msg) {
            // Message from the worker.
            switch (msg.id) {
                case "health": {
                    const workerPid = msg.worker_pid;
                    const time = (msg.answered - msg.asked);
                    // log(`worker responded to health check in ${time} ms`);

                    if (time > WORKER_HEALTH_DELAY && workerPid) {
                        log(`kill/restart ${workerPid}`);
                        // TODO: Kill/restart the worker
                        try {
                            mSubProcess.send({ id: "shutdown", sender: "master" });

                            // setTimeout(function() {
                            //     mSubProcess = cluster.fork();
                            // }, 1000);
                        } catch (ex) {
                            log(`error killing ${workerPid}: ${ex.message}`);
                        }
                    }

                    break;
                }

                case "restart_system": {
                    mSubProcess.send({
                        id: "shutdown", sender: "master"
                    });

                    setTimeout(function() {
                        mSubProcess = cluster.fork();
                        initWorkerCallback(mSubProcess);
                    }, RESTART_DELAY);
                    break;
                }

                default: {
                    log(`received ${msg.id} message from worker ${msg.worker_pid}`);
                    break;
                }
            }
        });
    }

    // Only want 1 worker process since this app loads stuff from fs.
    mSubProcess = cluster.fork();
    initWorker(mSubProcess);

    function healthCheck() {
        if(mSubProcess) {
            try {
                mSubProcess.send({
                    id: "health",
                    sender: "master",
                    asked: new Date().getTime()
                });
            } catch(ex) {
                log(`error sending health check: ${ex.message}`);
            }

            setTimeout(healthCheck, HEALTHCHECK_INTERVAL);
        }
    }

    setTimeout(healthCheck, HEALTHCHECK_INTERVAL);
}

// Setup function for the normal app
function setupWorker() {
    const WebSocketServer = ws.Server;

    const mGCSSubscribers = [];
    const mLogSubscribers = [];
    const mQueuedWorkerMessages = [];

    // console.log("db=" + db);
    const app = express();
    // all environments
    app.set('port', process.env.PORT || 3000);
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

    function setupWorkerMessages() {
        process.on("message", function(msg) {
            if (!msg) { return; }

            // log(`Worker got msg: ${msg.id}`);

            msg.worker_pid = process.pid;

            switch(msg.id) {
                case "health": {
                    if(msg.sender === "master") {
                        msg.answered = new Date().getTime();
                        // Send it back
                        process.send(msg);
                    }
                    break;
                }

                case "shutdown": {
                    msg.answered = new Date().getTime();
                    process.send(msg);

                    process.exit(0);
                    break;
                }

                case "queued_worker_messages": {
                    const messages = msg.queued_messages;
                    if(messages) {
                        messages.map(function(message) {
                            mQueuedWorkerMessages.push(message);
                        });
                    }
                    break
                }
            }
        });
    }

    setupWorkerMessages();

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

        app.get("/sys/restart", dispatcher.restartSystem);

        // Worker list
        app.get("/workers", dispatcher.getWorkers);
        app.post("/worker/upload", dispatcher.uploadWorker);
        app.post("/worker/install", dispatcher.installWorker);
        app.get("/worker/reload/:worker_id", dispatcher.reloadWorker);
        app.delete("/worker/:worker_id", dispatcher.removeWorker);
        app.delete("/package/:package_id", dispatcher.removePackage);
        // POST a message to a worker
        app.post("/worker/msg/:worker_id", dispatcher.workerMessage);
        // Content download
        app.post("/worker-download", dispatcher.workerDownload);
        // Features endpoint
        app.get("/features", dispatcher.getFeatures);

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
            log("received message " + data);

            try {
                const jo = JSON.parse(data);

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
                            if (mGCSSubscribers.indexOf(client) == -1) {
                                client.compressData = jo.compress;
                                mGCSSubscribers.push(client);
                                client.send(JSON.stringify({event: "subscribe-status", status: "subscribed"}));
                            }
                            break;
                        }

                        case "unsubscribe-gcs": {
                            var idx = mGCSSubscribers.indexOf(client);
                            if (idx >= 0) {
                                mGCSSubscribers.splice(idx, 1);
                                client.send(JSON.stringify({ event: "subscribe-status", status: "unsubscribed" }));
                            }
                            break;
                        }

                        case "subscribe-log": {
                            if (mLogSubscribers.indexOf(client) == -1) {
                                mLogSubscribers.push(client);
                            }
                            break;
                        }

                        case "unsubscribe-log": {
                            const idx = mLogSubscribers.indexOf(client);
                            if(idx >= 0) {
                                mLogSubscribers.splice(idx, 1);
                            }
                            break;
                        }

                        case "ping": {
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

            dispatcher.setConfig(configData.dispatcher);
            dispatcher.addGCSListener(mGCSMessageListener);
            dispatcher.reloadDirect();
            dispatcher.startDirect();
        }
    });

    // Do startup stuff
    system.onStartup();

    server.listen(app.get('port'), function () {
        log('Express server listening on port ' + app.get('port'));
    });
}

