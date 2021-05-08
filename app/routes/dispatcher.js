'use strict';

const formidable = require("formidable");
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

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

function getWorkerDetails(req, res) {
    const worker = dispatch.getWorkerDetails(req.params.worker_id);
    if(worker) {
        res.json(worker);
    } else {
        res.status(404).json({message: `No worker with ${req.params.worker_id}`});
    }
}

function getWorkerConfig(req, res) {
    d(`getWorkerConfig()`);

    dispatch.getWorkerConfig(req.params.worker_id, (config) => {
        res.json(config || {});
    });
}

function setWorkerConfig(req, res) {
    d(`setWorkerConfig()`);

    dispatch.setWorkerConfig(req.params.worker_id, req.body, (result) => {
        res.json({ result: result });
    });
}

function onLoadWorkerConfig(workerConfig, changeCallback) {
    d(`onLoadWorkerConfig(): ${JSON.stringify(workerConfig)}`);
    dispatch.onLoadWorkerConfig(workerConfig, changeCallback);
}

function monitorWorker(req, res) {
    dispatch.monitorWorker(req.params.worker_id, req.params.monitor);
    res.json({monitor: req.params.monitor});
}

function workerDownload(req, res) {
    const body = req.body;

    if(body) {
        dispatch.handleWorkerDownload(body, req, res);
    } else {
        res.status(422).json({ message: "No message body" });
    }
}

function screenEnter(req, res) {
    const name = req.params.screen;
    const type = (req.query && req.query.type); // optional

    dispatch.handleScreenEnter(name, type, function(err, output) {
        if(err) {
            return res.status(500).json({message: err.message});
        }
        
        const result = output || {};
        result.screen_id = name;
        res.status(200).json(result);
    });
}

function screenExit(req, res) {
    const name = req.params.screen;

    dispatch.handleScreenExit(name, function(err, output) {
        if(err) {
            return res.status(500).json({message: err.message});
        }

        const result = output || {};
        result.screen_id = name;
        res.status(200).json(result);
    });
}

function imageDownload(req, res) {
    dispatch.imageDownload(req, res);
}

