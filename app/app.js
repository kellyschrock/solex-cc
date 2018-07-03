
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
const gcs = require("./routes/gcs");
const dispatcher = require("./routes/dispatcher");
const system = require("./routes/system");
const updates = require("./routes/updates");
const files = require("./routes/files");

const WebSocketServer = ws.Server;

const mGCSSubscribers = [];

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
const mGCSMessageListener = {
    onGCSMessage: function(workerId, msg) {
        log("onGCSMessage(): msg=" + msg);

        for(var i = 0, size = mGCSSubscribers.length; i < size; ++i) {
            const client = mGCSSubscribers[i];

            send(client, { event: "worker-to-gcs", data: {worker_id: workerId, message: msg } }, {
                onError: function(err) {
                    log("Error sending message to " + client);

                    const idx = mGCSSubscribers.indexOf(client);
                    if(idx >= 0) {
                        mGCSSubscribers.splice(idx, 1);
                    }
                },

                onSuccess() {
                    // log("Sent " + msg + " to " + client);
                }
            });
        }
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
    app.get("/dispatch/reload", dispatcher.reload);

    // Worker list
    app.get("/workers", dispatcher.getWorkers);
    // POST a message to a worker
    app.post("/worker/msg/:worker_id", dispatcher.workerMessage);

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
                        if(jo.worker_id && jo.msg) {
                            dispatcher.handleGCSMessage(jo.worker_id, jo.msg);
                        }
                        break;
                    }

                    case "subscribe-gcs": {
                        if(mGCSSubscribers.indexOf(client) == -1) {
                            mGCSSubscribers.push(client);
                        }
                        break;
                    }

                    case "unsubscribe-gcs": {
                        var idx = mGCSSubscribers.indexOf(client);
                        if (idx >= 0) {
                            mGCSSubscribers.splice(idx, 1);
                        }
                        break;
                    }

                    case "ping": {
                        send(client, { message: "ok" });
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

        dispatcher.addGCSListener(mGCSMessageListener);
        dispatcher.reloadDirect();
        dispatcher.startDirect();
    }
});

// Do startup stuff
system.onStartup();

server.listen(app.get('port'), function() {
    log('Express server listening on port ' + app.get('port'));
});
