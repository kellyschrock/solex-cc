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
    console.log(str);
}

function loadSystemState() {
    $.getJSON("/sys/state", function(state) {
        mSystemState = state;
        mGlobalState = mSystemState;
    });
}

function putSystemState(name, value) {
    post("/sys/state", {
        name: name, value: value
    }, function(data) {
        mGlobalState[name] = value;
    }, function(errResponse) {
        console.log(errResponse);
    });
}

function clearSystemState(name) {
    sendDelete("/sys/state/" + name, function(response) {
        delete mGlobalState[name];
    });
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

function settingsPage() {
    // TODO: Remove this crap, it's for a different app.
    var vehicleTypes = [
        {value: 0, name: "Default"},
        {value: 1, name: "Xray"},
        {value: 2, name: "Endurance"},
        {value: 3, name: "FX-61"},
        {value: 4, name: "3DR Solo"},
        {value: 5, name: "xCraft"}
    ];

    var vehicles = [];

    function getTypeName(id) {
        var i;
        for(i = 0; i < vehicleTypes.length; ++i) {
            if(vehicleTypes[i].value == id) {
                return vehicleTypes[i].name;
            }
        }

        return vehicleTypes[0].name;
    }

    function loadTableWith(data) {
        $("#tbl_vehicles").find("tr:gt(0)").remove();

        if(data) {
            $.each(data, function(idx, item) {
                var name = (item.name)? item.name: "";
                var type = (item.type)? item.type: 0;

                if(item.hwid) {
                    $("#tbl_vehicles tr:last").after(
                        "<tr><td class=\"nr\">" + item.hwid + 
                        "</td><td>" + name + "</td>" + 
                        "</td><td>" + getTypeName(type) + "</td>" + 
                        "<td><button class=\"del btn btn-danger\">Delete</button></td></tr>");
                }
            });

            $(".del").click(function() {
                var hwid = $(this).closest("tr").find(".nr").text();
                if(confirm("Delete vehicle " + hwid + "?")) {
                    sendDelete("/vehicle/" + hwid, function() {
                        loadData();
                    });
                }
            });
        }
    }

    function loadData() {
    }

    function filter(str) {
        var output = [];
        var i;

        if(vehicles) {
            for(i = 0; i < vehicles.length; ++i) {
                if(!vehicles[i].hwid) continue;

                if(vehicles[i].hwid.indexOf(str) >= 0) {
                    output.push(vehicles[i]);
                }
            }
        }

        return output;
    }

    loadData();

    $("#btn_show_add").click(function() {
        $(this).hide();
        $("#frm_add").show();
        $("#txt_hwid").val("").focus();
        $("#txt_name").val("");
    });

    $("#btn_add_vehicle").click(function(evt) {
        var body = {
            hwid: $("#txt_hwid").val(),
            name: $("#txt_name").val(),
            type: $("#sel_type").val()
        };

        $("#frm_add").hide();
        $("#btn_show_add").show();

        post("/vehicle", body, function() {
            loadData();
        });
    });

    $("#btn_cancel_add").click(function() {
        $("#frm_add").hide();
        $("#btn_show_add").show();
    });

    $("#txt_hwid_filter").keyup(function() {
        var str = $(this).val();
        var items = filter(str);
        loadTableWith(items);
    });

    $.each(vehicleTypes, function (i, item) {
        $('#sel_type').append($('<option>', { 
            value: item.value,
            text : item.name 
        }));
    });    

    $("#frm_add").hide();
}

//
// Page functions
//
function RTKPage() {}

function setupWebSocket() {
    if(!"WebSocket" in window) {
        alert("Your browser doesn't support web sockets!");
    } else {
        // We have web sockets
        connectWebSocket();
    } // end else
}

function loadSettings(cb) {
    $.getJSON("/settings", function (data) {
        mSettings = data;

        if(cb) cb(data);
    });
}

function loadRegState(cb) {
    $.getJSON("/sys/regstate", function(result) {
        if(cb) cb(result);
    });
}

function getSetting(cat, name, defValue) {
    return (mSettings[cat])?
        mSettings[cat][name] || defValue: defValue;
}

function putSetting(cat, name, value) {
    post("/settings/" + cat, { name: name, value: value }, function(data) {
        log("Saved " + name + "=" + value);
    });
}

function putSettings(cat, value) {
    post("/settings/" + cat, value, function(data) {
        log("Saved " + value);
        mSettings[cat] = value;
    });
}

function connectWebSocket() {
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
            for(var evl of mEventListeners) {
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

function showStatusIcon(name, show) {

    switch(name) {
        case "gps_search": {
            showControl("ic_gps_search", show);
            break;
        }

        case "gps_fix": {
            showControl("ic_gps_fix", show);
            break;
        }

        case "connected": {
            showControl("ic_connected", show);
            break;
        }

        case "rtk_send": {
            showControl("ic_rtcm_send", show);
            break;
        }
    }
}

$(document).ready(function() {
    loadView("workers.html");

    // TODO: For when there's something to document.
    // $("#btn_home").click(function(evt) {
    //     loadView("doc.html");
    // });

    $("#btn_workers").click(function(evt) {
        loadView("workers.html");
    });

    $("#btn_test_worker").click(function(evt) {
        loadView("test_worker.html");
    });

    // $("div.content").each(function(div) {
    //     var file = $(this).attr("include-html");
    //     if(file) {
    //         $(this).load(file);
    //     }
    // });
});