function workerMessage(req, res) {
    const body = req.body;
    if(body) {
        dispatch.handleGCSMessage(req.params.worker_id, body, function(err, result) {
            if(err) {
                return res.status(400).json({
                    ok: false,
                    message: err.message
                });
            }

            if (result) {
                if (!result.hasOwnProperty("ok")) result.ok = true;
            }

            res.status(200).json(result || {
                ok: true,
                message: "no response",
                worker_id: req.params.worker_id,
                source_id: body.id
            });
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

function pingWorkerRoster(req, res) {
    const result = dispatch.pingWorkerRoster();

    res.json(result);
}

function uploadSystemUpdate(req, res) {
    const form = new formidable.IncomingForm();
    form.parse(req, function (err, fields, upload) {
        const file = (upload) ? upload.file : null;

        if (file) {
            function basename(name, ext) {
                const pos = name.indexOf(ext);
                return (pos > 0) ? name.substring(0, pos) : name;
            }

            const targetRoot = global.appRoot;

            // const outputRoot = path.join(targetRoot, basename(file.name, ".zip"));

            if (targetRoot) {
                res.status(200).json({
                    name: file.name,
                    path: file.path,
                    type: file.type,
                    size: file.size
                });
            } else {
                res.status(200).json({
                    message: "Can't find the app root"
                });
            }
        } else {
            res.status(200).json({
                message: "No file"
            });
        }
    });
}

function installSystemUpdate(req, res) {
    const filePath = req.body.path;

    if (filePath) {
        d(`path=${filePath}`);

        if(!fs.existsSync(filePath)) {
            return res.status(500).json({message: `Path ${filePath} not found`});
        }

        if(!global.BIN_DIR) {
            return res.status(500).json({message: `BIN_DIR is not defined`});
        }

        const child = child_process.spawn(path.join(global.BIN_DIR, "install_update.sh"), [filePath, global.appRoot]);
        let consoleOutput = "";
        const output = function(data) {
            d(data.toString());
            consoleOutput += data.toString();
        }

        child.stdout.on("data", output);
        child.stderr.on("data", output);

        child.on("close", function(rc) {
            d("script exited with return code " + rc);
            if (rc != 0) {
                res.status(200).json( { success: false, message: `Failed to install update with exit code ${rc}: ${consoleOutput.trim()}` } );
            } else {
                res.status(200).json({ success: true, message: "Updated. Reboot your vehicle." });
            }
        });
    } else {
        res.status(200).json({ message: "No update path specified." });
    }
}

function sysVersion(req, res) {
    const versionFile = path.join(global.appRoot, "version");
    
    if(fs.existsSync(versionFile)) {
        const content = fs.readFileSync(versionFile);
        res.status(200).send(content.toString());
    } else {
        res.status(200).send("1.0 (I think)");
    }
}

function enableWorker(req, res) {
    const workerId = req.params.worker_id;
    const enable = req.params.flag;

    dispatch.enableWorker(workerId, enable, function(err, enabled) {
        if(err) {
            res.status(404).json({message: err.message});
        } else {
            res.status(200).json({enabled: enable});
        }
    });
}

function enablePackage(req, res) {
    const workerId = req.params.package_id;
    const enable = req.params.flag;

    dispatch.enablePackage(workerId, enable, function(err, enabled) {
        if(err) {
            res.status(404).json({message: err.message});
        } else {
            res.status(200).json({enabled: enable});
        }
    });
}

function removePackage(req, res) {
    dispatch.removePackage(req.params.package_id, {
        onComplete: function() {
            res.status(200).json({message: "Removed " + req.params.package_id});
        },

        onError: function(msg) {
            res.status(422).json({message: "Unable to remove " + req.params.package_id });
        }
    });
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

function reloadWorker(req, res) {
    if(dispatch.reloadWorker(req.params.worker_id)) {
        res.status(200).json({message: "Reloaded"});
    } else {
        res.status(404).json({message: `Worker ${req.params.worker_id} not found`});
    }
}

function getLogWorkers(req, res) {
    const workerIds = dispatch.getLogWorkers() || [];
    res.status(200).json({worker_ids: workerIds.join(",")});
}

function setLogWorkers(req, res) {
    const ok = dispatch.setLogWorkers(req.params.worker_ids);
    res.status(200).json({message: "Set log filter to " + req.params.worker_ids});
}

function getFeatures(req, res) {
    dispatch.gatherFeatures(function(err, output) {
        if(err) {
            return res.status(500).json({message: err.message});
        }

        if (output) {
            res.status(200).json(output);
        } else {
            res.status(404).json({ message: "no features at all!" });
        }
    });
}

function shutdown(req, res) {
    dispatch.shutdown();
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
    dispatch.handleGCSMessage(workerId, msg, function(err, result) {
        if(err) {
            d(`Error in handleGCSMessage(): ${ex.message}`);
        }
    });
}

function setConfig(config) {
    dispatch.setConfig(config);
}

function onPayloadStart(req, res) {
    dispatch.onPayloadStart(req.body);
    res.json({ok: true});
}

function onPayloadCheck(req, res) {
    const payload = dispatch.getActivePayload();

    res.json({ payload: payload });
}

function onPayloadStop(req, res) {
    const active = dispatch.onPayloadStop();
    res.json({ was_active: active });
}

exports.start = start;
exports.stop = stop;
exports.running = running;
exports.reload = reload;
exports.workerMessage = workerMessage;
exports.workerDownload = workerDownload;
exports.uploadWorker = uploadWorker;
exports.uploadSystemUpdate = uploadSystemUpdate;
exports.installSystemUpdate = installSystemUpdate;
exports.sysVersion = sysVersion;
exports.installWorker = installWorker;
exports.removeWorker = removeWorker;
exports.reloadWorker = reloadWorker;
exports.removePackage = removePackage;
exports.enableWorker = enableWorker;
exports.enablePackage = enablePackage;
exports.screenEnter = screenEnter;
exports.screenExit = screenExit;
exports.imageDownload = imageDownload;
exports.getLogWorkers = getLogWorkers;
exports.setLogWorkers = setLogWorkers;
exports.reloadDirect = reloadDirect;
exports.startDirect = startDirect;
exports.addGCSListener = addGCSListener;
exports.removeGCSListener = removeGCSListener;
exports.handleGCSMessage = handleGCSMessage;
exports.getWorkers = getWorkers;
exports.getWorkerDetails = getWorkerDetails;
exports.getWorkerConfig = getWorkerConfig;
exports.setWorkerConfig = setWorkerConfig;
exports.onLoadWorkerConfig = onLoadWorkerConfig;
exports.monitorWorker = monitorWorker;
exports.setConfig = setConfig;
exports.shutdown = shutdown;
exports.getFeatures = getFeatures;
exports.onPayloadStart = onPayloadStart;
exports.onPayloadCheck = onPayloadCheck;
exports.onPayloadStop = onPayloadStop;
exports.pingWorkerRoster = pingWorkerRoster;

function getFirstWorkerRoot() {
    const cfg = (global.workerConfig) ? global.workerConfig.dispatcher : null;

    return (cfg && cfg.worker_roots && cfg.worker_roots.length > 0) ?
        cfg.worker_roots[0] : null;
}
