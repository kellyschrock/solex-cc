'use strict';

const fs = require('fs');
const path = require('path');

function readWorkerConfig(basepath, callback) {
    const filename = path.join(basepath, "worker-config.json");
    if(fs.existsSync(filename)) {
        fs.readFile(filename, (err, data) => {
            if(err) {
                console.log(`error reading ${filename}: ${ex.message}`);
                callback(null);
            }

            const jo = JSON.parse(data);
            callback(jo);
        });
    } else {
        callback(null);
    }
}

function saveWorkerConfig(basepath, config, callback) {
    const filename = path.join(basepath, "worker-config.json");
    const data = JSON.stringify(config, null, 4);

    fs.writeFile(filename, data, (err) => {
        callback(err);
    });
}

function readConfig(basepath, callback) {
    const filename = path.join(basepath, "config.json");
    if(fs.existsSync(filename)) {
        fs.readFile(filename, function(err, data) {
            if(err) {
                console.log("error reading " + filename + ":" + err.message);
                callback(null); // pass nothing
            }

            const jo = JSON.parse(data);
            callback(jo);
        });
    } else {
        callback(null);
    }
}

exports.readWorkerConfig = readWorkerConfig;
exports.saveWorkerConfig = saveWorkerConfig;
exports.readConfig = readConfig;
