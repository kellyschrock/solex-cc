"use strict";

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const logger = require("./logger");

const NET_SETTINGS_FILE = path.join(global.appRoot, "/net.settings.json");
const NET_TEMPLATE_DIR = path.join(global.appRoot, "/netconfig/template");
const NET_OUTPUT_DIR = path.join(global.appRoot, "/netconfig/output");
const NET_SCRIPT_DIR = path.join(global.appRoot, "/netconfig/bin");

var mNetSettings = {
    network: []
};

function log(str) {
    logger.v("netconfig", str);
}

function replaceAll(str, target, replace) {
    var out = str.replace(target, replace);

    while(out.includes(target)) {
        out = out.replace(target, replace);
    }

    return out;
}

function bool(value) {
    return (value === true || value === 'true');
}

function toLines(array) {
    return array.join("\n");
}

function getTemplateFile(filename) {
    // TODO: for testing
    // return "/home/kellys/work/drone/pi/wifi-base-station/app/netconfig/template/" + filename;
    return NET_TEMPLATE_DIR + "/" + filename;
}

function getOutputDir(config) {
    const dir = NET_OUTPUT_DIR + "/" + config.id;

    if(!fs.existsSync(NET_OUTPUT_DIR)) {
        fs.mkdirSync(NET_OUTPUT_DIR);
    }

    if(fs.existsSync(dir)) {
        // Make sure it's clean
        const files = fs.readdirSync(dir);
        for(var i = 0, size = files.length; i < size; ++i) {
            log("remove " + dir + "/" + files[i]);
            fs.unlink(dir + "/" + files[i]);
        }
    } else {
        fs.mkdirSync(dir);
    }

    return dir;
}

function writeFileTo(dir, filename, contents) {
    const file = dir + "/" + filename;
    fs.writeFileSync(file, contents);
}

function execScriptFor(config, dir, scriptName) {
    const script = NET_SCRIPT_DIR + "/" + scriptName;

    const child = child_process.spawn(script, [dir]);
    child.on("error", function(err) {
        console.error(err);
        throw err;
    });

    child.stdout.on("data", function(data) {
        log("STDOUT: " + data.toString("utf8"));
    });

    child.stderr.on("data", function(data) {
        log("STDERR: " + data.toString("utf8"));
    })

    child.on("close", function() {
        log(script + " complete");
    });
}

function genAPHostApd(config) {
    const template = getTemplateFile("ap/hostapd.conf." + config.ap_security);
    const contents = fs.readFileSync(template).toString();

    var out = replaceAll(contents, "$(ssid)", config.ap_name);
    out = replaceAll(out, "$(interface)", config.interface || "wlan0");

    switch(config.ap_security) {
        case "wpa": {
            out = replaceAll(out, "$(wpa_passphrase)", config.ap_password);
            break;
        }
    }

    return out;
}

function genAPNetworkInterfacesFile(config) {
    const template = getTemplateFile("ap/interfaces");
    const contents = fs.readFileSync(template).toString();

    var out = replaceAll(contents, "$(ipaddress)", config.static_ip);
    out = replaceAll(out, "$(interface)", config.interface || "wlan0");

    return out;
}

function genAPDnsMasq(config) {
    const segs = config.static_ip.split(".");
    const last = segs[segs.length - 1];
    const start = parseInt(last) + 49;
    const end = parseInt(last) + 99;

    const ipStart = [segs[0], segs[1], segs[2], start].join(".");
    const ipEnd = [segs[0], segs[1], segs[2], end].join(".");

    const template = getTemplateFile("ap/dnsmasq.conf");
    const contents = fs.readFileSync(template).toString();

    var out = replaceAll(contents, "$(ipstart)", ipStart);
    out = replaceAll(out, "$(ipend)", ipEnd);
    out = replaceAll(out, "$(interface)", config.interface || "wlan0");

    return out;
}

function genDhcpcdConf(config) {
    const template = getTemplateFile("ap/dhcpcd.conf");
    const contents = fs.readFileSync(template).toString();

    var out = replaceAll(contents, "$(ipaddress)", config.static_ip);
    out = replaceAll(out, "$(interface)", config.interface || "wlan0");

    return out;
}

