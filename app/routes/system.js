"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const child_process = require("child_process");
const logger = require("../util/logger");

function log(str) {
    logger.v("system", str);
}

//
// public interface
//
function onStartup() {
    log("onStartup(): BIN_DIR=" + global.BIN_DIR);

    if(!global.BIN_DIR) {
        log("global.BIN_DIR not defined");
        return;
    }

    const startupScript = path.join(global.BIN_DIR, "startup.sh");

    if(!fs.existsSync(startupScript)) {
        return;
    }
    
    const child = child_process.exec(path.join(global.BIN_DIR, "startup.sh"), {
        cwd: global.appRoot
    }, function(err, stdout, stderr) {
        if(err) {
            log(err);
        } else {
            if(stdout) {
                log(stdout);
            }

            if(stderr) {
                log(stderr);
            }
        }
    });
}

function checkInternet(callback) {
    try {
        const options = {
            hostname: "clients3.google.com",
            port: 80,
            path: '/generate_204',
            method: 'GET'
        };

        const request = http.request(options, function (response) {
            if (response.statusCode == 204) {
                callback(true);
            }

            response.on("error", function (err) {
                callback(false);
            });

            response.on("data", function (data) {
                callback(true);
            });

            response.on("end", function () {
                callback(true);
            });
        });

        request.on("error", function(err) {
            log(err);
            callback(false);
        });

        request.end();
    } catch(ex) {
        log(ex.message);
    }
}

function checkInternetConnectionDirect(callback) {
    checkInternet(callback);
}

function checkInternetConnection(req, res) {
    checkInternetConnectionDirect(function(connected) {
        res.status(200).json({connected: connected});
    });
}

exports.onStartup = onStartup;
exports.checkInternetConnection = checkInternetConnection;
exports.checkInternetConnectionDirect = checkInternetConnectionDirect;
