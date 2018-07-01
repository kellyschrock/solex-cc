"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const child_process = require("child_process");
const settings = require("./settings");
const gcs = require("./gcs");
const rtk = require("./rtk");
const netconfig = require("../util/netconfig");
const logger = require("../util/logger");

const mSystemState = {};

var mStartupErrors = [];

function doRebootSystem() {
    const child = child_process.spawn("reboot");
}

function doShutdownSystem() {
    const child = child_process.spawn("halt", ["-p"]);
}

function log(str) {
    logger.v("system", str);
}

function bool(v) {
    if(v === true) return true;
    if(v === "true") return true;
    return false;
}

function startOpsForSettings(startupSettings) {
    mStartupErrors = [];

    if (bool(startupSettings.start_rtk)) {
        rtk.startSurvey(settings.getSettingsDirect("rtk"), function (errMsg) {
            if (errMsg != null) {
                mStartupErrors.push("RTK: " + errMsg);
            }
        });
    }

    if (bool(startupSettings.connect_gcs)) {
        gcs.startConnection(settings.getSettingsDirect("gcs"), function(errMsg) {
            if(errMsg != null) {
                mStartupErrors.push("GCS: " + errMsg);
            }
        });
    }

    log("Startup errors:");
    for (var i = 0; i < mStartupErrors.length; ++i) {
        log(mStartupErrors[i]);
    }
}

function checkStartupConfig() {
    const startupSettings = settings.getStartupSettingsDirect();
    const currentConfigId = settings.getCurrentNetConnectionId();

    log("startupSettings=" + JSON.stringify(startupSettings));

    if (startupSettings != null) {
        if (startupSettings.hasOwnProperty("net_config_id") && startupSettings.hasOwnProperty("active") && (currentConfigId !== undefined)) {
            log(
                "net_config_id=" + startupSettings.net_config_id + 
                " active_config_id=" + + currentConfigId + 
                ", active=" + startupSettings.active);
                
            if (currentConfigId == startupSettings.net_config_id && bool(startupSettings.active)) {
                log("Current net config has active startup actions");

                startOpsForSettings(startupSettings);
            }
        }
    }
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
    
    const child = child_process.exec(path.join(global.BIN_DIR, "/startup.sh"), {
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

            setTimeout(checkStartupConfig, 5000);
        }
    });
}

function rebootSystem(req, res) {
    doRebootSystem();
    res.status(200).json({message: "System is rebooting"});
}

function shutdownSystem(req, res) {
    doShutdownSystem();
    res.status(200).json({message: "System is shutting down"});
}

function getStartupErrors(req, res) {
    res.status(200).json(mStartupErrors || []);
}

function getSerialNumber(callback) {
    try {
        const child = child_process.spawn(path.join(global.appRoot, "/bin/cpu_serial.sh"));
        child.stdout.on("data", function(data) {
            callback(data.toString());
        });
    } catch(ex) {
        log(ex);
        callback("Not available");
    }
}

function getHostname(cb) {
    const child = child_process.spawn("hostname");
    child.stdout.on("data", function(data) {
        cb(data);
    });
}

function getSystemInfo(req, res) {
    getSerialNumber(function(data) {
        res.status(200).json({
            serial: data,
            version: global.appVersion
        });
    });
}

function getSystemStateDirect() {
    return mSystemState;
}

function putSystemStateDirect(name, value) {
    mSystemState[name] = value;
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
            var buffer = "";

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
    // require('dns').lookup('google.com', function (err) {
    //     if (err && err.code == "ENOTFOUND") {
    //         callback(false);
    //     } else {
    //         callback(true);
    //     }
    // });
}

function checkInternetConnection(req, res) {
    checkInternetConnectionDirect(function(connected) {
        res.status(200).json({connected: connected});
    });
}

function sendRegistration(req, res) {
    if (req.body && req.body.userid) {
        getSerialNumber(function(serial) {
            if(serial.indexOf("Not") == 0) {
                return json.status(200).json({message: "Sent registration"});
            }

            const params = {
                userid: req.body.userid,
                hwid: serial.trim()
            };

            const options = {
                hostname: global.regServerHost,
                port: 80,
                path: '/api/reg/add',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };

            const request = http.request(options, function (response) {
                var buffer = "";

                response.on("error", function (err) {
                    res.status(500).json({ message: "Server error" });
                });

                response.on("data", function (data) {
                    buffer += data;
                });

                response.on("end", function () {
                    log("end: buffer=" + buffer);
                    saveRegistrationData(buffer);
                    res.status(200).json(JSON.parse(buffer));
                });
            });

            // Send the request to the reg server.
            request.write(JSON.stringify(params));
            request.end();
        });
    } else {
        res.status(422).json({ message: "Specify a body" });
    }
}

