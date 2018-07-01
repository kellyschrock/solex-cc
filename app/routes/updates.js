"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const child_process = require("child_process");
const logger = require("../util/logger");

const PACKAGE_DOWNLOAD_DIR = global.global.PACKAGE_DOWNLOAD_DIR;
const GITHUB_PACKAGE_PATH = "/repos/kellyschrock/SolexBaseUpdates/contents/packages";

function log(val) {
    logger.v("updates", val);
}

function friendlySize(size) {
    size = size || 0;

    var out = size + " bytes";

    if(size >= 1024) {
        out = (size / 1024).toFixed(2) + "kb";
    }

    if(size >= (1024 * 1024)) {
        out = (size / (1024 * 1024)).toFixed(2) + "mb";
    }

    return out;
}

function basename(filename) {
    var last = filename.lastIndexOf("/");
    var fn = filename.substring(last + 1);
    last = fn.lastIndexOf(".");
    fn = fn.substring(0, last);
    return fn;
}

function checkInternetAccess(callback) {
    require('dns').lookup('google.com', function (err) {
        if (err && err.code == "ENOTFOUND") {
            callback(false);
        } else {
            callback(true);
        }
    });
}

function getUpdatePackages(callback) {
    log("getUpdatePackages()");

    const req = http.request({
        host: global.regServerHost,
        port: 80,
        path: "/api/updates/solexbase",
        method: "GET",
        headers: {
            accept: "application/json",
            "User-Agent": "AppleWebKit/602.1.50 (KHTML, like Gecko)"
        }
    }, function(res) {
        log("responseCode=" + res.statusCode + " msg=" + res.statusMessage);

        var buffer = "";
        res.on("data", function(data) {
            buffer += data;
        });

        res.on("end", function() {
            log("END: buffer.length=" + buffer.length);

            const output = [];
            const array = JSON.parse(buffer);
            for (var i = 0, size = array.length; i < size; ++i) {
                var jo = array[i];
                output.push({
                    name: jo.name, version: jo.version, description: jo.description, size: friendlySize(jo.size), url: jo.url
                });
            }

            if (callback.onPackages) {
                callback.onPackages(output);
            }
        });
    });

    req.end();
}

function getGithubPackages(callback) {
    log("getGithubPackages()");

    const req = https.request({
        host: "api.github.com",
        port: 443,
        path: GITHUB_PACKAGE_PATH,
        method: 'GET',
        headers: {
            accept: 'application/json',
            "User-Agent": "AppleWebKit/602.1.50 (KHTML, like Gecko)"
        }        
    }, function(res) {
        log("responseCode=" + res.statusCode + " msg=" + res.statusMessage);

        var buffer = "";
        res.on("data", function (data) {
            buffer += data;
        });

        res.on("end", function() {
            log("END: buffer.length=" + buffer.length);

            const output = [];

            const array = JSON.parse(buffer);
            for(var i = 0, size = array.length; i < size; ++i) {
                var jo = array[i];
                if(jo.type == "file") {
                    output.push({
                        name: jo.name,
                        path: jo.path,
                        size: friendlySize(jo.size),
                        url: jo.download_url
                    });
                }
            }

            if(callback.onPackages) {
                callback.onPackages(output);
            }
        });
    });

    req.on("error", function(err) {
        if(callback.onError) {
            callback.onError(err);
        } else {
            log(err);
        }
    });

    req.end();
}

function doCheckForUpdates(callback) {
    checkInternetAccess(function(hasConnection) {
        const reply = {
            internet: hasConnection
        };

        if(hasConnection) {
            // Add the output to the response.
            getUpdatePackages({
                onError: function(err) {
                    log("Error getting packages: " + err);
                    reply.err = err;
                    callback(reply);
                },

                onPackages(packages) {
                    log("onPackages()");
                    reply.packages = packages;
                    callback(reply);
                }
            });
        } else {
            callback(reply);
        }
    });
}

function getFilename(url) {
    if(url) {
        const pos = url.lastIndexOf("/");
        return url.substring(pos + 1);
    } else {
        return null;
    }
}

function doDownloadPackage(body, callback) {
    const url = body.url;
    const filename = getFilename(body.url);
    if(!filename) {
        return callback.onError({message: "No valid filename for url" + body.url});
    }

    const outfilename = PACKAGE_DOWNLOAD_DIR + "/" + filename;

    if(!fs.existsSync(PACKAGE_DOWNLOAD_DIR)) {
        fs.mkdirSync(PACKAGE_DOWNLOAD_DIR);
    }

    wget(url, outfilename, function(returnCode) {
        if(returnCode == 0) {
            if (body.extract) {
                doExtractPackage(outfilename, {
                    onComplete: function (result) {
                        result.extract = true;
                        callback.onComplete(result);
                    },

                    onError: function (err) {
                        callback.onError(err);
                    }
                });
            } else {
                // Just want a download, no extraction
                file.close(function () {
                    callback.onComplete({
                        extract: false,
                        filename: outfilename
                    });
                });
            }
        } else {
            callback.onError({message: "Download failed with return code " + returnCode});
        }
    });

    // const path = url.substring("https://github.com".length);
    // const options = {
    //     host: "github.com",
    //     port: 443,
    //     path: path,
    //     method: 'GET',
    //     rejectUnauthorized: false,
    //     requestCert: true,
    //     agent: false
    // };

    // const file = fs.createWriteStream(outfilename);
    // const request = https.get(options, function (response) {
    //     response.pipe(file);

    //     file.on('finish', function () {
    //         file.close();

    //         if(body.extract) {
    //             doExtractPackage(outfilename, {
    //                 onComplete: function(result) {
    //                     result.extract = true;
    //                     callback.onComplete(result);
    //                 },

    //                 onError: function(err) {
    //                     callback.onError(err);
    //                 }
    //             });
    //         } else {
    //             // Just want a download, no extraction
    //             file.close(function () {
    //                 callback.onComplete({
    //                     extract: false,
    //                     filename: outfilename
    //                 });
    //             });
    //         }
    //     });
    // });
    
    // request.on('error', function (err) { // Handle errors
    //     log("ERROR! " + err);

    //     fs.unlink(outfilename);
    //     if(callback.onError) {
    //         callback.onError(err);
    //     } else {
    //         log("Error downloading file: " + err);
    //     }
    // });

    // request.end();
}

