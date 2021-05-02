'use strict';

const path = require("path");
const mavlink = require("../util/mavlink");

const Topics = Object.freeze({
    MODE: "mode"
,   FLYING: "flying"
,   ARMED: "armed"
,   FAILSAFE: "failsafe"
,   LOCATION: "location"
,   ALTITUDE: "altitude"
,   ATTITUDE: "attitude"
,   BATTERY: "battery"
});

const VERBOSE = false;
const subscribers = {};

function d(str) {
    if(VERBOSE) console.log(`${path.basename(__filename, ".js")}: ${str}`);
}

function e(str) {
    console.error(`${path.basename(__filename, ".js")}: ${str}`);
}

function isVehicleType(type) {
    return (type >= 0 && type != mavlink.MAV_TYPE_GCS && type < mavlink.MAV_TYPE_GIMBAL);
}

function dump(msg) {
    if(!msg.fieldnames) return "nomsg";

    const out = {};

    msg.fieldnames.forEach((fn) => {
        out[fn] = msg[fn];
    });

    return JSON.stringify(out);
}

const mState = {
    sysid: 0,
    compid: 0,
    location: { lat: 0, lng: 0, altAGL: 0, valid: false },
    vehicle_type: 0,
    vehicle_mode: 0
};

const messageMap = {
    "HEARTBEAT": processHeartbeat,
    "GLOBAL_POSITION_INT": processGlobalPositionInt,
    "ATTITUDE": processAttitude,
    "BATTERY_STATUS": processBatteryStatus,
    "VFR_HUD": processVfrHud
};

exports.onMavlinkMessage = function onMavlinkMessage(msg) {
    if(!msg) return;

    const func = messageMap[msg.name];
    if(func) {
        func(msg);
    }
}

exports.addSubscriber = function addSubscriber(topic, client) {
    d(`addSubscriber(${topic}, ${client})`);

    let list = subscribers[topic];
    if(!list) {
        subscribers[topic] = (list = []);
    }

    list.push(client);
}

exports.removeSubscriber = function removeSubscriber(topic, client) {
    d(`removeSubscriber(${topic})`);

    const list = subscribers[topic];
    if(list) {
        const idx = list.indexOf(client);
        if(idx >= 0) {
            d(`Remove client at index ${idx}`);
            list.splice(idx, 1);
        }

        if(list.length === 0) {
            d(`No listeners left on topic ${topic}`);
            delete subscribers[topic];
        }
    }
}

exports.listTopics = function listTopics() {
    return Object.values(Topics);
}

function processHeartbeat(msg) {
    // d(dump(msg.header));

    if(!isVehicleType(msg.type)) return;

    mState.sysid = msg.header.srcSystem;
    mState.compid = msg.header.srcComponent;

    if(!mState.vehicle_type) {
        mState.vehicle_type = msg.type;
    }

    if(mState.mode_number !== msg.custom_mode) {
        mState.mode_number = msg.custom_mode;

        publish(Topics.MODE, mState);
    }

    const status = msg.system_status;
    const flying = (status === mavlink.MAV_STATE_ACTIVE);
    const armed = ((msg.base_mode & mavlink.MAV_MODE_FLAG_SAFETY_ARMED) == mavlink.MAV_MODE_FLAG_SAFETY_ARMED);
    const failsafe = (
        status === msg.system_status == mavlink.MAV_STATE_CRITICAL
        || status === msg.system_status == mavlink.MAV_STATE_EMERGENCY
    );

    if(flying !== mState.flying) {
        mState.flying = flying;
        publish(Topics.FLYING, mState);
    }

    if(armed !== mState.armed) {
        mState.armed = armed;
        publish(Topics.ARMED, mState);
    }

    if(failsafe) {
        publish(Topics.FAILSAFE, mState);
    }
}

exports.getTopics = function getTopics() {
    return Object.values(Topics);
}

function processGlobalPositionInt(msg) {
    const lat = (msg.lat / 1E7);
    const lng = (msg.lon / 1E7);
    const alt = (msg.alt / 1000);

    const whereChanged = (lat !== mState.location.lat || lng != mState.location.lng);
    const altChanged = (alt != mState.location.altAGL);

    mState.location.lat = lat;
    mState.location.lng = lng;
    mState.location.altMSL = alt;
    mState.location.altAGL = msg.relative_alt / 1000;
    mState.location.alt = mState.location.altAGL;

    mState.location.valid = true;

    if (whereChanged) {
        publish(Topics.LOCATION, mState.location);
    }
}

function processAttitude(msg) {
    mState.attitude = {
        roll: Math.toDegrees(msg.roll),
        rollSpeed: Math.toDegrees(msg.rollspeed),
        pitch: Math.toDegrees(msg.pitch),
        pitchSpeed: Math.toDegrees(msg.pitchspeed),
        yaw: Math.toDegrees(msg.yaw),
        heading: yawToHeading(Math.toDegrees(msg.yaw)),
        yawSpeed: Math.toDegrees(msg.yawspeed)
    };

    publish(Topics.ATTITUDE, mState.attitude);
}

function processBatteryStatus(msg) {
    if (mState.battery) {
        if (mState.battery.voltage !== msg.voltage ||
            mState.battery.remaining !== msg.remaining ||
            mState.battery.current !== msg.current) {
            mState.battery.current = msg.current;
            mState.battery.voltage = msg.voltage;
            mState.battery.remaining = remaining;
        }
    } else {
        mState.battery = {
            voltage: msg.voltage,
            current: msg.current,
            remaining: msg.remaining
        };
    }

    publish(Topics.BATTERY, mState.battery);
}

function processVfrHud(msg) {
    var speed = mState.speed;

    if (!speed) {
        speed = {
            airSpeed: msg.airspeed,
            groundSpeed: msg.groundspeed,
            throttle: msg.throttle,
            verticalSpeed: msg.climb
        };

        mState.speed = speed;
        publish(Topics.SPEED, mState.speed);
    } else {
        if (speed.groundSpeed !== msg.groundspeed || speed.airSpeed !== msg.airspeed || speed.verticalSpeed !== msg.climb) {
            speed.groundSpeed = msg.groundspeed;
            speed.airSpeed = msg.airspeed;
            speed.verticalSpeed = msg.climb;

            publish(Topics.SPEED, mState.speed);
        }
    }
}

function publish(topic, msg) {
    d(`${topic}: ${JSON.stringify(msg)}`);

    const list = subscribers[topic];
    if(list) {
        const str = JSON.stringify({
            event: "topic",
            topic: topic, 
            message: msg
        });

        list.forEach((client) => { 
            try {
                client.send(str)
            } catch(ex) {
                e(ex.message);
                exports.removeSubscriber(topic, client);
            }
        });
    }
}

(function () {
    if (!Math.toRadians) {
        Math.toRadians = function (degrees) {
            return degrees * Math.PI / 180;
        }
    }

    if (!Math.toDegrees) {
        Math.toDegrees = function (radians) {
            return radians * 180 / Math.PI;
        }
    }
})();

function yawToHeading(yaw) {
    let output = yaw;

    if (output < 0) output += 360;

    return output;
}
