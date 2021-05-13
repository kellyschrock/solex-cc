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
,   MISSION_STATE: "mission_state"
,   MISSION_CONTENT: "mission_content"
});

const VERBOSE = true;
const TRACE = true;

const DEF_PUBLISH_INTERVAL = 1000;
const subscribers = {};
const pubTimes = {};
const senderInfo = {};
let mavlinkSendCallback = null;
let sysid = 0;
let compid = 0;

function trace(str) {
    if (TRACE) console.log(`${path.basename(__filename, ".js")}: ${str}`);
}

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
    missionState: { current_item: -1, reached_item: -1, count: 0 },
    internal_mission_count: 0,
    mission: {
        items: [],
        count: 0
    }
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
    "MISSION_ITEM": processMissionItem,
    "MISSION_ITEM_REACHED": processMissionItemReached
};

function sendMavlink(msg) {
    if(mavlinkSendCallback) {
        mavlinkSendCallback(msg);
    } else {
        d(`No mavlinkSendCallback. msg.name=${msg.name}`);
    }
}

exports.setSenderInfo = function setSenderInfo(sender) {
    Object.assign(senderInfo, sender);
}

exports.setMavlinkSendCallback = (cb) => {
    mavlinkSendCallback = cb;
}

exports.setSysIdCompId = (sid, cid) => {
    sysid = sid;
    compid = cid;
}

exports.onMavlinkMessage = function onMavlinkMessage(msg) {
    if(!msg) return;

    const func = messageMap[msg.name];
    if(func) {
        func(msg);
    }
}

exports.addSubscriber = function addSubscriber(topic, client) {
    d(`addSubscriber(${topic}, ${client.ip_address})`);

    let list = subscribers[topic];
    if(!list) {
		list = [];
		subscribers[topic] = list;
    }

    const toRemove = [];
    for(const c of list) {
        if(c.ip_address == client.ip_address) {
            toRemove.push(c);
        }
    }

    for(const c of toRemove) {
        const idx = list.indexOf(c);
        if(idx >= 0) {
            d(`Remove redundant client at ${idx}`);
            list.splice(idx, 1);
        }
    }

    list.push(client);
}

exports.removeSubscribersWithIPAddress = function removeSubscribersWithIPAddress(ip) {
    d(`removeSubscribersWithIPAddress(${ip})`);

    // Takes care of keeping the topic list clean if a client dies suddenly 
    // and doesn't unsubscribe first.
    Object.values(Topics).forEach((topic) => {
        const list = subscribers[topic];
        if(list && list.length) {
            for(const client of list) {
                if(client.ip_address == ip) {
                    const idx = list.indexOf(client)
                    if(idx >= 0) {
                        d(`Unsubscribe ${ip} from ${topic}`);
                        list.splice(idx, 1);
                    }
                }
            }
        }
    });
}

exports.removeSubscriber = function removeSubscriber(topic, client) {
    d(`removeSubscriber(${topic}, ${client.ip_address})`);

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

exports.getSubscriptionsForIP = function getSubscriptionsForIP(ip) {
    d(`getSubscriptionsForIP(${ip})`);

    const out = [];

    Object.values(Topics).forEach((topic) => {
        const subs = subscribers[topic];
        if(subs && subs.length) {
            subs.forEach((client) => {
                // d(`Check ${client.ip_address} for ${topic}`);
                if(client.ip_address == ip) {
                    out.push(topic);
                }
            });
        }
    });

    return out;
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

        publish(Topics.MODE, { mode: mState.mode_number, vehicle_type: mState.vehicle_type }, 10);
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
        publish(Topics.FLYING, { flying: mState.flying }, 10);
    }

    if(armed !== mState.armed) {
        mState.armed = armed;
        publish(Topics.ARMED, { armed: mState.armed }, 10);

        if(armed) {
            d(`Armed, request mission`);

            mState.requesting_mission = true;
            mState.mission_seq = 0;
            mState.internal_mission_count = 0;
            sendMavlink(new mavlink.messages.mission_request_list(sysid, compid));
        }
    }

    if(failsafe) {
        publish(Topics.FAILSAFE, { failsafe: failsafe }, 10);
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
    if(mState.internal_mission_count != msg.count) {
        mState.internal_mission_count = msg.count;
        mState.missionState.count = msg.count;

        publish(Topics.MISSION_STATE, mState.missionState, 100);

        mState.mission = {
            count: msg.count,
            items: []
        };

        if(mState.requesting_mission) {
            mState.mission_seq = 0;
            sendMavlink(new mavlink.messages.mission_request(sysid, compid, mState.mission_seq));
        }
    }
}

function processMissionItem(msg) {
    function shave(msg) {
        const out = {};

        if(msg.fieldnames) {
            msg.fieldnames.forEach((f) => { out[f] = msg[f] });
        } else {
            return null;
        }

        return out;
    }

    if(mState.mission) {
        if(!mState.mission.items) mState.mission.items = [];
        const shaved = shave(msg);
        if(shaved) {
            mState.mission.items.push(shaved);
        }

        if(mState.mission.items.length == mState.mission.count) {
            d(`Got ${mState.mission.items.length} mission items`);
            publish(Topics.MISSION_CONTENT, mState.mission, 10);

            delete mState.requesting_mission;
            delete mState.mission_seq;
            mState.internal_mission_count = 0;
        } else {
            if(mState.requesting_mission) {
                sendMavlink(new mavlink.messages.mission_request(sysid, compid, ++mState.mission_seq));
            }
        }
    }
}

function processMissionCurrent(msg) {
    if(mState.missionState.current_item != msg.seq) {
        mState.missionState.current_item = msg.seq;
        publish(Topics.MISSION_STATE, mState.missionState, 1);
    }
}

function processMissionItemReached(msg) {
    if(mState.missionState.reached_item != msg.seq) {
        mState.missionState.reached_item = msg.seq;
        publish(Topics.MISSION_STATE, mState.missionState, 1);
    }
}

function publish(topic, msg, interval = DEF_PUBLISH_INTERVAL) {
    const now = Date.now();
    const lastPubTime = pubTimes[topic] || 0;
    const diff = (now - lastPubTime);

    if(diff > interval) {
        pubTimes[topic] = now;

        if(topic == Topics.MISSION_CONTENT) trace(`publish(${topic})`);

        const list = subscribers[topic];
        if (list) {
			d(`publish on ${topic} to ${list.length} listener(s)`);

            const str = JSON.stringify({
                event: "topic",
                topic: topic,
                sender: senderInfo,
                message: msg
            });

            list.forEach((client) => {
                d(`\tpublish to ${client.ip_address}`);

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