function genWpaSupplicantConf(config) {
    const template = getTemplateFile("station/wpa_supplicant.conf." + config.ap_security);
    const contents = fs.readFileSync(template).toString();
    
    var out = replaceAll(contents, "$(ssid)", config.ap_name);
    out = replaceAll(out, "$(password)", config.ap_password);
    out = replaceAll(out, "$(country)", config.country || "US");
    out = replaceAll(out, "$(proto)", config.proto || "WPA"); // RSN for Solo
    out = replaceAll(out, "$(pairwise)", config.pairwise || "CCMP");
    out = replaceAll(out, "$(auth_alg)", config.auth_alg || "OPEN");
    out = replaceAll(out, "$(interface)", config.interface || "wlan0");

    return out;
}

function genStationNetworkInterfacesFile(config) {
    const template = getTemplateFile((config.dhcp)? "station/interfaces.dhcp": "station/interfaces.static");
    const contents = fs.readFileSync(template).toString();

    var out = contents;

    if(!config.dhcp) {
        out = replaceAll(out, "$(ipaddress)", config.static_ip);
        out = replaceAll(out, "$(gateway)", config.gateway_ip);
    }

    out = replaceAll(out, "$(interface)", config.interface || "wlan0");

    return out;
}

function applyAPConfig(config) {
    log("applyAPConfig(): config=" + JSON.stringify(config));
    /*
    AP config requires:

    /etc/hostapd/hostapd.conf
    /etc/dnsmasq.conf
    /etc/dhcpcd.conf
    /etc/network/interfaces
    */
    log("/etc/hostapd/hostapd.conf:\n" + genAPHostApd(config));
    log("/etc/dnsmasq.conf:\n" + genAPDnsMasq(config));
    log("/etc/network/interfaces:\n" + genAPNetworkInterfacesFile(config));
    log("/etc/dhcpcd.conf\n", genDhcpcdConf(config));

    const dir = getOutputDir(config);
    writeFileTo(dir, "hostapd.conf", genAPHostApd(config));
    writeFileTo(dir, "dnsmasq.conf", genAPDnsMasq(config));
    writeFileTo(dir, "dhcpcd.conf", genDhcpcdConf(config));
    writeFileTo(dir, "interfaces", genAPNetworkInterfacesFile(config));

    execScriptFor(config, dir, "apply_ap.sh");

    return true;
}

function applyStationConfig(config) {
    log("applyStationConfig(): config=" + JSON.stringify(config));

    if(!config.auth_alg) {
        delete config.auth_alg;
    }

    if (!config.proto) {
        delete config.proto;
    }

    if (!config.pairwise) {
        delete config.pairwise;
    }

    if (!config.country) {
        delete config.country;
    }

    /*
    Station config requires:

    /etc/wpa_supplicant/wpa_supplicant.conf
    /etc/network/interfaces
    */
   log("/etc/wpa_supplicant/wpa_supplicant.conf:\n" + genWpaSupplicantConf(config));
   log("/etc/network/interfaces:\n" + genStationNetworkInterfacesFile(config));

    const dir = getOutputDir(config);
    writeFileTo(dir, "wpa_supplicant.conf", genWpaSupplicantConf(config));
    writeFileTo(dir, "interfaces", genStationNetworkInterfacesFile(config));

    execScriptFor(config, dir, "apply_station.sh");

    return true;
}

function findConfigWithId(id) {
    if (!mNetSettings) return null;
    if (!mNetSettings.network) return null;

    const nets = mNetSettings.network;
    nets.push(getDefaultNetconfig());

    const net = mNetSettings.network;
    for (var i = 0; i < net.length; ++i) {
        if (net[i].id == id) {
            return net[i];
        }
    }

    return null;
}

function indexOfConfigWithId(id) {
    if (!mNetSettings) return -1;
    if (!mNetSettings.network) return -1;

    const net = mNetSettings.network;
    for (var i = 0, size = net.length; i < size; ++i) {
        if (net[i].id == id) {
            return i;
        }
    }

    return -1;
}

