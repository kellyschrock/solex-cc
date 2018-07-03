'use strict';

const fs = require('fs');
const path = require('path');

function readConfig(basepath, callback) {
    const filename = path.join(basepath, "config.json");
    if(fs.existsSync(filename)) {
        fs.readFile(filename, function(err, data) {
            if(err) {
                console.log("error reading " + filename + ":" + err.message);
                callback(); // pass nothing
            }

            const jo = JSON.parse(data);
            callback(jo);
        });
    } else {
        callback();
    }
}

exports.readConfig = readConfig;
