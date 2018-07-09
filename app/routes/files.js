"use strict";

const fs = require("fs");
const logger = require("../util/logger");

const FILES_DIR = global.FILES_DIR;

function log(str) {
    logger.v("files", str);
}

function rmdir(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function (file, index) {
            var curPath = path + "/" + file;
            if (fs.lstatSync(curPath).isDirectory()) { // recurse
                rmdir(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}

function friendlySize(size) {
    var out = size + " bytes";

    if (size >= 1024) {
        out = (size / 1024).toFixed(2) + "kb";
    }

    if (size >= (1024 * 1024)) {
        out = (size / (1024 * 1024)).toFixed(2) + "mb";
    }

    return out;
}

/* Callback: { onError(err) {}, onComplete(filesJsonArray) {}} */
function doListFiles(dir, cb) {
    if(!fs.existsSync(dir)) {
        return cb.onError({message: dir + " does not exist"});
    }

    fs.readdir(dir, function(err, files) {
        if(err) {
            if(cb.onError) {
                return cb.onError(err);
            }
        }

        const out = [];
        var stat;
        for (var i = 0, size = files.length; i < size; ++i) {
            stat = fs.statSync(dir + "/" + files[i]);

            out.push({
                filename: files[i],
                type: (stat.isDirectory())? "dir": "file",
                size: stat.size,
                friendlySize: friendlySize(stat.size),
                createDate: stat.birthtime,
                modifyDate: stat.mtime,
                accessTime: stat.atime
            });
        }

        cb.onComplete(out);
    });
}

function doDownloadFile(filename, filePath, response) {
    try {
        const stream = fs.createReadStream(filePath);
        stream.pipe(response);
    }
    catch(ex) {
        response.writeHead(500);
        response.end("Unable to get file: " + ex.message);
    }
}

// public
function listFiles(req, res) {
    const dir = FILES_DIR;
    doListFiles(dir, {
        onError: function(err) {
            res.status(200).json({message: err.message});
        },

        onComplete: function(array) {
            res.status(200).json(array);
        }
    });
}

function downloadFile(req, res) {
    const file = FILES_DIR + "/" + req.params.file;
    if(fs.existsSync(file)) {
        doDownloadFile(req.params.file, file, res);
    } else {
        res.status(404).send("Not found: " + req.params.file);
    }
}

exports.listFiles = listFiles;
exports.downloadFile = downloadFile;
exports.rmdir = rmdir;
