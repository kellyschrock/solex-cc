'use strict';

const formidable = require("formidable");
const fs = require("fs");
const path = require("path");

const dispatch = require("../util/dispatch");

function d(str) {
    console.log("dispatcher: " + str);
}

function start(req, res) {
    dispatch.start();
    res.json({message: "started"});
}

function stop(req, res) {
    dispatch.stop();
    res.json({message: "stopped"});
}

function running(req, res) {
    const isRunning = dispatch.running();
    res.json({
        running: isRunning
    });
}

function reload(req, res) {
    dispatch.reload();
    res.json({message: "reloaded"});
}

function getWorkers(req, res) {
    const workers = dispatch.getWorkers();
    res.json(workers);
}

function workerDownload(req, res) {
    const body = req.body;

    if(body) {
        const resultBuf = dispatch.handleWorkerDownload(body);
        if(resultBuf) {
            const mimeType = body.mime_type; // File MIME type
            const filename = body.filename; // Filename output is stored in

            if(filename) {
                res.setHeader("Content-Disposition", "attachment; filename=" + filename);
            }

            if(mimeType) {
                res.setHeader("Content-Type", mimeType);
            }

            res.send(new Buffer(resultBuf, 'binary'));
        } else {
            res.status(404).json({message: `No content with ${body.content_id} found for ${body.worker_id}`});
        }
    } else {
        res.status(422).json({ message: "No message body" });
    }
}

function workerMessage(req, res) {
    const body = req.body;
    if(body) {
        const result = dispatch.handleGCSMessage(req.params.worker_id, body);

        if(result) {
            if(!result.hasOwnProperty("ok")) result.ok = true;
        }

        res.status(200).json(result || { 
            ok: true, 
            message: "no response",
            worker_id: req.params.worker_id,
            source_id: body.id
         });
    } else {
        res.status(422).json({message: "No message body"});
    }
}

function uploadWorker(req, res) {
    const form = new formidable.IncomingForm();
    form.parse(req, function (err, fields, upload) {
        const file = (upload)? upload.file: null;

        if(file) {
            function basename(name, ext) {
                const pos = name.indexOf(ext);
                return (pos > 0)? name.substring(0, pos): name;
            }

            const targetRoot = getFirstWorkerRoot();

            const outputRoot = path.join(targetRoot, basename(file.name, ".zip"));

            if(targetRoot) {
                res.status(200).json({
                    name: file.name,
                    path: file.path,
                    type: file.type,
                    size: file.size,
                    target: outputRoot
                });
            } else {
                res.status(200).json({
                    message: "No configured worker roots"
                });
            }
        } else {
            res.status(200).json({
                message: "No file"
            });
        }
    });
}

function installWorker(req, res) {
    const path = req.body.path;
    const target = req.body.target;

    if(path && target) {
        dispatch.installWorker(path, target, {
            onComplete: function() {
                res.status(200).json({
                    success: true,
                    message: "Installed"
                });
            },

            onError: function(msg, output) {
                res.status(200).json({
                    success: false,
                    message: msg,
                    command_output: output
                });
            }
        })
    } else {
        res.status(200).json({message: "Specify path to worker archive in 'path' and target directory in 'target'."});
    }
}

function removeWorker(req, res) {
    dispatch.removeWorker(req.params.worker_id, {
        onComplete: function() {
            res.status(200).json({message: "Removed " + req.params.worker_id});
        },

        onError: function(msg) {
            res.status(422).json({message: "Unable to remove " + req.params.worker_id});
        }
    });
}

function getLogWorkers(req, res) {
    const workerIds = dispatch.getLogWorkers() || [];
    res.status(200).json({worker_ids: workerIds.join(",")});
}

function setLogWorkers(req, res) {
    const ok = dispatch.setLogWorkers(req.params.worker_ids);
    res.status(200).json({message: "Set log filter to " + req.params.worker_ids});
}

function restartSystem(req, res) {
    res.json({message: "Restarting"});

    setTimeout(function() {
        process.send({id: "restart_system" });
    }, 1000);
}

function reloadDirect() {
    dispatch.reload(global.workerRoot);
}

function startDirect() {
    dispatch.start();
}

function addGCSListener(listener) {
    dispatch.addGCSMessageListener(listener);
}

function removeGCSListener(listener) {
    dispatch.removeGCSMessageListener(listener);
}

function handleGCSMessage(workerId, msg) {
    dispatch.handleGCSMessage(workerId, msg);
}

function setConfig(config) {
    dispatch.setConfig(config);
}

exports.start = start;
exports.stop = stop;
exports.running = running;
exports.reload = reload;
exports.workerMessage = workerMessage;
exports.workerDownload = workerDownload;
exports.uploadWorker = uploadWorker;
exports.installWorker = installWorker;
exports.removeWorker = removeWorker;
exports.getLogWorkers = getLogWorkers;
exports.setLogWorkers = setLogWorkers;
exports.reloadDirect = reloadDirect;
exports.startDirect = startDirect;
exports.addGCSListener = addGCSListener;
exports.removeGCSListener = removeGCSListener;
exports.handleGCSMessage = handleGCSMessage;
exports.getWorkers = getWorkers;
exports.setConfig = setConfig;
exports.restartSystem = restartSystem;

function getFirstWorkerRoot() {
    const cfg = (global.workerConfig) ? global.workerConfig.dispatcher : null;

    return (cfg && cfg.worker_roots && cfg.worker_roots.length > 0) ?
        cfg.worker_roots[0] : null;
}
