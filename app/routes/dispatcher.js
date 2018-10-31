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

function reload(req, res) {
    dispatch.reload();
    res.json({message: "reloaded"});
}

function getWorkers(req, res) {
    const workers = dispatch.getWorkers();
    res.json(workers);
}

function workerMessage(req, res) {
    const body = req.body;
    if(body) {
        const result = dispatch.handleGCSMessage(req.params.worker_id, body);
        res.status(200).json(result || {message: "ok"});
    } else {
        res.status(422).json({message: "No message body"});
    }
}

function getFirstWorkerRoot() {
    const cfg = (global.workerConfig)? global.workerConfig.dispatcher: null;

    return(cfg && cfg.worker_roots && cfg.worker_roots.length > 0)? 
        cfg.worker_roots[0]: null;
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
                res.status(200).json({message: "Installed"});
            },

            onError: function(msg) {
                res.status(200).json({message: msg});
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
exports.reload = reload;
exports.workerMessage = workerMessage;
exports.uploadWorker = uploadWorker;
exports.installWorker = installWorker;
exports.removeWorker = removeWorker;
exports.reloadDirect = reloadDirect;
exports.startDirect = startDirect;
exports.addGCSListener = addGCSListener;
exports.removeGCSListener = removeGCSListener;
exports.handleGCSMessage = handleGCSMessage;
exports.getWorkers = getWorkers;
exports.setConfig = setConfig;
