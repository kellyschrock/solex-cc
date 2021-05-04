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
,   SPEED: "speed"
,   MISSION: "mission"
});

const VERBOSE = false;
const DEF_PUBLISH_INTERVAL = 1000;
const subscribers = {};
const pubTimes = {};

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
    mode_number: 0,
    battery: {},
    missionState: { current_item: -1, reached_item: -1, count: 0 }
};

const messageMap = {
    "HEARTBEAT": processHeartbeat,
    "GLOBAL_POSITION_INT": processGlobalPositionInt,
    "ATTITUDE": processAttitude,
    "SYS_STATUS": processSysStatus,
    "BATTERY_STATUS": processBatteryStatus,
    "VFR_HUD": processVfrHud,
    "MISSION_COUNT": processMissionCount,
    "MISSION_CURRENT": processMissionCurrent,
    "MISSION_ITEM_REACHED": processMissionItemReached
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
		list = [];
		subscribers[topic] = list;
    }

    list.push(client);
}

exports.removeSubscriber = function removeSubscriber(topic, client) {
    d(`removeSubscriber(${topic}, ${client})`);

    const list = subscribers[topic];
    if(list) {
		d(`found ${list.length} subscribers on ${topic}`);

        const idx = list.indexOf(client);
        if(idx >= 0) {
            d(`Remove client at index ${idx}`);
            list.splice(idx, 1);
        } else {
			d(`Found no client for ${topic}`);
		}

        if(list.length === 0) {
            d(`No listeners left on topic ${topic}`);
            delete subscribers[topic];
        }
    } else {
		d(`No clients on topic ${topic}`);
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

        publish(Topics.MODE, mState, 10);
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
        publish(Topics.FLYING, mState, 10);
    }

    if(armed !== mState.armed) {
        mState.armed = armed;
        publish(Topics.ARMED, mState, 10);
    }

    if(failsafe) {
        publish(Topics.FAILSAFE, mState, 10);
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
        publish(Topics.LOCATION, mState.location, 10);
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

    publish(Topics.ATTITUDE, mState.attitude, 1000);
}

function processSysStatus(msg) {
    msg.voltage = msg.voltage_battery / 1000;
    msg.current_battery = msg.current_battery / 100;
    processBatteryStatus(msg, true);
}

function processBatteryStatus(msg, fromSysStatus) {
    if (mState.battery) {
        if (mState.battery.voltage !== msg.voltage ||
            mState.battery.remaining !== msg.battery_remaining ||
            mState.battery.current !== msg.current_battery) {
            mState.battery.current = msg.current_battery;
            mState.battery.voltage = msg.voltage;
            mState.battery.remaining = msg.battery_remaining;
        }
    } else {
        mState.battery = {
            voltage: msg.voltage,
            current: msg.current_battery,
            remaining: msg.battery_remaining
        };
    }

    if(!fromSysStatus) {
        publish(Topics.BATTERY, mState.battery, 10000);
    }
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
        publish(Topics.SPEED, mState.speed, 5000);
    } else {
        if (speed.groundSpeed !== msg.groundspeed || speed.airSpeed !== msg.airspeed || speed.verticalSpeed !== msg.climb) {
            speed.groundSpeed = msg.groundspeed;
            speed.airSpeed = msg.airspeed;
            speed.verticalSpeed = msg.climb;

            publish(Topics.SPEED, mState.speed, 5000);
        }
    }
}

function processMissionCount(msg) {
    mState.missionState.count = msg.count;
    publish(Topics.MISSION, mState.missionState, 100);
}

function processMissionCurrent(msg) {
    mState.missionState.current_item = msg.seq;
    publish(Topics.MISSION, mState.missionState, 100);
}

function processMissionItemReached(msg) {
    mState.missionState.reached_item = msg.seq;
    publish(Topics.MISSION, mState.missionState, 100);
}

function publish(topic, msg, interval = DEF_PUBLISH_INTERVAL) {
    const now = Date.now();
    const lastPubTime = pubTimes[topic] || 0;
    const diff = (now - lastPubTime);

    if(diff > interval) {
        // d(`${topic}: ${JSON.stringify(msg)}`);
        pubTimes[topic] = now;

        const list = subscribers[topic];
        if (list) {
			d(`publish on topic to ${list.length} listener(s)`);

            const str = JSON.stringify({
                event: "topic",
                topic: topic,
                message: msg
            });

            list.forEach((client) => {
                try {
                    client.send(str)
                } catch (ex) {
                    e(ex.message);
                    exports.removeSubscriber(topic, client);
                }
            });
        }
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