function loadSettings() {
    if(fs.existsSync(NET_SETTINGS_FILE)) {
        fs.readFile(NET_SETTINGS_FILE, function (err, contents) {
            if (err) {
                log(err);
            } else {
                try {
                    mNetSettings = JSON.parse(contents);
                    log("netSettings=" + JSON.stringify(mNetSettings));
                } catch (ex) {
                    log(ex);
                    mNetSettings = {
                        network: []
                    };
                }
            }
        });
    } else {
        mNetSettings = {
            network: []
        };
    }
}

function saveSettings() {
    if (!mNetSettings) return false;

    const network = mNetSettings.network;
    if(network) {
        var idx = -1;
        var i = 0;
        for(i = 0; i < network.length; ++i) {
            if(network[i].id == 0) {
                idx = i;
                break;
            }
        }

        if(idx != -1) {
            network.splice(idx, 1);
        }
    }

    fs.writeFile(NET_SETTINGS_FILE, JSON.stringify(mNetSettings), function (err) {
        if (err) {
            log(err);
        } else {
            log("Saved net settings");
            return true;
        }
    });
}

function getDefaultNetconfig() {
    return {
        id: 0, 
        readonly: true,
        name: "Default", 
        type: "ap", 
        static_ip: "10.0.0.1",
        ap_name: "SolexBase",
        ap_security: "wpa",
        ap_password: "solexbase",
        dhcp: false
    };
}

//
// public interface
//
function getNetConnections() {
    const out = [getDefaultNetconfig()];

    if(mNetSettings && mNetSettings.network) {
        for(var i = 0, size = mNetSettings.network.length; i < size; ++i) {
            out.push(mNetSettings.network[i]);
        }
    }

    return out;
}

function getNetConnection(id) {
    const items = getNetConnections();

    for(var i = 0, size = items.length; i < size; ++i) {
        if(id == items[i].id) {
            return items[i];
        }
    }

    return null;
}

function applyNetConfig(id) {
    try {
        const config = findConfigWithId(id);
        var success = false;

        if (config != null) {
            switch (config.type) {
                case "ap": {
                    success = applyAPConfig(config);
                    break;
                }

                case "station": {
                    success = applyStationConfig(config);
                    break;
                }

                default: {
                    log("Unknown type " + config.type);
                    success = false;
                    break;
                }
            }

            if(success) {
                saveSettings();
            }
        } else {
            log("Unable to find config with id " + id);
            success = false;
        }
    } catch(ex) {
        log(ex);
        success = false;
    }

    return success;
}

function deleteNetConfig(id) {
    var result = false;

    if (!id) {
        log("Need to pass an ID to delete.");
        result = false;
    } else {
        const index = indexOfConfigWithId(id);
        if (index >= 0) {
            mNetSettings.network.splice(index, 1);
            result = true;
            saveSettings();
        } else {
            log(id + " not found");
            result = false;
        }
    }

    return result;
}

function postNetConfig(body) {
    var result = false;
    const dhcp = bool(body.dhcp);
    body.dhcp = dhcp;

    // Find a network configuration with the same name as what's specified. If found, update it with req.body.
    // Otherwise, add it to the list.
    const index = indexOfConfigWithId(body.id);
    if (index >= 0) {
        mNetSettings.network[index] = body;
        result = true;
    } else {
        mNetSettings.network.push(body);
        result = true;
    }

    saveSettings();
    return result;
}

exports.loadSettings = loadSettings;
exports.postNetConfig = postNetConfig;
exports.deleteNetConfig = deleteNetConfig;
exports.getNetConnections = getNetConnections;
exports.getNetConnection = getNetConnection;
exports.applyNetConfig = applyNetConfig;
exports.findConfigWithId = findConfigWithId;

function test() {
    function load() {
        const file = "/home/kellys/work/drone/pi/wifi-base-station/app/net.settings.json";

        const contents = fs.readFileSync(file);
        mNetSettings = JSON.parse(contents);
        if(!mNetSettings.hasOwnProperty("currentConfigId")) {
            mNetSettings.currentConfigId = 0;
        }
    }

    function listAndApply() {
        const connections = getNetConnections();
        for(var i = 0, size = connections.length; i < size; ++i) {
            const con = connections[i];
            if(con.type == "station") {
                applyNetConfig(con.id);
                break;
            }
        }
    }

    load();
    listAndApply();

    process.exit(0);
}

// test();


