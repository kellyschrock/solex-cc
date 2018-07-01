"use strict";

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const xml2js = require("xml2js");

const netconfig = require("../util/netconfig");
const logger = require("../util/logger");

const SETTINGS_FILE = path.join(global.appRoot, "/settings.json");
const STARTUP_SETTINGS = path.join(global.appRoot, "/startup.json");

var mSettings = null;
var mStartupSettings = null;

function log(str) {
    logger.v("settings", str);
}

function saveSettings() {
    log("saveSettings(): mSettings=" + mSettings);

    if(!mSettings) return;

    fs.writeFile(SETTINGS_FILE, JSON.stringify(mSettings), function(err) {
        if(err) {
            log(err);
        } else {
            log("Saved settings");
        }
    });
}

function saveStartupSettings() {
    if(!mStartupSettings) return;

    fs.writeFile(STARTUP_SETTINGS, JSON.stringify(mStartupSettings), function (err) {
        if (err) {
            log(err);
        } else {
            log("Saved startup settings");
        }
    });
}

function getNetConfigPath() {
    return global.appRoot + "/netconfig";
}

function loadStartupSettings() {
    if(fs.existsSync(STARTUP_SETTINGS)) {
        fs.readFile(STARTUP_SETTINGS, function(err, contents) {
            if(err) {
                log(err);
            } else {
                try {
                    mStartupSettings = JSON.parse(contents);
                } catch(ex) {
                    log(ex);
                    mStartupSettings = {};
                }
            }
        });
    } else {
        mStartupSettings = {};
    }
}

function loadSettings() {
    if(fs.existsSync(SETTINGS_FILE)) {
        fs.readFile(SETTINGS_FILE, function (err, contents) {
            if (err) {
                log(err);
            } else {
                try {
                    mSettings = JSON.parse(contents);
                    log(JSON.stringify(mSettings));
                } catch (ex) {
                    log(ex);
                    mSettings = {};
                }
            }
        });
    } else {
        mSettings = {};
    }

    netconfig.loadSettings();
}

function getSettingsDirect(cat) {
    return (mSettings && mSettings[cat]) ?
        mSettings[cat] : {};
}

function getSettings(req, res) {
    if(req.params.cat) {
        const out = getSettingsDirect(req.params.cat);
        res.json(out);
    } else {
        res.json(mSettings || {});
    }
}

function getNetConnections(req, res) {
    const out = netconfig.getNetConnections();
    res.json(out);
}

function getNetConnection(req, res) {
    if(req.params.id) {
        const conn = netconfig.getNetConnection(req.params.id);
        if(conn != null) {
            res.status(200).json(conn);
        } else {
            res.status(422).json({message: "Connection with id " + req.params.id + " not found"});
        }
    } else {
        res.status(422).json({message: "Need to specify an id parameter."});
    }
}

function getCurrentNetConnectionId() {
    return (mSettings && mSettings.net && mSettings.net.current_config) ?
        mSettings.net.current_config : 0;
}

function getCurrentNetConnection(req, res) {
    const id = getCurrentNetConnectionId();

    const conn = netconfig.getNetConnection(id);
    if (conn != null) {
        res.status(200).json(conn);
    } else {
        res.status(422).json({ message: "Connection with id " + id + " not found" });
    }
}

function postSetting(req, res) {
    const cat = req.params.cat || "general";
    const name = req.body.name;
    const value = req.body.value;

    if (!mSettings[cat]) {
        mSettings[cat] = {};
    }

    if(name && value) {
        mSettings[cat][name] = value;
        res.status(200).json({name, value});
        saveSettings();
    } else {
        for(var prop in req.body) {
            mSettings[cat][prop] = req.body[prop];
        }

        saveSettings();
        res.status(200).json(mSettings[cat]);
    }
}

function postNetConfig(req, res) {
    if(!req.body) {
        json.status(422).json({message: "Need to specify a network configuration."});
        return;
    }

    if(!req.body.name) {
        json.status(422).json({message: "Invalid network configuration."});
        return;
    }

    if(netconfig.postNetConfig(req.body)) {
        res.status(200).json({message: "Added/updated"});
    } else {
        res.status(422).json({message: "Unable to save net config"});
    }
}

/** Applies the network configuration with the specified ID. */
function applyNetConfig(req, res) {
    const id = req.params.id;

    if(netconfig.applyNetConfig(id)) {
        res.status(200).json({ message: "Applied." });

        if(mSettings.net) {
            mSettings.net.current_config = id;
        } else {
            mSettings.net = {
                current_config: id
            };
        }

        saveSettings();
    } else {
        res.status(422).json({ message: "Unable to apply configuration with id " + id });
    }
}

function deleteSetting(req, res) {
    const name = req.name;
    const cat = req.param.cat;

    if(mSettings[name]) {
        delete mSettings[name];
        res.status(200).json({message: name + " deleted"});
        saveSettings();
    } else {
        res.status(422).json({message: name + " not found in settings"});
    }
}

function deleteNetConfig(req, res) {
    const id = req.params.id;

    if(netconfig.deleteNetConfig(id)) {
        res.status(200).json({message: "Deleted " + id});
    } else {
        res.status(422).json({message: "Unable to delete config with id " + id});
    }
}

function clearSettings(req, res) {
    if(req.params.cat) {
        if(mSettings) {
            mSettings[req.params.cat] = {};
        }
    } else {
        mSettings = {};
    }
    
    res.status(200).json({message: "cleared settings"});
    saveSettings();
}

function getStartupSettingsDirect() {
    return mStartupSettings;
}

function getStartupSettings(req, res) {
    res.status(200).json(getStartupSettingsDirect());
}

function applyStartupSettings(req, res) {
    if(req.body) {
        mStartupSettings = req.body;
        res.status(200).json({message: "Saved"});
        saveStartupSettings();
    } else {
        res.status(422).json({message: "Specify a body in the request."});
    }
}


exports.getSettings = getSettings;
exports.getSettingsDirect = getSettingsDirect;
exports.postSetting = postSetting;
exports.deleteSetting = deleteSetting;
exports.clearSettings = clearSettings;
// network
exports.getNetConnections = getNetConnections;
exports.getNetConnection = getNetConnection;
exports.getCurrentNetConnectionId = getCurrentNetConnectionId;
exports.getCurrentNetConnection = getCurrentNetConnection;
exports.postNetConfig = postNetConfig;
exports.applyNetConfig = applyNetConfig;
exports.deleteNetConfig = deleteNetConfig;
// startup
exports.getStartupSettings = getStartupSettings;
exports.applyStartupSettings = applyStartupSettings;
exports.getStartupSettingsDirect = getStartupSettingsDirect;

loadSettings();
loadStartupSettings();

