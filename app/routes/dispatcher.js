'use strict';

const dispatch = require("../util/dispatch");

function start(req, res) {
    dispatch.start();
    res.json({message: "started"});
}

function stop(req, res) {
    dispatch.stop();
    res.json({message: "stopped"});
}

function reload(req, res) {
    dispatch.reload(global.workerRoot);
    res.json({message: "reloaded"});
}

exports.start = start;
exports.stop = stop;
exports.reload = reload;