function checkRegistration(req, res) {
    if(req.body && req.body.userid) {
        const params = {
            userid: req.body.userid
        };

        const options = {
            hostname: global.regServerHost,
            port: 80,
            path: '/api/reg/check/' + req.body.userid,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        };

        const request = http.request(options, function(response) {
            var buffer = "";

            response.on("error", function(err) {
                res.status(500).json({message: "Server error"});
            });

            response.on("data", function(data) {
                buffer += data;
            });

            response.on("end", function() {
                log("end: buffer=" + buffer);
                res.status(200).json(JSON.parse(buffer));
            });
        });

        request.write(JSON.stringify(params));
        request.end();
    } else {
        res.status(422).json({ message: "Specify a body" });
    }
}

function getSystemState(req, res) {
    res.status(200).json(getSystemStateDirect());
}

function putSystemState(req, res) {
    const body = req.body;
    if(body) {
        const name = body.name;
        const value = body.value;
        if(name && value) {
            putSystemStateDirect(name, value);
            res.status(200).json({message: "Set " + name});
        } else {
            res.status(422).json({message: "Specify name and value"});
        }
    } else {
        res.status(422).json({message: "Specify a body"});
    }
}

function clearSystemState(req, res) {
    if(req.params.name) {
        delete mSystemState[req.params.name];
        res.status(200).json({message: "Deleted " + req.params.name});
    } else {
        res.status(422).json({message: "Specify a name to clear"});
    }
}

function getRegistrationFilename() {
    return path.join(global.appRoot, ".regdata");
}

function saveRegistrationData(data) {
    fs.writeFile(getRegistrationFilename(), data, function(err) {
        if(err) {
            log(err);
        }
    });
}

function getRegistrationState(req, res) {
    fs.exists(getRegistrationFilename(), function(exists) {
        res.status(200).json({registered: exists});
    });
}

function onSurveyStart() {
    log("onSurveyStart()");

    mSystemState.rtkStatus = {
        seenMessages: {
            rtcm: {},
            ubx: {}
        }
    };
}

function onRTCMMessage(msg) {
    // log("onRTCMMessage(): msg=" + msg);

    const msgno = msg.messageno;
    if(msgno) {
        if(!mSystemState.rtkStatus) {
            onSurveyStart();
        }

        if (!mSystemState.rtkStatus.seenMessages.rtcm[msgno]) {
            mSystemState.rtkStatus.seenMessages.rtcm[msgno] = 0;
        }

        ++mSystemState.rtkStatus.seenMessages.rtcm[msgno];

        if (msgno == 1005) {
            mSystemState.rtkStatus.basepos = msg.basepos;
            if (mSystemState.rtkStatus.basepos != null) {
                mSystemState.rtkStatus.basepos.receivedDate = new Date();
            }
        }
    }
}

function onUBXMessage(msg) {
    // log("onUBXMessage(): msg=" + msg);

    var msgno = "" + msg.msgId;
    var clsId = "" + msg.classId;

    if (!mSystemState.rtkStatus) {
        onSurveyStart();
    }

    if (!mSystemState.rtkStatus.seenMessages.ubx[clsId]) {
        mSystemState.rtkStatus.seenMessages.ubx[clsId] = {};
    }

    if (!mSystemState.rtkStatus.seenMessages.ubx[clsId][msgno]) {
        mSystemState.rtkStatus.seenMessages.ubx[clsId][msgno] = 0;
    }

    ++mSystemState.rtkStatus.seenMessages.ubx[clsId][msgno];
}

exports.onStartup = onStartup;
exports.rebootSystem = rebootSystem;
exports.shutdownSystem = shutdownSystem;
exports.getSystemInfo = getSystemInfo;
exports.getStartupErrors = getStartupErrors;
exports.getSystemStateDirect = getSystemStateDirect;
exports.putSystemStateDirect = putSystemStateDirect;
exports.getSystemState = getSystemState;
exports.putSystemState = putSystemState;
exports.clearSystemState = clearSystemState;
exports.getRegistrationState = getRegistrationState;
exports.onRTCMMessage = onRTCMMessage;
exports.onUBXMessage = onUBXMessage;
exports.onSurveyStart = onSurveyStart;
exports.checkInternetConnection = checkInternetConnection;
exports.checkRegistration = checkRegistration;
exports.sendRegistration = sendRegistration;