
const path = require("path");

global.appRoot = process.cwd();
// Default, actually overridden in a config file if present.
global.workerRoot = path.join(global.appRoot, "/workers");
console.log("global.appRoot=" + global.appRoot);

// global.BIN_DIR = global.appRoot + "/bin";
global.BIN_DIR = path.join(global.appRoot, "/bin");
// global.PACKAGE_DOWNLOAD_DIR = global.appRoot + "/download";
global.PACKAGE_DOWNLOAD_DIR = path.join(global.appRoot, "/download");
// global.FILES_DIR = global.appRoot + "/files";
global.FILES_DIR = path.join(global.appRoot, "/files");

global.appVersion = "1.0.1";

const express = require('express');
const http = require('http');
const ws = require("ws");
const mavutil = require('./util/mavutil');
const Log = require("./util/logger");
const config = require('./util/config');

const routes = require('./routes');
const commands = require('./routes/commands');
// const settings = require("./routes/settings");
const gcs = require("./routes/gcs");
const dispatcher = require("./routes/dispatcher");
const system = require("./routes/system");
const updates = require("./routes/updates");
const files = require("./routes/files");

const WebSocketServer = ws.Server;

const mMavlinkSubscribers = [];

const mRtcmSubscribers = [];

// console.log("db=" + db);
const app = express();
// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(global.appRoot, 'public'));
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());

// TODO: This won't work with pkg
app.use(express.static(path.join(global.appRoot, 'public')));

// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

function log(str) {
    Log.v("app", str);
}

//
// LISTENERS
//
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
    app.get("/dispatch/reload", dispatcher.reload);

    app.get('/', routes.index);

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
const wss = new WebSocketServer({server: server});

// Send a WS message, and get an ack or an error.
function send(ws, data, cb) {
    const str = JSON.stringify(data);

    ws.send(str, function(error) {
        // if no error, send worked.
        // otherwise the error describes the problem.
        if(error) {
            log("send result: error=" + error);
            if(cb && cb.onError) cb.onError(error);
        } else {
            if(cb && cb.onSuccess) cb.onSuccess();
        }
    });
}

// Send a message to all clients
wss.broadcast = function(data) {
    wss.clients.foreach(function(client) {
        client.send(data);
    });
};

// websockets stuff
wss.on('connection', function(client) {
    // got a message from the client
    client.on('message', function(data) {
        log("received message " + data);

        try {
            const jo = JSON.parse(data);

            if(jo.type) {
                switch(jo.type) {
                    case "subscribe-mavlink": {
                        if(jo.name) {
                            if(mMavlinkSubscribers.indexOf(client) == -1) {
                                mMavlinkSubscribers.push(client);
                            }

                            gcs.subscribeMavlink(jo.name, {
                                onMavlinkMessage: function(msg) {
                                    send(client, { event: "mavlink", data: msg }, {
                                        onError: function (err) {
                                            gcs.unsubscribeMavlink(jo.name);
                                        }
                                    });
                                }
                            });
                        }

                        break;
                    }

                    case "unsubscribe-mavlink": {
                        var idx = mMavlinkSubscribers.indexOf(client);
                        if(idx >= 0) {
                            mMavlinkSubscribers.splice(idx, 1);
                        }

                        if(jo.name) {
                            gcs.unsubscribeMavlink(jo.name);
                        }
                        break;
                    }

                    case "subscribe-cmd": {
                        log("subscribing to " + jo.command + " output");

                        var listener = {
                            onData: function(chunk) {
                                send(client, { event: "output", data: chunk }, {
                                    onError: function (err) {
                                        commands.stopDaemon(jo);
                                    }
                                });
                            },

                            onError: function(err) {
                                send(client, {event: "error", error: err });
                                send(client, { event: "closed" });
                            },

                            onClose: function() {
                                send(client, { event: "closed" });
                            }
                        }

                        commands.startDaemon(jo, listener);

                        break;
                    }

                    case "unsubscribe-cmd": {
                        log("unsubscribing " + jo.id);
                        commands.stopDaemon(jo, {
                            onClose: function() {
                                send(client, { message: "unsubscribed" });
                            }
                        });

                        break;
                    }

                    case "ping": {
                        send(client, { message: "ok" });
                        break;
                    }

                    case "subscribe-rtcm3": {
                        log("Subscribing to RTCM3 output");

                        if(mRtcmSubscribers.indexOf(client) == -1) {
                            mRtcmSubscribers.push(client);
                            send(client, {
                                type: jo.type,
                                message: "ok"
                            });
                        }

                        break;
                    }

                    case "unsubscribe-rtcm3": {
                        log("Unsubscribing from RTCM3 output");

                        const idx = mRtcmSubscribers.indexOf(client);
                        if(idx >= 0) {
                            mRtcmSubscribers.splice(idx, 1);
                            send(client, {
                                type: jo.type,
                                message: "ok"
                            });
                        }
                        break;
                    }

                    case "subscribe-ubx": {
                        log("Subscribing to UBX output");

                        if(mUBXSubscribers.indexOf(client) == -1) {
                            mUBXSubscribers.push(client);
                            send(client, {
                                type: jo.type,
                                message: "ok"
                            });
                        }
                        break;
                    }

                    case "unsubscribe-ubx": {
                        log("Unsubscribe from UBX output");
                        const idx = mUBXSubscribers.indexOf(client);
                        if(idx >= 0) {
                            mUBXSubscribers.splice(idx, 1);
                            send(client, {
                                type: jo.type,
                                message: "ok"
                            });
                        }
                        break;
                    }
                }
            }
        }
        catch(err) {
            log(err);
            send(client, "error in " + data);
        }
    });

    client.on('close', function() {
        log("connection to " + client + " closed");
        var idx = mRtcmSubscribers.indexOf(client);
        if(idx >= 0) {
            mRtcmSubscribers.splice(idx, 1);
        }
    });

    // Send a connected message back to the client
    send(client, "connected");
});

// End websockets

config.readConfig(global.appRoot, function(configData) {
    log("Read config info");

    if(configData) {
        log(JSON.stringify(configData));

        if(configData.worker_root) {
            global.workerRoot = configData.worker_root;
        }

        dispatcher.reloadDirect();
        dispatcher.startDirect();
    }
});

// Do startup stuff
system.onStartup();

server.listen(app.get('port'), function() {
    log('Express server listening on port ' + app.get('port'));
});
