
const child_process = require('child_process');
const m8p_port = require("../server/m8p_port");
const mavutil = require("../util/mavutil");
const logger = require("../util/logger");
const system = require("./system");

function log(str) {
    logger.v("rtk", str);
}

function listPorts(req, res) {
    const output = [];

    m8p_port.listPorts({
        onPort: function (port) {
            output.push(port);
        },

        onComplete: function () {
            res.json(output);
        }
    });
}

function bool(v) {
    return (true === v || "true" === v);
}

function connectPort(req, res) {
    if(!req.body) {
        res.status(500).json({message: "Need body"});
    } else if(!req.body.port || !req.body.baudrate) {
        res.status(500).json({ message: "Need port and baudrate" });
    } else {
        log(JSON.stringify(req.body));

        mavutil.setInjectRTCM(bool(req.body.inject_rtcm));

        m8p_port.connectPort(req.body, {
            onOpen: function(port) {
                res.status(200).json({message: req.body.port});
                system.onSurveyStart();
            },

            onError: function(err) {
                res.status(500).json({message: err});
            }
        });
    }
}

function disconnectPort(req, res) {
    m8p_port.disconnectPort({
        onClose: function() {
            res.json({ message: "Stopped" });
        }
    });
}

function checkConnection(req, res) {
    m8p_port.checkConnection(function(isOpen) {
        res.json({open: isOpen});
    });
}

function setBasePos(req, res) {
    if (!req.body) {
        res.status(500).json({ message: "Need body" });
    } else {
        m8p_port.setBasePos(req.body, function(succeeded) {
            res.json({success: succeeded});
        });
    }
}

function setRTCM3Listener(listener) {
    m8p_port.setRTCM3Listener(listener);
}

function setUBXListener(listener) {
    m8p_port.setUBXListener(listener);
}

function startSurvey(options, callback) {
    if (!options) {
        return callback("Cannot start RTK survey: No options");
    } else if (!options.port || !options.baudrate) {
        return callback("Cannot start RTK survey: No port or baud rate");
    } else {
        mavutil.setInjectRTCM(bool(options.inject_rtcm));

        m8p_port.connectPort(options, {
            onOpen: function (port) {
                callback(null);
            },

            onError: function (err) {
                callback(err.message);
            }
        });
    }
}

exports.listPorts = listPorts;
exports.connectPort = connectPort;
exports.disconnectPort = disconnectPort;
exports.checkConnection = checkConnection;
exports.setRTCM3Listener = setRTCM3Listener;
exports.setUBXListener = setUBXListener;
exports.setBasePos = setBasePos;
exports.startSurvey = startSurvey;
