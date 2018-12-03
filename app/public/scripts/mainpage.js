'use strict';

var mSocket = null;
var mEventListeners = [];
// A place for arbitrary data 
// TODO: This can go away eventually.
var mGlobalState = {};

var mSystemState = {};

var mSettings = null;
var validChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890 ,-_;:";

function log(str) {
    console.log(`mainpage: ${str}`);
}

function enable(ctl, enabled) {
    console.log("enable(): ctl=", ctl + ", enabled=", enabled);
    
    if(enabled) {
        $(ctl).removeAttr("disabled");
    } else {
        $(ctl).attr("disabled", "disabled");
    }
}

function showControl(ctrl, show) {
    var id = (ctrl.startsWith("#"))? ctrl: "#" + ctrl;
    // console.log("id=", id, " show=", show);

    if (show) {
        $(id).show();
    } else {
        $(id).hide();
    }
}

function showControlClass(cls, show) {
    if(show) {
        $(cls).show();
    } else {
        $(cls).hide();
    }
}

function loadView(page, callback) {
    var cb = callback || function() {};

    var path = "page/" + page;

    $("#view_content").load(path, cb);
}

function cleanText(text) {
    var txt = "";
    var i = 0;
    while(i < text.length) {
        if(validChars.indexOf(text[i]) == -1) {
            break;
        }

        txt += text[i++];
    }

    return txt;
}

function bool(value) {
    if(value === true) return true;
    if(value === "true") return true;
    return false;
}

function secondsTimeSpanToHMS(s) {
    var h = Math.floor(s / 3600); //Get whole hours
    s -= h * 3600;
    var m = Math.floor(s / 60); //Get remaining minutes
    s -= m * 60;
    return h + ":" + (m < 10 ? '0' + m : m) + ":" + (s < 10 ? '0' + s : s); //zero padding on minutes and seconds
}

function toHex(d, padding) {
    var hex = Number(d).toString(16);
    padding = padding || 2;

    while (hex.length < padding) {
        hex = "0" + hex;
    }

    return hex;
}

function post(url, content, successCallback, failCallback) {
    $.post({
        type: "POST",
        url: url,
        data: content,
        success: successCallback
    }).fail(function(response) {
        if(failCallback) {
            failCallback(response);
        } else {
            alert(JSON.stringify(response));
        }
    });
}

function postJSON(url, content, successCallback, failCallback) {
    $.post({
        type: "POST",
        url: url,
        contentType: "application/json",
        data: content,
        success: successCallback
    }).fail(function(response) {
        if(failCallback) {
            failCallback(response);
        } else {
            alert(JSON.stringify(response));
        }
    });
}

function sendDelete(url, successCallback) {
    $.ajax({
        url: url,
        type: "DELETE",
        success: successCallback
    });
}

//
// Page functions
//
function setupWebSocket() {
    if(!"WebSocket" in window) {
        alert("Your browser doesn't support web sockets!");
    } else {
        // We have web sockets
        connectWebSocket();
    } // end else
}

function connectWebSocket() {
    log("connectWebSocket()");

    var socket;
    var url = $(location).attr("href");
    var host = url.replace("http:", "ws:");

    var pos = host.indexOf("#");
    if(pos >= 0) {
        host = host.substring(0, pos);
    }

    try {
        mSocket = new WebSocket(host);

        mSocket.onopen = function() {
            log("onopen()");
        };

        mSocket.onmessage = function(msg) {
            // log("onmessage(): " + msg.data);
            for(let evl of mEventListeners) {
                evl.onMessage(msg.data);
            }
        };

        mSocket.onclose = function() {
            log("onclose()");
        };
    } catch(ex) {
        alert("ex=" + ex);
    }
}

function addWebSocketListener(listener) {
    mEventListeners.push(listener);
}

function removeWebSocketListener(listener) {
    var idx = mEventListeners.indexOf(listener);
    if(idx >= 0) {
        mEventListeners.splice(idx, 1);
    }
}

function sendWS(msg) {
    if(mSocket != null) {
        try {
            mSocket.send(JSON.stringify(msg));
        } catch(ex) {
            alert("send error: " + ex);
        }
    }
}

$(document).ready(function() {
    setupWebSocket();

    loadView("workers.html");

    $("#btn_workers").click(function(evt) {
        loadView("workers.html");
    });

    $("#btn_test_worker").click(function(evt) {
        loadView("test_worker.html");
    });

    $("#btn_logging").click(function(evt) {
        loadView("logging.html");
    });
});

