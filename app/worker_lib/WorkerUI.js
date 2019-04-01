'use strict';

const path = require("path");
const fs = require("fs");

exports.Const = Object.freeze({
    SCREEN_START: "start",
    PANEL_WORKER_BUTTONS: "worker_buttons",

    SCREEN_VIDEO: "video",
    PANEL_VIDEO_MAIN: "video_main",
    PANEL_VIDEO_BOTTOM: "video_bottom",

    SCREEN_MAP: "map",
    PANEL_MAP_MAIN: "map_main",
    PANEL_MAP_BOTTOM: "map_bottom",

    SCREEN_FLIGHT: "flight",
    PANEL_CAMERA: "camera_panel",
    PANEL_WORKER_SHOT_BUTTONS: "worker_shot_buttons",
    PANEL_WORKER_STATUS: "worker_status",

    SCREEN_COMMANDS: "commands",
    PANEL_WORKER_FLIGHT_BUTTONS: "worker_flight_buttons"
});

exports.loadLayout = function(inPath, panel) {
    const file = path.join(path.join(inPath, "ui"), `${panel}.json`);

    if (fs.existsSync(file)) {
        try {
            return JSON.parse(fs.readFileSync(file));
        } catch (ex) {
            console.log(ex.message);
            return null;
        }
    }

    return null;
};

exports.serveImage = function(dir, name) {
    const filename = path.join(dir, path.join("img", name));

    try {
        return (fs.existsSync(filename)) ?
            fs.readFileSync(filename) : null;
    } catch(ex) {
        console.log(ex.message);
        return null;
    }
};

//
// Speech
//
exports.SpeechType = Object.freeze({
    TTS: "tts",
    TEXT: "text",
    ERROR: "error"
});

exports.sendSpeechMessage = function(attrs, text, type) {
    attrs.sendGCSMessage(attrs.id, {
        id: "speech",
        text: text,
        type: type || exports.SpeechType.TTS
    });
}

//
// Toast
//
exports.ToastLength = Object.freeze({
    SHORT: "short", LONG: "long"
});

exports.sendToastMessage = function(attrs, text, length) {
    const len = length || exports.ToastLength.SHORT;

    attrs.sendGCSMessage(attrs.id, {
        id: "toast", text: text, length: len
    });
}

//
// Find view by id
//
exports.findViewById = function(body, id, recurs) {
    if (!body) return null;
    if (!body.children) return null;
    const recursive = recurs || false;

    const children = body.children;
    for (let i = 0, size = children.length; i < size; ++i) {
        const child = children[i];
        // console.log(`WorkerUI: child.id=${child.id}`);

        if (child.id && child.id === id) {
            return child;
        }

        if(recursive && child.children) {
            const found = exports.findViewById(child, id, recursive);
            if(found != null) {
                return found;
            }
        }
    }

    return null;
};