function wget(url, filename, callback) {
    const child = child_process.spawn("wget", ["-O", filename, url]);

    child.stdout.on("data", function(data) {
        log("wget: " + data);
    });

    child.stderr.on("data", function(data) {
        log("wget ERR: " + data);
    });

    child.on("close", function(returnCode) {
        callback(returnCode);
    });
}

function unzip(filename, toDir, callback) {
    const child = child_process.spawn("unzip", ["-o", filename, "-d", toDir]);
    
    child.stdout.on("data", function(data) {
        log("stdout: " + data);
    });

    child.stderr.on("data", function(data) {
        log("stderr: " + data);
    });

    child.on("close", function(returnCode) {
        callback(returnCode);
    });
}

// Run the script and wait on it to return, calling callback with the return code.
function runScript(script, dir, callback) {
    log("Run " + script);

    fs.chmodSync(script, '777');

    const child = child_process.exec(script, {
        cwd: dir,
        encoding: 'utf8'
    }, function(err, stdout, stderr) {
        if(err) {
            callback({returnCode: err.code});
        } else {
            callback({returnCode: 0});
        }
    });

    var buffer = "";

    child.stdout.on("data", function(data) {
        buffer += data;
    });

    child.on("close", function (rc) {
        callback({returnCode: rc, output: buffer});
    });
}

function toDownloadDirectory(filename) {
    const last = filename.lastIndexOf("/");
    return filename.substring(0, last);
}

/* Callback looks like this: { onError: function(err) {}, onComplete: function(resultObj) {} } */
function doExtractPackage(filename, callback) {
    const toDir = toDownloadDirectory(filename);

    unzip(filename, toDir, function (returnCode) {
        if (returnCode == 0) {
            const infoFile = toDir + "/info.txt";

            const contents = (fs.existsSync(infoFile))?
                fs.readFileSync(infoFile).toString(): "No info about this package.";

            callback.onComplete({
                name: basename(filename),
                filename: filename,
                dir: toDir,
                info: contents
            });
        } else {
            callback.onError({message: "Unable to extract package, returnCode=" + returnCode});
        }
    });
}

/* Callback looks like this: { onError: function(err) {}, onComplete: function(resultObj) {} } */
function doApplyPackage(filename, callback) {
    const toDir = toDownloadDirectory(filename);

    unzip(filename, toDir, function(returnCode) {
        if(returnCode == 0) {
            // This is where the apply.sh script gets run if it exists.
            const script = toDir + "/apply.sh";
            if(fs.existsSync(script)) {
                runScript(script, toDir, function(result) {
                    callback.onComplete({
                        output: result.output,
                        returnCode: result.returnCode
                    });
                });
            } else {
                callback.onError({message: "No apply.sh script found in " + toDir});
            }
        }
    });
}

//
// public interface
//
function checkForUpdates(req, res) {
    doCheckForUpdates(function(result) {
        res.status(200).json(result);
    });
}

function downloadPackage(req, res) {
    const body = req.body;
    if(body) {
        doDownloadPackage(body, {
            onError: function(err) {
                res.status(200).json({message: err.message});
            },

            onComplete: function(result) {
                if(result.extract) {
                    res.status(200).json(result);
                } else {
                    // Just download, no extraction
                    res.status(200).json({ 
                        extract: false,
                        filename: result.filename 
                    });
                }
            }
        });
    } else {
        res.status(422).json({message: "Specify a package to download."});
    }
}

function applyPackage(req, res) {
    const body = req.body;
    if(body && body.filename) {
        doApplyPackage(body.filename, {
            onError: function(err) {
                res.status(200).json({message: "Update failed. " + err.message});
            },

            onComplete: function(result) {
                var msg = (result.returnCode)? 
                "Update completed with exit code " + result.returnCode: "Update completed successfully.";

                if(result.output) {
                    msg += "\n\nOutput:\n" + result.output;
                }

                res.status(200).json({message: msg});
            }
        });
    } else {
        res.status(200).json({message: "Specify a filename in the body."});
    }
}

exports.applyPackage = applyPackage;
exports.downloadPackage = downloadPackage;
exports.checkForUpdates = checkForUpdates;

// function test() {
//     PACKAGE_DOWNLOAD_DIR = "/home/kellys/incoming";

//     doCheckForUpdates(function(result) {
//         if(result.packages && result.internet) {
//             for(var i = 0, size = result.packages.length; i < size; ++i) {
//                 var pk = result.packages[i];
//                 doDownloadPackage(pk, {
//                     onError: function(err) {
//                         log(err);
//                     },

//                     onComplete: function(filename) {
//                         log("Check " + filename);
//                     }
//                 });
//             }
//         }
        
//     });
// }

// test();
